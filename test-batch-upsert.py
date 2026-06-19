#!/usr/bin/env python3
"""Test script: Batch upsert with mixed partition keys.

Tests whether Cosmos DB Python SDK supports batch upsert operations
with documents that have different partition key values.
"""

import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, Sequence

from dotenv import load_dotenv
from azure.cosmos import CosmosClient
from azure.identity import DefaultAzureCredential, get_bearer_token_provider


def load_test_data() -> Sequence[Dict[str, Any]]:
    """Load hotel data from JSON file."""
    data_path = Path(__file__).parent / "data" / "HotelsData_toCosmosDB_Vector.json"
    with open(data_path, "r", encoding="utf-8") as f:
        return json.load(f)


def main() -> None:
    """Test batch upsert with mixed partition keys."""
    load_dotenv()

    # Get credentials
    endpoint = os.getenv("AZURE_COSMOSDB_ENDPOINT", "")
    if not endpoint:
        print("ERROR: AZURE_COSMOSDB_ENDPOINT not set")
        sys.exit(1)

    try:
        credential = DefaultAzureCredential()
        client = CosmosClient(url=endpoint, credential=credential)
    except Exception as e:
        print(f"ERROR: Failed to create Cosmos DB client: {e}")
        sys.exit(1)

    # Connect to test database and container
    db_name = "HotelsCreateIndex"
    container_name = "test_batch_upsert"

    try:
        database = client.get_database_client(db_name)
        print(f"[OK] Connected to database: {db_name}")
    except Exception as e:
        print(f"ERROR: Failed to connect to database: {e}")
        sys.exit(1)

    # Delete container if it exists (fresh start)
    try:
        database.delete_container(container_name)
        print(f"[OK] Deleted existing container: {container_name}")
    except Exception:
        pass  # Container doesn't exist, that's fine

    # Create simple container with HotelId as partition key (no vector index)
    try:
        indexing_policy = {
            "indexingMode": "consistent",
            "includedPaths": [{"path": "/*"}],
            "excludedPaths": [{"path": '/"_etag"/?'}],
        }

        container = database.create_container(
            id=container_name,
            partition_key="/HotelId",
            indexing_policy=indexing_policy,
        )
        print(f"[OK] Created simple container: {container_name}")
    except Exception as e:
        print(f"ERROR: Failed to create container: {e}")
        sys.exit(1)

    # Load test data
    documents = load_test_data()
    print(f"[OK] Loaded {len(documents)} documents")

    # Test 1: Try batch upsert with all documents
    print("\n=== Test 1: Batch Upsert with All Documents ===")
    try:
        batch = container.create_item_batch()
        for doc in documents:
            batch.add_upsert_item(body=doc)
        results = batch.execute()
        print(f"[OK] Batch upsert succeeded: {len(results)} operations completed")
        total_ru = sum(op.get("x-ms-request-charge", 0.0) for op in results)
        print(f"[OK] Total RU cost: {total_ru:.2f}")
    except Exception as e:
        print(f"[FAILED] Batch upsert failed: {type(e).__name__}: {e}")
        status_code = getattr(e, "status_code", None)
        if status_code == 400:
            print("     This is expected if batch requires same partition key")

    # Test 2: Try individual upserts (baseline)
    print("\n=== Test 2: Individual Upserts (Baseline) ===")
    try:
        total_ru = 0.0
        for i, doc in enumerate(documents[:5]):  # Just test first 5
            response = container.upsert_item(body=doc)
            ru = container.client_connection.last_response_headers.get("x-ms-request-charge", 0.0)
            total_ru += float(ru) if ru else 0.0
        print(f"[OK] Individual upserts succeeded (tested 5 docs)")
        print(f"[OK] Total RU cost for 5 docs: {total_ru:.2f}")
    except Exception as e:
        print(f"[FAILED] Individual upserts failed: {e}")

    # Cleanup
    try:
        database.delete_container(container_name)
        print(f"\n[OK] Cleaned up test container")
    except Exception as e:
        print(f"[WARN] Cleanup failed: {e}")


if __name__ == "__main__":
    main()
