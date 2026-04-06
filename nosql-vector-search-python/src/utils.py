"""Shared utilities for Azure Cosmos DB NoSQL vector search.

Provides client initialization (passwordless and key-based), JSON I/O,
bulk insert with RU tracking, field validation, and result formatting.
"""

import json
import os
import re
import time
from typing import Any, Optional


def get_clients() -> dict[str, Any]:
    """Get Azure OpenAI and Cosmos DB clients using key-based authentication.

    Returns dict with 'ai_client' and 'db_client' (either may be None if
    the required environment variables are missing).
    """
    from azure.cosmos import CosmosClient
    from openai import AzureOpenAI

    ai_client = None
    db_client = None

    api_key = os.getenv("AZURE_OPENAI_EMBEDDING_KEY", "")
    api_version = os.getenv("AZURE_OPENAI_EMBEDDING_API_VERSION", "")
    endpoint = os.getenv("AZURE_OPENAI_EMBEDDING_ENDPOINT", "")
    deployment = os.getenv("AZURE_OPENAI_EMBEDDING_MODEL", "")

    if api_key and api_version and endpoint and deployment:
        ai_client = AzureOpenAI(
            api_key=api_key,
            api_version=api_version,
            azure_endpoint=endpoint,
            azure_deployment=deployment,
        )

    cosmos_endpoint = os.getenv("AZURE_COSMOSDB_ENDPOINT", "")
    cosmos_key = os.getenv("AZURE_COSMOSDB_KEY", "")

    if cosmos_endpoint and cosmos_key:
        db_client = CosmosClient(url=cosmos_endpoint, credential=cosmos_key)

    return {"ai_client": ai_client, "db_client": db_client}


def get_clients_passwordless() -> dict[str, Any]:
    """Get Azure OpenAI and Cosmos DB clients using DefaultAzureCredential.

    Uses managed identity / Azure CLI credentials for passwordless auth.
    Returns dict with 'ai_client' and 'db_client' (either may be None).
    """
    from azure.cosmos import CosmosClient
    from azure.identity import DefaultAzureCredential, get_bearer_token_provider
    from openai import AzureOpenAI

    ai_client = None
    db_client = None

    api_version = os.getenv("AZURE_OPENAI_EMBEDDING_API_VERSION", "")
    endpoint = os.getenv("AZURE_OPENAI_EMBEDDING_ENDPOINT", "")
    deployment = os.getenv("AZURE_OPENAI_EMBEDDING_MODEL", "")

    if api_version and endpoint and deployment:
        credential = DefaultAzureCredential()
        token_provider = get_bearer_token_provider(
            credential, "https://cognitiveservices.azure.com/.default"
        )
        ai_client = AzureOpenAI(
            api_version=api_version,
            azure_endpoint=endpoint,
            azure_deployment=deployment,
            azure_ad_token_provider=token_provider,
        )

    cosmos_endpoint = os.getenv("AZURE_COSMOSDB_ENDPOINT", "")

    if cosmos_endpoint:
        credential = DefaultAzureCredential()
        db_client = CosmosClient(url=cosmos_endpoint, credential=credential)

    return {"ai_client": ai_client, "db_client": db_client}


def read_file_return_json(file_path: str) -> list[dict[str, Any]]:
    """Read a JSON file and return its parsed contents."""
    print(f"Reading JSON file from {file_path}")
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"Error: File '{file_path}' not found")
        raise
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON in file '{file_path}': {e}")
        raise


def write_file_json(file_path: str, json_data: Any) -> None:
    """Serialize data to a JSON file."""
    try:
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(json_data, f, indent=2, ensure_ascii=False)
        print(f"Wrote JSON file to {file_path}")
    except IOError as e:
        print(f"Error writing to file '{file_path}': {e}")
        raise


def _get_document_count(container: Any) -> int:
    """Return the number of documents in a Cosmos DB container."""
    query = "SELECT VALUE COUNT(1) FROM c"
    results = list(container.query_items(query=query, enable_cross_partition_query=True))
    return results[0] if results else 0


def insert_data(
    container: Any, data: list[dict[str, Any]]
) -> dict[str, Any]:
    """Bulk-insert documents into a Cosmos DB container.

    Skips insertion if the container already has documents.
    Each item gets an 'id' field mapped from 'HotelId'.

    Returns a dict with total, inserted, failed, skipped, and requestCharge.
    """
    existing_count = _get_document_count(container)

    if existing_count > 0:
        print(f"Container already has {existing_count} documents. Skipping insert.")
        return {
            "total": 0,
            "inserted": 0,
            "failed": 0,
            "skipped": existing_count,
            "requestCharge": 0.0,
        }

    print(f"Inserting {len(data)} items...")

    inserted = 0
    failed = 0
    total_request_charge = 0.0

    start_time = time.time()

    for item in data:
        doc = {"id": item["HotelId"], **item}
        try:
            response = container.upsert_item(body=doc)
            inserted += 1
            ru = _extract_ru_from_headers(container.client_connection.last_response_headers)
            total_request_charge += ru
        except Exception as e:
            status_code = getattr(e, "status_code", None)
            if status_code == 409:
                inserted += 1
            else:
                failed += 1
                print(f"  Insert failed for item {item.get('HotelId', '?')}: {e}")

    duration = time.time() - start_time
    print(f"Bulk insert completed in {duration:.2f}s")
    print(f"\nInsert Request Charge: {total_request_charge:.2f} RUs\n")

    return {
        "total": len(data),
        "inserted": inserted,
        "failed": failed,
        "skipped": 0,
        "requestCharge": total_request_charge,
    }


def _extract_ru_from_headers(headers: Optional[dict[str, str]]) -> float:
    """Extract the request charge (RU) from Cosmos DB response headers."""
    if not headers:
        return 0.0
    raw = headers.get("x-ms-request-charge", "0")
    try:
        return float(raw)
    except (ValueError, TypeError):
        return 0.0


def validate_field_name(field_name: str) -> str:
    """Validate a field name is a safe SQL identifier.

    Prevents NoSQL injection when interpolating field names into queries.
    Allows only letters, digits, and underscores; must start with a letter
    or underscore.

    Raises ValueError if the field name is invalid.
    """
    pattern = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
    if not pattern.match(field_name):
        raise ValueError(
            f'Invalid field name: "{field_name}". '
            "Field names must start with a letter or underscore and "
            "contain only letters, numbers, and underscores."
        )
    return field_name


def print_search_results(
    search_results: list[dict[str, Any]],
    request_charge: Optional[float] = None,
) -> None:
    """Print vector search results in a consistent format."""
    print("\n--- Search Results ---")
    if not search_results:
        print("No results found.")
        return

    for i, result in enumerate(search_results, 1):
        score = result.get("SimilarityScore", 0.0)
        name = result.get("HotelName", "Unknown")
        print(f"{i}. {name}, Score: {score:.4f}")

    if request_charge is not None:
        print(f"\nVector Search Request Charge: {request_charge:.2f} RUs")
    print("")


def get_query_activity_id(response_headers: Optional[dict[str, str]]) -> Optional[str]:
    """Extract the activity ID from Cosmos DB query response headers."""
    if not response_headers:
        return None
    return response_headers.get("x-ms-activity-id")


def get_bulk_operation_rus(headers: Optional[dict[str, str]]) -> float:
    """Extract total RU cost from Cosmos DB response headers."""
    return _extract_ru_from_headers(headers)
