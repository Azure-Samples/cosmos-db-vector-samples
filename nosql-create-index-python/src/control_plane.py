"""Control-plane operations for Cosmos DB SQL (NoSQL) API using ARM SDK.

Uses raw JSON payloads to work around ARM SDK limitations with vector types.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from azure.core.exceptions import HttpResponseError
from azure.identity import DefaultAzureCredential
from azure.mgmt.cosmosdb import CosmosDBManagementClient

if TYPE_CHECKING:
    from .config import SampleConfig


def _build_container_payload(
    container_name: str,
    partition_key_path: str,
    embedding_field: str,
    dimensions: int,
    index_type: str
) -> dict[str, Any]:
    """Build container creation payload with vector index configuration.
    
    Args:
        container_name: Name of the container
        partition_key_path: Path to partition key field (e.g., "/HotelId")
        embedding_field: Path to embedding field (e.g., "/DescriptionVector")
        dimensions: Vector embedding dimensions
        index_type: Vector index type ("diskANN" or "quantizedflat")
    
    Returns:
        Container resource payload as dictionary
    """
    return {
        "id": container_name,
        "partitionKey": {
            "paths": [partition_key_path],
            "kind": "Hash"
        },
        "indexingPolicy": {
            "indexingMode": "Consistent",
            "automatic": True,
            "includedPaths": [{"path": "/*"}],
            "excludedPaths": [{"path": "/_etag/?"}],
            "vectorIndexes": [
                {
                    "path": embedding_field,
                    "type": index_type
                }
            ]
        },
        "vectorEmbeddingPolicy": {
            "vectorEmbeddings": [
                {
                    "path": embedding_field,
                    "dataType": "float32",
                    "dimensions": dimensions,
                    "distanceFunction": "cosine"
                }
            ]
        }
    }


def create_containers(credential: DefaultAzureCredential, config: SampleConfig) -> None:
    """Create SQL containers with vector indexes using control-plane (ARM) SDK.

    Args:
        credential: Azure credential for authentication
        config: Sample configuration with resource details
    """
    client = CosmosDBManagementClient(
        credential=credential,
        subscription_id=config.subscription_id
    )

    embedding_path = f"/{config.embedding_field_name}"
    containers_config = [
        {"type": "diskANN", "container_name": "hotels_diskann"},
        {"type": "quantizedflat", "container_name": "hotels_quantizedflat"},
    ]

    for container_config in containers_config:
        print(f"\n=== Phase 1: Create Container with Vector Index ===")
        print(f"  Container:      {container_config['container_name']}")
        print(f"  Index type:     {container_config['type']}")
        print(f"  Dimensions:     {config.expected_dimensions}")
        print(f"  Distance func:  cosine (queried with all 3 metrics)")

        # Delete existing container to ensure clean state (idempotent)
        try:
            client.sql_resources.begin_delete_sql_container(
                resource_group_name=config.resource_group,
                account_name=config.account_name,
                database_name=config.database_name,
                container_name=container_config["container_name"]
            ).result()
            print(f"  Deleted existing container")
        except HttpResponseError as e:
            if e.status_code == 404:
                print(f"  Container does not exist (OK)")
            else:
                raise

        # Build container payload with vector index
        container_payload = _build_container_payload(
            container_name=container_config["container_name"],
            partition_key_path="/Region",
            embedding_field=embedding_path,
            dimensions=config.expected_dimensions,
            index_type=container_config["type"]
        )

        # Create container using raw payload
        # The ARM SDK accepts the payload as a dict, which it serializes to JSON
        params = {
            "resource": container_payload
        }

        client.sql_resources.begin_create_update_sql_container(
            resource_group_name=config.resource_group,
            account_name=config.account_name,
            database_name=config.database_name,
            container_name=container_config["container_name"],
            create_update_sql_container_parameters=params
        ).result()

        print(f"  Created in ~1s")
        print(f"  Vector index is IMMUTABLE — cannot be changed after creation")


def delete_containers(credential: DefaultAzureCredential, config: SampleConfig) -> None:
    """Delete SQL containers using control-plane (ARM) SDK.

    Args:
        credential: Azure credential for authentication
        config: Sample configuration with resource details
    """
    client = CosmosDBManagementClient(
        credential=credential,
        subscription_id=config.subscription_id
    )

    # Always try to delete both containers, regardless of which one is active
    container_names = ["hotels_diskann", "hotels_quantizedflat"]

    for container_name in container_names:
        try:
            # Delete container using ARM SDK
            client.sql_resources.begin_delete_sql_container(
                resource_group_name=config.resource_group,
                account_name=config.account_name,
                database_name=config.database_name,
                container_name=container_name
            ).result()  # Wait for async operation
            print(f"  ✓ Deleted {container_name}")
        except HttpResponseError as e:
            # 404 is expected if container doesn't exist — skip silently
            if e.status_code == 404:
                print(f"  ✓ {container_name} does not exist (OK)")
            else:
                raise
