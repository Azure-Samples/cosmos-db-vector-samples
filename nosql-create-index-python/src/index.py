"""Main orchestration for the nosql-create-index-python sample."""

from __future__ import annotations

import sys

from azure.identity import DefaultAzureCredential

from .config import algorithm_label, load_config, target_containers, validate_config
from .data_plane import (
    create_azure_openai_client,
    create_cosmos_client,
    diagnose_resources,
    generate_embedding,
    ingest_documents,
    query_top_matches,
    read_documents,
    verify_embedding_dimensions,
    wrap_runtime_error,
)


def main() -> None:
    config = load_config()
    validate_config(config)

    credential = DefaultAzureCredential()
    cosmos_client = create_cosmos_client(config, credential)
    openai_client = create_azure_openai_client(config, credential)
    database = cosmos_client.get_database_client(config.database_name)
    
    # Diagnose resources before proceeding
    diagnose_resources(cosmos_client, config)

    # --- Setup ---
    print("Using Azure OpenAI Embedding Deployment/Model: {0}".format(
        config.openai_embedding_deployment))
    print("Reading JSON file from {0}".format(config.data_file_with_vectors))

    try:
        verify_embedding_dimensions(openai_client, config)
        documents = read_documents(config.data_file_with_vectors)
        print("Loaded {0} documents".format(len(documents)))

        # --- Ingest ---
        print("Processing in batches of {0}...".format(len(documents)))
        for container_name in target_containers(config):
            container = database.get_container_client(container_name)
            summary = ingest_documents(container, container_name, documents)
            if summary.skipped:
                print("  \u2713 {0}: {1} documents already exist (skipped)".format(
                    container_name, summary.total_documents))
            else:
                print("  \u2713 {0}: {1} inserted ({2:.2f} RUs)".format(
                    container_name, summary.inserted_documents, summary.request_charge))

        # --- Query ---
        query_embedding = generate_embedding(
            openai_client, config, config.query_text
        )
        print("\nQuery: \"{0}\"".format(config.query_text))
        print("Embedding generated ({0} dimensions)".format(len(query_embedding)))
        print("\nRunning searches (top {0} results for each distance function)...".format(config.top_count))

        distance_functions = ["Cosine", "DotProduct", "Euclidean"]
        all_results = []
        for container_name in target_containers(config):
            container = database.get_container_client(container_name)
            for distance_function in distance_functions:
                summary = query_top_matches(
                    container=container,
                    container_name=container_name,
                    config=config,
                    query_embedding=query_embedding,
                    distance_function=distance_function,
                )
                label = algorithm_label(container_name)
                print("  ✓ {0} queried ({1:.2f} RUs)".format(container_name, summary.request_charge))
                all_results.append((label, distance_function, summary))

        # --- Comparison table ---
        print()
        print("| {0:<14} | {1:<11} | {2:<26} | {3:<6} | {4:<26} | {5:<6} | {6:<6} |".format(
            "Index Type", "Distance Function", "Top 1 Result", "Score", "Top 2 Result", "Score", "Diff"))
        print("|{0}|{1}|{2}|{3}|{4}|{5}|{6}|".format(
            "-" * 16, "-" * 19, "-" * 28, "-" * 8, "-" * 28, "-" * 8, "-" * 8))
        for label, distance_function, summary in all_results:
            top1_name = summary.results[0].hotel_name if len(summary.results) > 0 else ""
            top1_score = summary.results[0].score if len(summary.results) > 0 else 0.0
            top2_name = summary.results[1].hotel_name if len(summary.results) > 1 else ""
            top2_score = summary.results[1].score if len(summary.results) > 1 else 0.0
            diff = top1_score - top2_score
            print("| {0:<14} | {1:<17} | {2:<26} | {3:.4f} | {4:<26} | {5:.4f} | {6:.4f} |".format(
                label, distance_function, top1_name[:26], top1_score, top2_name[:26], top2_score, diff))

        print("\nComplete")
    except Exception as error:  # pragma: no cover - integration error path
        raise wrap_runtime_error(error) from error


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("\nError: {0}".format(error), file=sys.stderr)
        sys.exit(1)
