---
title: Quickstart: Create and query vector indexes in Azure Cosmos DB for NoSQL using Python
description: Use Python and Azure SDK libraries to load pre-vectorized hotel documents into existing Azure Cosmos DB for NoSQL vector containers and query them with VectorDistance.
author: diberry
ms.author: diberry
ms.service: cosmos-db
ms.topic: quickstart
ms.date: 2026-06-09
---

# Quickstart: Create and query vector indexes in Azure Cosmos DB for NoSQL using Python

In this quickstart, you run the Python create-index sample for Azure Cosmos DB for NoSQL. The sample assumes `azd up` already created the `HotelsCreateIndex` database and the `hotels_diskann` and `hotels_quantizedflat` containers with their vector policies. Your code stays on the data plane: it loads pre-vectorized hotel documents, writes them to the existing containers using transactional batches, generates a query embedding with the Azure OpenAI client, and runs a `VectorDistance()` similarity query.

Find the sample code on GitHub in [`nosql-create-index-python`](https://github.com/Azure-Samples/cosmos-db-vector-samples/tree/main/nosql-create-index-python).

## Prerequisites

- An Azure subscription. If you don't have one, create a [free account](https://azure.microsoft.com/free/).
- [Azure CLI](/cli/azure/install-azure-cli) installed and signed in with `az login`.
- [Python 3.9 or later](https://www.python.org/downloads/).
- An Azure Cosmos DB for NoSQL account with vector search enabled.
- Existing resources created by `azd up` or the shared Bicep deployment:
  - database: `HotelsCreateIndex`
  - containers: `hotels_diskann` and `hotels_quantizedflat`
  - partition key path: `/PartitionKey`
  - vector field path: `/DescriptionVector`
- Microsoft Entra ID roles for your identity:
  - **Cosmos DB Built-in Data Contributor**
  - **Cognitive Services OpenAI User**
- An Azure OpenAI resource with a `text-embedding-3-small` deployment.

> [!IMPORTANT]
> This scenario is data-plane only. Do not add `create_database_if_not_exists`, `create_container_if_not_exists`, or any management-plane SDK calls. The sample expects the database and vector containers to already exist.
>
> This sample uses the `HotelsCreateIndex` database with partition key `/PartitionKey` (value: `"hotels"`). This is **not** the same as the `Hotels` database, which uses `/HotelId`. The Python sample inserts documents using transactional batches against a shared partition key.

## Clone the repository

```bash
git clone https://github.com/Azure-Samples/cosmos-db-vector-samples.git
cd cosmos-db-vector-samples/nosql-create-index-python
```

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
   AZURE_COSMOSDB_DATABASENAME="HotelsCreateIndex"
   AZURE_COSMOSDB_CONTAINER_NAME=""
   AZURE_OPENAI_EMBEDDING_ENDPOINT="https://<your-openai-resource>.openai.azure.com/"
   AZURE_OPENAI_EMBEDDING_DEPLOYMENT="text-embedding-3-small"
   AZURE_OPENAI_EMBEDDING_API_VERSION="2024-08-01-preview"
   VECTOR_ALGORITHM=""
   DATA_FILE_WITH_VECTORS="../data/HotelsData_toCosmosDB_Vector.json"
   ```

Leave `AZURE_COSMOSDB_CONTAINER_NAME` and `VECTOR_ALGORITHM` empty to run both containers automatically. The sample iterates over the known container names (`hotels_diskann` and `hotels_quantizedflat`) when no specific container is configured. If you set `VECTOR_ALGORITHM`, use one of these values:

- `diskann`
- `quantizedflat`

## Install dependencies and run the sample

Install the required packages:

```bash
pip install -r requirements.txt
```

Run the sample:

```bash
python -m src.index
```

The sample performs these steps:

1. Loads configuration from `.env` using `python-dotenv`.
1. Validates required environment variables.
1. Authenticates with `DefaultAzureCredential`.
1. Connects to the existing `HotelsCreateIndex` database and target containers.
1. Reads `../data/HotelsData_toCosmosDB_Vector.json`.
1. Verifies embedding dimensions match the container definition (1536).
1. Inserts documents using transactional batches (`execute_item_batch`) with partition key `"hotels"`.
1. Raises `RuntimeError` if any batch operations fail.
1. Generates a query embedding with the Azure OpenAI client.
1. Runs a parameterized `VectorDistance()` SQL query against each target container.
1. Prints the top 5 matching hotels.

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
│   ├── data_plane.py
│   └── index.py
└── tests/
```

## Key implementation details

### Load configuration and validate

`config.py` loads `.env` via `python-dotenv` and validates that all required variables are present:

```python
config = load_config()
validate_config(config)
```

### Connect with Microsoft Entra ID

The sample passes `DefaultAzureCredential` directly to `CosmosClient` and uses a bearer token provider for the `AzureOpenAI` client:

```python
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

The sample splits documents into chunks and uses `execute_item_batch` to insert each chunk atomically within the `"hotels"` partition:

```python
for batch in _chunked(documents, BATCH_SIZE):
    operations = [("upsert", (document,)) for document in batch]
    results = container.execute_item_batch(
        batch_operations=operations,
        partition_key="hotels",
    )
    for result in results:
        if int(result.get("statusCode", 0)) < 300:
            inserted_documents += 1
        else:
            failed_documents += 1
```

### Run the vector similarity query

The embedding field name is validated before it is interpolated into the query string. The embedding vector stays parameterized:

```python
query_text = (
    "SELECT TOP @topK c.HotelId, c.HotelName, c.Description, "
    "VectorDistance(c.{0}, @embedding) AS similarityScore "
    "FROM c WHERE c.PartitionKey = @partitionKey "
    "ORDER BY VectorDistance(c.{0}, @embedding)"
).format(embedding_field)

raw_results = list(
    container.query_items(
        query=query_text,
        parameters=[
            {"name": "@topK", "value": config.top_count},
            {"name": "@embedding", "value": list(query_embedding)},
            {"name": "@partitionKey", "value": config.partition_key_value},
        ],
        partition_key=config.partition_key_value,
    )
)
```

## Example output

```output
========================================================================
Azure Cosmos DB for NoSQL - create and query vector indexes with Python
========================================================================
Database: Hotels
Data file: .../data/HotelsData_toCosmosDB_Vector.json
Target containers: hotels_diskann, hotels_quantizedflat

=== Verify embedding dimensions ===
Deployment: text-embedding-3-small
Model:      text-embedding-3-small
Actual:     1536
Expected:   1536

=== Ingest documents: hotels_diskann ===
Inserted 50/50 documents using transactional batches. RU: 6812.47

=== Ingest documents: hotels_quantizedflat ===
Inserted 50/50 documents using transactional batches. RU: 6810.92

Query text: hotel near the ocean

=== Query results: hotels_diskann (DiskANN) ===
Request charge: 5.33 RUs
1. HotelId=11 | HotelName=Royal Cottage Resort | score=0.4991 | Description=Your home away from home...

=== Query results: hotels_quantizedflat (QuantizedFlat) ===
Request charge: 5.35 RUs
1. HotelId=11 | HotelName=Royal Cottage Resort | score=0.4991 | Description=Your home away from home...

========================================================================
Complete
========================================================================
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
