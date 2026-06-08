"""Data-plane operations for the nosql-create-index-python sample."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Sequence

from azure.cosmos import CosmosClient
from azure.cosmos.exceptions import CosmosHttpResponseError
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from openai import AzureOpenAI

from .config import SampleConfig

BATCH_SIZE = 100
FIELD_NAME_PATTERN = r"^[A-Za-z_][A-Za-z0-9_]*$"


@dataclass(frozen=True)
class IngestionSummary:
    container_name: str
    total_documents: int
    inserted_documents: int
    skipped: bool
    request_charge: float


@dataclass(frozen=True)
class QueryResult:
    hotel_id: str
    hotel_name: str
    description: str
    score: float


@dataclass(frozen=True)
class QuerySummary:
    container_name: str
    request_charge: float
    activity_id: str
    results: Sequence[QueryResult]


def create_cosmos_client(config: SampleConfig, credential: DefaultAzureCredential) -> CosmosClient:
    return CosmosClient(url=config.cosmos_endpoint, credential=credential)


def create_azure_openai_client(
    config: SampleConfig, credential: DefaultAzureCredential
) -> AzureOpenAI:
    token_provider = get_bearer_token_provider(
        credential, "https://cognitiveservices.azure.com/.default"
    )
    return AzureOpenAI(
        azure_endpoint=config.openai_embedding_endpoint,
        azure_ad_token_provider=token_provider,
        api_version=config.openai_embedding_api_version,
    )


def read_documents(data_file: Path) -> List[Dict[str, Any]]:
    with data_file.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)

    if not isinstance(payload, list):
        raise ValueError("The shared hotel dataset must be a JSON array.")

    return [prepare_document(item) for item in payload]


def prepare_document(item: Dict[str, Any]) -> Dict[str, Any]:
    document = dict(item)
    document["id"] = str(item["HotelId"])
    document["PartitionKey"] = "hotels"
    return document


def generate_embedding(
    openai_client: AzureOpenAI, config: SampleConfig, text: str
) -> Sequence[float]:
    response = openai_client.embeddings.create(
        model=config.openai_embedding_deployment,
        input=[text],
    )
    return response.data[0].embedding


def verify_embedding_dimensions(
    openai_client: AzureOpenAI, config: SampleConfig
) -> Sequence[float]:
    print("\n=== Verify embedding dimensions ===")
    embedding = generate_embedding(openai_client, config, "dimension check")
    actual_dimensions = len(embedding)
    print("Deployment: {0}".format(config.openai_embedding_deployment))
    print("Model:      {0}".format(config.embedding_model_name))
    print("Actual:     {0}".format(actual_dimensions))
    print("Expected:   {0}".format(config.expected_dimensions))

    if actual_dimensions != config.expected_dimensions:
        raise ValueError(
            "Embedding dimensions do not match the container definition. "
            "Expected {0}, received {1}.".format(
                config.expected_dimensions, actual_dimensions
            )
        )

    return embedding


def ingest_documents(container: Any, container_name: str, documents: Sequence[Dict[str, Any]]) -> IngestionSummary:
    print("\n=== Ingest documents: {0} ===".format(container_name))
    existing_count = _document_count(container)
    if existing_count > 0:
        print(
            "Container already has {0} documents for PartitionKey='hotels' - skipping ingestion.".format(
                existing_count
            )
        )
        return IngestionSummary(
            container_name=container_name,
            total_documents=len(documents),
            inserted_documents=0,
            skipped=True,
            request_charge=0.0,
        )

    inserted_documents = 0
    total_request_charge = 0.0
    for batch in _chunked(documents, BATCH_SIZE):
        operations = [("upsert", (document,)) for document in batch]
        results = container.execute_item_batch(
            batch_operations=operations,
            partition_key="hotels",
        )
        inserted_documents += sum(
            1 for result in results if int(result.get("statusCode", 0)) < 300
        )
        total_request_charge += _request_charge(container)

    print(
        "Inserted {0}/{1} documents using transactional batches. RU: {2:.2f}".format(
            inserted_documents, len(documents), total_request_charge
        )
    )
    return IngestionSummary(
        container_name=container_name,
        total_documents=len(documents),
        inserted_documents=inserted_documents,
        skipped=False,
        request_charge=total_request_charge,
    )


def query_top_matches(
    container: Any,
    container_name: str,
    config: SampleConfig,
    query_embedding: Sequence[float],
) -> QuerySummary:
    embedding_field = validate_field_name(config.embedding_field_name)
    query_text = (
        "SELECT TOP @topK c.HotelId, c.HotelName, c.Description, "
        "VectorDistance(c.{0}, @embedding) AS similarityScore "
        "FROM c WHERE c.PartitionKey = @partitionKey "
        "ORDER BY VectorDistance(c.{0}, @embedding)"
    ).format(embedding_field)

    raw_results = list(
        container.query_items(
            query=query_text,
            parameters=[
                {"name": "@topK", "value": config.top_count},
                {"name": "@embedding", "value": list(query_embedding)},
                {"name": "@partitionKey", "value": config.partition_key_value},
            ],
            partition_key=config.partition_key_value,
        )
    )

    results = [
        QueryResult(
            hotel_id=str(item["HotelId"]),
            hotel_name=str(item["HotelName"]),
            description=str(item["Description"]),
            score=float(item["similarityScore"]),
        )
        for item in raw_results
    ]

    headers = getattr(container.client_connection, "last_response_headers", {}) or {}
    return QuerySummary(
        container_name=container_name,
        request_charge=_request_charge(container),
        activity_id=str(headers.get("x-ms-activity-id", "")),
        results=results,
    )


def print_query_summary(summary: QuerySummary, algorithm_name: str) -> None:
    print("\n=== Query results: {0} ({1}) ===".format(summary.container_name, algorithm_name))
    if summary.activity_id:
        print("Activity ID: {0}".format(summary.activity_id))
    print("Request charge: {0:.2f} RUs".format(summary.request_charge))

    for rank, result in enumerate(summary.results, start=1):
        print(
            "{0}. HotelId={1} | HotelName={2} | score={3:.4f} | Description={4}".format(
                rank,
                result.hotel_id,
                result.hotel_name,
                result.score,
                _shorten(result.description),
            )
        )


def validate_field_name(field_name: str) -> str:
    import re

    if not re.match(FIELD_NAME_PATTERN, field_name):
        raise ValueError(
            "Invalid embedding field name: {0}".format(field_name)
        )
    return field_name


def wrap_runtime_error(error: Exception) -> RuntimeError:
    if isinstance(error, CosmosHttpResponseError):
        message = getattr(error, "message", str(error)) or str(error)
        return RuntimeError(
            "Cosmos DB data-plane request failed. Verify the database, containers, "
            "and Microsoft Entra ID RBAC assignment created by the shared Bicep deployment. "
            "Original error: {0}".format(message)
        )
    return RuntimeError(str(error))


def _document_count(container: Any) -> int:
    query = "SELECT VALUE COUNT(1) FROM c WHERE c.PartitionKey = @partitionKey"
    results = list(
        container.query_items(
            query=query,
            parameters=[{"name": "@partitionKey", "value": "hotels"}],
            partition_key="hotels",
        )
    )
    return int(results[0]) if results else 0


def _chunked(values: Sequence[Dict[str, Any]], size: int) -> Iterable[Sequence[Dict[str, Any]]]:
    for index in range(0, len(values), size):
        yield values[index : index + size]


def _request_charge(container: Any) -> float:
    headers = getattr(container.client_connection, "last_response_headers", {}) or {}
    raw_value = headers.get("x-ms-request-charge", "0")
    try:
        return float(raw_value)
    except (TypeError, ValueError):
        return 0.0


def _shorten(value: str, limit: int = 110) -> str:
    if len(value) <= limit:
        return value
    return value[: limit - 3].rstrip() + "..."
