"""Main orchestration for the nosql-create-index-python sample."""

from __future__ import annotations

import sys

from azure.identity import DefaultAzureCredential

from .config import algorithm_label, load_config, target_containers, validate_config
from .data_plane import (
    create_azure_openai_client,
    create_cosmos_client,
    generate_embedding,
    ingest_documents,
    print_query_summary,
    query_top_matches,
    read_documents,
    verify_embedding_dimensions,
    wrap_runtime_error,
)


def main() -> None:
    config = load_config()
    validate_config(config)

    print("=" * 72)
    print("Azure Cosmos DB for NoSQL - create and query vector indexes with Python")
    print("=" * 72)
    print("Database: {0}".format(config.database_name))
    print("Data file: {0}".format(config.data_file_with_vectors))
    print("Target containers: {0}".format(", ".join(target_containers(config))))

    credential = DefaultAzureCredential()
    cosmos_client = create_cosmos_client(config, credential)
    openai_client = create_azure_openai_client(config, credential)
    database = cosmos_client.get_database_client(config.database_name)

    try:
        verify_embedding_dimensions(openai_client, config)
        documents = read_documents(config.data_file_with_vectors)

        for container_name in target_containers(config):
            container = database.get_container_client(container_name)
            ingest_documents(container, container_name, documents)

        query_embedding = generate_embedding(
            openai_client, config, config.query_text
        )
        print("\nQuery text: {0}".format(config.query_text))

        for container_name in target_containers(config):
            container = database.get_container_client(container_name)
            summary = query_top_matches(
                container=container,
                container_name=container_name,
                config=config,
                query_embedding=query_embedding,
            )
            print_query_summary(summary, algorithm_label(container_name))

        print("\n" + "=" * 72)
        print("Complete")
        print("=" * 72)
    except Exception as error:  # pragma: no cover - integration error path
        raise wrap_runtime_error(error) from error


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("\nError: {0}".format(error), file=sys.stderr)
        sys.exit(1)
