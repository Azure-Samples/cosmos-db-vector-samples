"""Azure Cosmos DB NoSQL Vector Search — main entry point.

Loads hotel data, bulk-inserts into the selected container (DiskANN or
QuantizedFlat), generates a query embedding via Azure OpenAI, and
executes a VectorDistance() similarity search.
"""

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).parent))

from utils import (
    get_clients_passwordless,
    get_clients,
    insert_data,
    print_search_results,
    read_file_return_json,
    validate_field_name,
    get_query_activity_id,
)

# ---------------------------------------------------------------------------
# Load environment
# ---------------------------------------------------------------------------
load_dotenv()

ALGORITHM_CONFIGS: dict[str, dict[str, str]] = {
    "diskann": {
        "container_name": "hotels_diskann",
        "algorithm_name": "DiskANN",
    },
    "quantizedflat": {
        "container_name": "hotels_quantizedflat",
        "algorithm_name": "QuantizedFlat",
    },
}


VALID_DISTANCE_FUNCTIONS = ["cosine", "euclidean", "dotproduct"]


def _build_config() -> dict[str, str | int | bool]:
    """Build runtime configuration from environment variables."""
    distance_func = os.getenv("VECTOR_DISTANCE_FUNCTION", "cosine").strip().lower()
    if distance_func not in VALID_DISTANCE_FUNCTIONS:
        valid = ", ".join(VALID_DISTANCE_FUNCTIONS)
        raise ValueError(
            f"Invalid distance function '{distance_func}'. Must be one of: {valid}"
        )
    
    return {
        "query": "quintessential lodging near running trails, eateries, retail",
        "db_name": os.getenv("AZURE_COSMOSDB_DATABASENAME", "Hotels"),
        "algorithm": os.getenv("VECTOR_ALGORITHM", "diskann").strip().lower(),
        "data_file": os.getenv("DATA_FILE_WITH_VECTORS", "../data/HotelsData_toCosmosDB_Vector.json"),
        "embedded_field": os.getenv("EMBEDDED_FIELD", "DescriptionVector"),
        "embedding_dimensions": int(os.getenv("EMBEDDING_DIMENSIONS", "1536")),
        "deployment": os.getenv("AZURE_OPENAI_EMBEDDING_MODEL", "text-embedding-3-small"),
        "distance_function": distance_func,
        "compare_all_metrics": os.getenv("COMPARE_DISTANCE_METRICS", "false").lower() == "true",
    }


def main() -> None:
    """Run the vector search demonstration."""
    config = _build_config()

    # Try passwordless auth first, fall back to key-based
    clients = get_clients_passwordless()
    if not clients["ai_client"] or not clients["db_client"]:
        clients = get_clients()

    ai_client = clients["ai_client"]
    db_client = clients["db_client"]

    try:
        algorithm = config["algorithm"]
        if algorithm not in ALGORITHM_CONFIGS:
            valid = ", ".join(ALGORITHM_CONFIGS)
            raise ValueError(
                f"Invalid algorithm '{algorithm}'. Must be one of: {valid}"
            )

        if not ai_client:
            raise RuntimeError(
                "Azure OpenAI client is not configured. "
                "Please check your environment variables."
            )
        if not db_client:
            raise RuntimeError(
                "Cosmos DB client is not configured. "
                "Please check your environment variables."
            )

        algo_cfg = ALGORITHM_CONFIGS[algorithm]
        container_name = algo_cfg["container_name"]

        database = db_client.get_database_client(config["db_name"])
        print(f"Connected to database: {config['db_name']}")

        container = database.get_container_client(container_name)
        print(f"Connected to container: {container_name}")
        print(f"\n📊 Vector Search Algorithm: {algo_cfg['algorithm_name']}")

        # Verify the container exists
        try:
            container.read()
        except Exception as e:
            status_code = getattr(e, "status_code", None)
            if status_code == 404:
                raise RuntimeError(
                    f"Container or database not found. Ensure database "
                    f"'{config['db_name']}' and container '{container_name}' "
                    f"exist before running this script."
                ) from e
            raise

        data_path = Path(__file__).parent.parent / config["data_file"]
        data = read_file_return_json(str(data_path))
        insert_data(container, data)

        embedding_response = ai_client.embeddings.create(
            model=config["deployment"],
            input=[config["query"]],
        )
        query_embedding = embedding_response.data[0].embedding
        print(f"\n📊 Embedding generated: type={type(query_embedding)}, length={len(query_embedding)}, first_3_elements={query_embedding[:3]}")

        safe_field = validate_field_name(config["embedded_field"])
        
        # Run comparison if enabled, otherwise single metric
        if config["compare_all_metrics"]:
            _run_metric_comparison(
                container, safe_field, query_embedding, 
                config["query"], query_embedding
            )
        else:
            _run_single_metric_query(
                container, safe_field, query_embedding,
                config["distance_function"], config["query"]
            )

    except Exception as error:
        print(f"App failed: {error}", file=sys.stderr)
        sys.exit(1)


def _run_single_metric_query(
    container, safe_field: str, query_embedding: list, 
    distance_function: str, query_text: str
) -> None:
    """Execute vector search with a single distance metric."""
    print(f"📏 Distance Function: {distance_function}")
    
    query = (
        f'SELECT TOP 5 c.HotelName, c.Description, c.Rating, '
        f'VectorDistance(c.{safe_field}, @embedding, false, {{"distanceFunction": "{distance_function}"}}) AS SimilarityScore '
        f'FROM c '
        f'ORDER BY VectorDistance(c.{safe_field}, @embedding, false, {{"distanceFunction": "{distance_function}"}})'
    )

    print("\n--- Executing Vector Search Query ---")
    print(f"Query: {query}")
    print(
        f"Parameters: @embedding (vector with {len(query_embedding)} dimensions)"
    )
    print("--------------------------------------\n")

    results = list(
        container.query_items(
            query=query,
            parameters=[{"name": "@embedding", "value": query_embedding}],
            enable_cross_partition_query=True,
        )
    )

    # Extract diagnostics
    response_headers = container.client_connection.last_response_headers
    activity_id = get_query_activity_id(response_headers)
    if activity_id:
        print(f"Query activity ID: {activity_id}")

    request_charge_raw = response_headers.get("x-ms-request-charge", "0") if response_headers else "0"
    try:
        request_charge = float(request_charge_raw)
    except (ValueError, TypeError):
        request_charge = 0.0

    print_search_results(results, request_charge)


def _run_metric_comparison(
    container, safe_field: str, query_embedding: list,
    query_text: str, embedding: list
) -> None:
    """Execute vector search with all 3 distance metrics and display comparison."""
    print("📏 Comparing all distance functions: cosine, euclidean, dotproduct\n")
    
    metrics = ["cosine", "euclidean", "dotproduct"]
    metric_display_names = {"cosine": "Cosine", "euclidean": "Euclidean", "dotproduct": "DotProduct"}
    all_results = {}
    total_charge = 0.0
    
    for metric in metrics:
        display_name = metric_display_names[metric]
        print(f"\n--- {display_name} Distance Search ---")
        
        query = (
            f'SELECT TOP 5 c.HotelName, c.Description, c.Rating, '
            f'VectorDistance(c.{safe_field}, @embedding, false, {{"distanceFunction": "{metric}"}}) AS SimilarityScore '
            f'FROM c '
            f'ORDER BY VectorDistance(c.{safe_field}, @embedding, false, {{"distanceFunction": "{metric}"}})'
        )
        
        print(f"\n--- Query for {display_name} ---")
        print(f"Query: {query}")
        print(f"Embedding param type: {type(query_embedding)}, length: {len(query_embedding)}")
        
        results = list(
            container.query_items(
                query=query,
                parameters=[{"name": "@embedding", "value": query_embedding}],
                enable_cross_partition_query=True,
            )
        )
        
        # Extract diagnostics
        response_headers = container.client_connection.last_response_headers
        request_charge_raw = response_headers.get("x-ms-request-charge", "0") if response_headers else "0"
        try:
            request_charge = float(request_charge_raw)
        except (ValueError, TypeError):
            request_charge = 0.0
        
        total_charge += request_charge
        all_results[metric] = {
            "results": results,
            "charge": request_charge
        }
        
        print_search_results(results, request_charge)
    
    # Print comparison summary
    print("\n" + "="*80)
    print("📊 DISTANCE METRIC COMPARISON SUMMARY")
    print("="*80)
    
    for metric in metrics:
        display_name = metric_display_names[metric]
        charge = all_results[metric]["charge"]
        print(f"\n{display_name}:")
        print(f"  Request Charge: {charge:.2f} RUs")
        if all_results[metric]["results"]:
            top_result = all_results[metric]["results"][0]
            print(f"  Top Result: {top_result.get('HotelName', 'N/A')} (Score: {top_result.get('SimilarityScore', 'N/A'):.4f})")
    
    print(f"\nTotal Request Charge (all 3 metrics): {total_charge:.2f} RUs")
    print("="*80)


if __name__ == "__main__":
    main()
