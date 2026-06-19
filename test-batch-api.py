#!/usr/bin/env python3
"""Test script: Analyze batch API capability for mixed partition keys.

This script tests whether the Cosmos DB Python SDK's batch API can handle
operations on documents with different partition key values.
"""

import json
from pathlib import Path
from typing import Any, Dict, Sequence


def load_test_data() -> Sequence[Dict[str, Any]]:
    """Load hotel data from JSON file."""
    data_path = Path(__file__).parent / "nosql-create-index-python" / "data" / "HotelsData_toCosmosDB_Vector.json"
    if not data_path.exists():
        print(f"ERROR: Data file not found: {data_path}")
        return []
    with open(data_path, "r", encoding="utf-8") as f:
        return json.load(f)


def analyze_partition_keys(documents: Sequence[Dict[str, Any]]) -> None:
    """Analyze partition key distribution in documents."""
    partition_keys = set()
    for doc in documents:
        pk = doc.get("HotelId", "UNKNOWN")
        partition_keys.add(pk)
    
    print(f"Total documents: {len(documents)}")
    print(f"Unique partition keys (HotelId): {len(partition_keys)}")
    print(f"Sample partition keys: {sorted(list(partition_keys))[:5]}")
    print()
    
    if len(partition_keys) > 1:
        print("[RESULT] Documents have MULTIPLE partition key values")
        print("  This means Cosmos DB transactional batch CANNOT be used")
        print("  (transactional batch requires ALL items to share SAME partition key)")
        print()
        print("  ALTERNATIVES:")
        print("  1. Individual upserts (current approach) — simple, works, slow")
        print("  2. Bulk operations (if available) — may not require same partition key")
        print("  3. Batch by partition key — group docs by HotelId, then batch each group")
    else:
        print("[RESULT] Documents have SINGLE partition key value")
        print("  Transactional batch CAN be used")


def test_batch_operations_api() -> None:
    """Demonstrate batch operations API signature."""
    print("=== Batch API Signature ===")
    print("From azure.cosmos:")
    print()
    print("  batch = container.create_item_batch()")
    print("  batch.add_upsert_item(body=doc)")
    print("  batch.add_create_item(body=doc)")
    print("  batch.add_replace_item(item_id, body=doc)")
    print("  results = batch.execute()")
    print()
    print("Cosmos DB Transactional Batch Limitations:")
    print("  - ALL operations in batch must target SAME partition key")
    print("  - Batch fails atomically (all-or-nothing)")
    print("  - Cannot use multiple partition key values in single batch")
    print("  - Exceeds batch size limit (~100KB) = error")
    print()
    print("Conclusion: For documents with different partition keys,")
    print("individual upserts are the ONLY option with transactional guarantees.")
    print()


def main() -> None:
    """Analyze batch operations feasibility."""
    print("=== Batch Upsert Feasibility Analysis ===\n")
    
    documents = load_test_data()
    if not documents:
        print("ERROR: Could not load test data")
        return
    
    analyze_partition_keys(documents)
    print()
    test_batch_operations_api()


if __name__ == "__main__":
    main()
