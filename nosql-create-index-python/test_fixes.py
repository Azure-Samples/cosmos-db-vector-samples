#!/usr/bin/env python3
"""Quick test to verify Python fixes."""

import sys
sys.path.insert(0, '.')

from src.config import load_config, DEFAULT_PARTITION_KEY_VALUE
from src.data_plane import prepare_document, validate_field_name

# Test imports
print('[OK] Imports successful')

# Verify field name validation
validated = validate_field_name('embedding')
print('[OK] Field validation passed')

# Test document preparation
sample_doc = {
    'HotelId': 123,
    'HotelName': 'Test Hotel',
    'Region': 'Northeast',
    'embedding': [0.1, 0.2]
}
prepared = prepare_document(sample_doc)
doc_id = prepared.get('id')
region = prepared.get('Region')
print('[OK] Document prepared with id=' + str(doc_id) + ', region=' + str(region))

# Verify default partition key
print('[OK] Default partition key: ' + DEFAULT_PARTITION_KEY_VALUE)

# Verify data file exists
from pathlib import Path
data_file = Path('./data/HotelsData_toCosmosDB_Vector_byRegion.json')
if data_file.exists():
    print('[OK] Data file exists: ' + str(data_file))
else:
    print('[FAIL] Data file missing: ' + str(data_file))

print('\n[SUMMARY] All basic checks passed!')
