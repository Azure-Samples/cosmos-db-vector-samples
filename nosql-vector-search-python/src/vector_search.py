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


def _build_config() -> dict[str, str | int]:
    """Build runtime configuration from environment variables."""
    return {
        "query": "quintessential lodging near running trails, eateries, retail",
        "db_name": os.getenv("AZURE_COSMOSDB_DATABASENAME", "Hotels"),
        "algorithm": os.getenv("VECTOR_ALGORITHM", "diskann").strip().lower(),
        "data_file": os.getenv("DATA_FILE_WITH_VECTORS", "../data/HotelsData_toCosmosDB_Vector.json"),
        "embedded_field": os.getenv("EMBEDDED_FIELD", "DescriptionVector"),
        "embedding_dimensions": int(os.getenv("EMBEDDING_DIMENSIONS", "1536")),
        "deployment": os.getenv("AZURE_OPENAI_EMBEDDING_MODEL", "text-embedding-3-small"),
        "distance_function": os.getenv("VECTOR_DISTANCE_FUNCTION", "cosine"),
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
        print(f"📏 Distance Function: {config['distance_function']}")

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

        safe_field = validate_field_name(config["embedded_field"])
        query_text = (
            f"SELECT TOP 5 c.HotelName, c.Description, c.Rating, "
            f"VectorDistance(c.{safe_field}, @embedding) AS SimilarityScore "
            f"FROM c "
            f"ORDER BY VectorDistance(c.{safe_field}, @embedding)"
        )

        print("\n--- Executing Vector Search Query ---")
        print(f"Query: {query_text}")
        print(
            f"Parameters: @embedding (vector with {len(query_embedding)} dimensions)"
        )
        print("--------------------------------------\n")

        results = list(
            container.query_items(
                query=query_text,
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

    except Exception as error:
        print(f"App failed: {error}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
