---
title: Quickstart: Create and query vector indexes in Azure Cosmos DB for NoSQL using Python
description: Create vector indexes in Azure Cosmos DB for NoSQL using Python and the ARM SDK. Load pre-vectorized hotel documents and compare vector distance functions (Cosine, DotProduct, Euclidean).
author: diberry
ms.author: diberry
ms.service: cosmos-db
ms.topic: quickstart
ms.date: 2026-06-22
---

# Quickstart: Create vector index in Azure Cosmos DB for NoSQL using Python

In this quickstart, you run the Python create-index sample for Azure Cosmos DB for NoSQL to demonstrate two key goals:

- **Goal 1 (Control Plane):** Use the ARM SDK to diagnose an existing `HotelsCreateIndex` database and recreate two vector-indexed containers: `hotels_diskann_py` (approximate search) and `hotels_quantizedflat_py` (QuantizedFlat uses vector quantization techniques).
- **Goal 2 (Distance Functions):** Compare how the same query embedding produces different scores and rankings when using different vector distance functions: Cosine, DotProduct, and Euclidean.

Find the sample code on GitHub in [`nosql-create-index-python`](https://github.com/Azure-Samples/cosmos-db-vector-samples/tree/main/nosql-create-index-python).

## Prerequisites

- An Azure subscription. If you don't have one, create a [free account](https://azure.microsoft.com/free/).
- [Azure CLI](/cli/azure/install-azure-cli) installed and signed in with `az login`.
- [Python 3.9 or later](https://www.python.org/downloads/).
- An Azure Cosmos DB for NoSQL account with vector search enabled.
- Microsoft Entra ID roles for your identity:
  - **Cosmos DB Built-in Data Contributor**
  - **Cognitive Services OpenAI User**
- An Azure OpenAI resource with a `text-embedding-3-small` deployment.

> [!IMPORTANT]
> **Two Phases:**
>
> 1. **Control Plane (Goal 1):** The sample uses the ARM SDK with `DefaultAzureCredential` to diagnose an existing database and recreate:
>    - Existing database: `HotelsCreateIndex`
>    - Containers: `hotels_diskann_py` (DiskANN index) and `hotels_quantizedflat_py` (QuantizedFlat index)
>    - Partition key path: `/Region` (valid values: `Northeast`, `Midwest`, `South`, `West`)
>    - Vector field path: `/embedding` (1536 dimensions, float32)
>
> 2. **Data Plane (Goal 2):** After containers are created, the sample:
>    - Loads pre-vectorized hotel documents
>    - Inserts them using Region-based transactional batches
>    - Generates a query embedding with Azure OpenAI
>    - Runs `VectorDistance()` queries with three distance functions: **Cosine**, **DotProduct**, and **Euclidean**
>    - Displays rankings for each distance function to show how results differ

## Clone the repository

```bash
git clone https://github.com/Azure-Samples/cosmos-db-vector-samples.git
cd cosmos-db-vector-samples/nosql-create-index-python
```

## Set up the data directory

The sample requires `HotelsData_toCosmosDB_Vector_byRegion.json` to be in a local `data/` subdirectory:

```bash
# Create the data directory if it doesn't exist
mkdir -p ./data

# Copy the data file from the shared location
cp ../HotelsData_toCosmosDB_Vector_byRegion.json ./data/
```

The sample expects the data file at: `./data/HotelsData_toCosmosDB_Vector_byRegion.json`

## Configure environment variables

1. Configure environment variables.

   **If you deployed with `azd up`:**

   ```bash
   azd env get-values > .env
   ```

   **Otherwise**, copy the template and fill in values from the Azure portal:

   ```bash
   cp .env.example .env
   ```

1. Update `.env` with your values:

   ```dotenv
   AZURE_COSMOSDB_ENDPOINT="https://<your-account>.documents.azure.com:443/"
   AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME="HotelsCreateIndex"
   AZURE_COSMOSDB_CONTAINER_NAME=""
   AZURE_SUBSCRIPTION_ID="<your-subscription-id>"
   AZURE_RESOURCE_GROUP="<your-resource-group>"
   AZURE_COSMOSDB_ACCOUNT_NAME="<your-account-name>"
   AZURE_OPENAI_EMBEDDING_ENDPOINT="https://<your-openai-resource>.openai.azure.com/"
   AZURE_OPENAI_EMBEDDING_DEPLOYMENT="text-embedding-3-small"
   AZURE_OPENAI_EMBEDDING_API_VERSION="2024-08-01-preview"
   VECTOR_ALGORITHM=""
   DATA_FILE_WITH_VECTORS_AND_REGIONS="./data/HotelsData_toCosmosDB_Vector_byRegion.json"
   ```

Leave `AZURE_COSMOSDB_CONTAINER_NAME` and `VECTOR_ALGORITHM` empty to run both containers automatically. The sample iterates over the known container names (`hotels_diskann_py` and `hotels_quantizedflat_py`) when no specific container is configured. If you set `VECTOR_ALGORITHM`, use one of these values:

- `diskann`
- `quantizedflat`

## Install dependencies and run the sample

Create a virtual environment and install the required packages:

```bash
# Create a virtual environment
python -m venv .venv

# Activate the virtual environment
# On Windows:
.\.venv\Scripts\Activate.ps1
# On macOS/Linux:
source .venv/bin/activate

# Install the required packages
pip install -r requirements.txt

# Install the control-plane SDK used by src/control_plane.py
pip install azure-mgmt-cosmosdb
```

Run the sample:

```bash
python -m src.index
```

**What the sample does:**

The sample demonstrates both goals in sequence:

**Goal 1 - Control Plane (create containers with vector indexes):**
1. Authenticates with `DefaultAzureCredential`
2. Diagnoses the existing `HotelsCreateIndex` database
3. Deletes and recreates the `hotels_diskann_py` container with DiskANN vector index on `/embedding`
4. Deletes and recreates the `hotels_quantizedflat_py` container with QuantizedFlat vector index on `/embedding`

**Goal 2 - Data Plane (load and query with distance functions):**
1. Loads pre-vectorized hotel documents from `./data/HotelsData_toCosmosDB_Vector_byRegion.json`
2. Verifies embedding dimensions match the container definition (1536 dimensions)
3. Groups documents by Region and inserts them using transactional batches
4. Generates a query embedding with the Azure OpenAI client
5. Runs **three separate `VectorDistance()` queries** with different distance functions:
   - **Cosine:** Measures angle between vectors (values: 0 to 2)
   - **DotProduct:** Inner product of vectors (values: any real number)
   - **Euclidean:** Straight-line distance between vectors (values: 0 to √6144)
6. Displays the top 5 matching hotels for each distance function, showing how rankings differ

## Understand the project structure

The sample has the following structure:

```text
nosql-create-index-python/
├── .env.example
├── README.md
├── requirements.txt
├── output/
│   └── sample-output.txt
├── src/
│   ├── __init__.py
│   ├── config.py
│   ├── control_plane.py
│   ├── data_plane.py
│   └── index.py
└── tests/
```

## Key implementation details

### Goal 1: Create containers with vector indexes using ARM SDK

The control-plane phase uses the ARM SDK to create containers with vector policies. The vector index policy specifies the embedding field path, dimensions, and distance function:

```python
def _build_container_payload(
    container_name: str,
    partition_key_path: str,
    embedding_field: str,
    dimensions: int,
    index_type: str
) -> dict[str, Any]:
    """Build container creation payload with vector index configuration."""
    return {
        "id": container_name,
        "partitionKey": {
            "paths": [partition_key_path],
            "kind": "Hash"
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
        },
        "indexingPolicy": {
            "indexingMode": "Consistent",
            "automatic": True,
            "includedPaths": [{"path": "/*"}],
            "excludedPaths": [{"path": "/_etag/?"}],
            "vectorIndexes": [
                {
                    "path": embedding_field,
                    "type": index_type  # "diskANN" or "quantizedflat"
                }
            ]
        }
    }
```

### Goal 2: Load configuration and authenticate

Configuration is loaded from environment variables. `DefaultAzureCredential` handles Microsoft Entra ID authentication:

```python
config = load_config()
validate_config(config)

credential = DefaultAzureCredential()
cosmos_client = CosmosClient(url=config.cosmos_endpoint, credential=credential)

token_provider = get_bearer_token_provider(
    credential, "https://cognitiveservices.azure.com/.default"
)
openai_client = AzureOpenAI(
    azure_endpoint=config.openai_embedding_endpoint,
    azure_ad_token_provider=token_provider,
    api_version=config.openai_embedding_api_version,
)
```

### Insert documents using transactional batches

The sample groups documents by `Region` and uses `execute_item_batch` to insert one transactional batch per region:

```python
docs_by_region = _group_by_region(documents)

for region, region_docs in docs_by_region.items():
    operations = [("upsert", (document,)) for document in region_docs]
    results = container.execute_item_batch(
        batch_operations=operations,
        partition_key=region,
    )
```

### Run vector similarity queries with different distance functions

After inserting documents, the sample generates a query embedding and runs **three separate queries** — one for each distance function. The embedding field name is validated before being interpolated. `ORDER BY VectorDistance(...)` is required to rank results by similarity; without it, `SELECT TOP N` returns N arbitrary documents, not the nearest neighbors.

Scope the vector query to a single partition by passing the partition key through the Python SDK query option. Cosmos DB routes the request to the one physical partition that owns that region, so a `WHERE c.Region = ...` filter is unnecessary. This keeps the SQL focused on `ORDER BY VectorDistance(...)` for ranking and is the recommended, most efficient pattern for single-partition vector search:

```python
# Query with Cosine distance
query_text = (
    "SELECT TOP @topK c.HotelId, c.HotelName, c.Region, "
    "VectorDistance(c.{0}, @embedding, false, {{'distanceFunction': 'Cosine'}}) AS similarityScore "
    "FROM c "
    "ORDER BY VectorDistance(c.{0}, @embedding, false, {{'distanceFunction': 'Cosine'}})"
).format(embedding_field)

results_cosine = list(container.query_items(
    query=query_text,
    parameters=[
        {"name": "@topK", "value": 5},
        {"name": "@embedding", "value": list(query_embedding)},
    ],
    partition_key="Northeast",
))

# Repeat with 'DotProduct' and 'Euclidean' to compare rankings
```

## Example output

```output
=== Diagnostic Check ===
Cosmos DB Endpoint: https://<your-account>.documents.azure.com:443/
Database name: HotelsCreateIndex
✓ Database 'HotelsCreateIndex' exists
  Containers found: 2

=== Control Plane ===

=== Phase 1: Create Container with Vector Index ===
  Container:      hotels_diskann_py
  Index type:     diskANN
  Dimensions:     1536
  Distance func:  cosine (queried with all 3 metrics)
  Deleted existing container
  Created in ~1s
  Vector index is IMMUTABLE — cannot be changed after creation

=== Phase 1: Create Container with Vector Index ===
  Container:      hotels_quantizedflat_py
  Index type:     QuantizedFlat
  Dimensions:     1536
  Distance func:  cosine (queried with all 3 metrics)
  Deleted existing container
  Created in ~1s
  Vector index is IMMUTABLE — cannot be changed after creation
Using Azure OpenAI Embedding Deployment/Model: text-embedding-3-small
Reading JSON file from ...\data\HotelsData_toCosmosDB_Vector_byRegion.json
Loaded 50 documents
Processing in batches of 50...
✓ Region validation passed. Found regions: ['Midwest', 'Northeast', 'South', 'West']
  Region 'Midwest': 10 documents
  Region 'Northeast': 10 documents
  Region 'South': 14 documents
  Region 'West': 16 documents
  ✓ hotels_diskann_py: 50 inserted (5243.72 RUs)
✓ Region validation passed. Found regions: ['Midwest', 'Northeast', 'South', 'West']
  Region 'Midwest': 10 documents
  Region 'Northeast': 10 documents
  Region 'South': 14 documents
  Region 'West': 16 documents
  ✓ hotels_quantizedflat_py: 50 inserted (2621.86 RUs)

Query: "hotel near the ocean"
Embedding generated (1536 dimensions)

Running searches (top 5 results for each distance function)...
  ✓ hotels_diskann_py queried (4.73 RUs)
  ✓ hotels_diskann_py queried (4.73 RUs)
  ✓ hotels_diskann_py queried (4.73 RUs)
  ✓ hotels_quantizedflat_py queried (4.73 RUs)
  ✓ hotels_quantizedflat_py queried (4.73 RUs)
  ✓ hotels_quantizedflat_py queried (4.73 RUs)

| Index Type     | Distance Function | Top 1 Result               | Score  | Top 2 Result               | Score  | Diff   |
|----------------|-------------------|----------------------------|--------|----------------------------|--------|--------|
| DiskANN        | Cosine            | City Center Summer Wind Re | 0.4025 | Red Tide Hotel             | 0.4000 | 0.0025 |
| DiskANN        | DotProduct        | City Center Summer Wind Re | 0.4027 | Red Tide Hotel             | 0.4001 | 0.0025 |
| DiskANN        | Euclidean         | City Center Summer Wind Re | 1.0934 | Red Tide Hotel             | 1.0957 | -0.0023 |
| QuantizedFlat  | Cosine            | City Center Summer Wind Re | 0.4025 | Red Tide Hotel             | 0.4000 | 0.0025 |
| QuantizedFlat  | DotProduct        | City Center Summer Wind Re | 0.4027 | Red Tide Hotel             | 0.4001 | 0.0025 |
| QuantizedFlat  | Euclidean         | City Center Summer Wind Re | 1.0934 | Red Tide Hotel             | 1.0957 | -0.0023 |

=== Phase 4: Cleanup ===
  ✓ Deleted hotels_diskann_py
  ✓ Deleted hotels_quantizedflat_py

Complete
```

## Troubleshooting

| Issue | Resolution |
|-------|-----------|
| `ConfigError: Missing required environment variables` | Verify `.env` file exists and all required variables are set. Run `cp .env.example .env` and fill in values. |
| `CosmosHttpResponseError: 403 Forbidden` | Confirm your identity has the **Cosmos DB Built-in Data Contributor** role on the Cosmos DB account. RBAC propagation can take several minutes. |
| `RuntimeError: Batch ingestion incomplete` | One or more documents failed to insert. Check container capacity and document size limits. Documents must be less than 2 MB each. |
| `ValueError: Embedding dimensions do not match` | The deployment returns a different vector size than the container expects (1536). Verify you're using `text-embedding-3-small` without dimension truncation. |
| `openai.AuthenticationError: 401` | Confirm your identity has the **Cognitive Services OpenAI User** role on the Azure OpenAI resource. |

## Next steps

- Review the sample output in `output/sample-output.txt`.
- Try `VECTOR_ALGORITHM=diskann` or `VECTOR_ALGORITHM=quantizedflat` to focus on one container.
- Learn more about Azure Cosmos DB vector search at `/azure/cosmos-db/nosql/vector-search`.
