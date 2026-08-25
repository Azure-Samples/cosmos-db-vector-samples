"""Control-plane operations for Cosmos DB SQL (NoSQL) API using ARM SDK.

Uses the typed request models provided by azure-mgmt-cosmosdb v10.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from azure.core.exceptions import HttpResponseError
from azure.identity import DefaultAzureCredential
from azure.mgmt.cosmosdb import CosmosDBManagementClient
from azure.mgmt.cosmosdb.models import (
    ContainerPartitionKey,
    ExcludedPath,
    IncludedPath,
    IndexingPolicy,
    SqlContainerCreateUpdateParameters,
    SqlContainerResource,
    VectorEmbedding,
    VectorEmbeddingPolicy,
    VectorIndex,
)

if TYPE_CHECKING:
    from .config import SampleConfig


def _build_container_create_parameters(
    container_name: str,
    partition_key_path: str,
    embedding_field: str,
    dimensions: int,
    index_type: str,
    location: str,
) -> SqlContainerCreateUpdateParameters:
    resource = SqlContainerResource(
        id=container_name,
        partition_key=ContainerPartitionKey(
            paths=[partition_key_path],
            kind="Hash",
        ),
        indexing_policy=IndexingPolicy(
            indexing_mode="Consistent",
            automatic=True,
            included_paths=[IncludedPath(path="/*")],
            excluded_paths=[
                ExcludedPath(path="/_etag/?"),
                ExcludedPath(path=f"{embedding_field}/*"),
            ],
            vector_indexes=[
                VectorIndex(path=embedding_field, type=index_type),
            ],
        ),
        vector_embedding_policy=VectorEmbeddingPolicy(
            vector_embeddings=[
                VectorEmbedding(
                    path=embedding_field,
                    data_type="float32",
                    dimensions=dimensions,
                    distance_function="cosine",
                ),
            ],
        ),
    )
    return SqlContainerCreateUpdateParameters(
        resource=resource,
        location=location,
    )


def create_containers(credential: DefaultAzureCredential, config: SampleConfig) -> None:
    """Create SQL containers with vector indexes using control-plane (ARM) SDK.

    Args:
        credential: Azure credential for authentication
        config: Sample configuration with resource details
    """
    from .config import validate_container_deletion_targets

    validate_container_deletion_targets(config)
    client = CosmosDBManagementClient(
        credential=credential,
        subscription_id=config.subscription_id
    )

    embedding_path = f"/{config.embedding_field_name}"
    containers_config = [
        {"type": "diskANN", "container_name": config.diskann_container_name},
        {"type": "quantizedFlat", "container_name": config.quantizedflat_container_name},
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

        params = _build_container_create_parameters(
            container_name=container_config["container_name"],
            partition_key_path="/Region",
            embedding_field=embedding_path,
            dimensions=config.expected_dimensions,
            index_type=container_config["type"],
            location=config.location,
        )

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
    from .config import validate_container_deletion_targets

    validate_container_deletion_targets(config)
    client = CosmosDBManagementClient(
        credential=credential,
        subscription_id=config.subscription_id
    )

    container_names = [
        config.diskann_container_name,
        config.quantizedflat_container_name,
    ]

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
