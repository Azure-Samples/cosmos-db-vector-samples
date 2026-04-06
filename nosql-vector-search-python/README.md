<!--
---
page_type: sample
name: "Azure Cosmos DB NoSQL Vector Search with Python"
description: "This sample demonstrates how to use Azure Cosmos DB for NoSQL as a vector store for AI-powered semantic search applications. It shows how to generate embeddings with Azure OpenAI, store vectors in JSON documents, and query with VectorDistance for nearest neighbors."
urlFragment: nosql-vector-search-python
languages:
- python
products:
- azure
---
-->
# Azure Cosmos DB NoSQL Vector Search with Python

This project demonstrates how to use **Azure Cosmos DB for NoSQL** as a vector store for AI-powered semantic search applications. It shows how to generate embeddings with Azure OpenAI, store vectors in JSON documents, and query with `VectorDistance` for nearest neighbors.

## 📚 Table of Contents

- [Architecture Overview](#architecture-overview)
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Understanding Vector Search](#understanding-vector-search)
- [Vector Index Types](#vector-index-types)
- [Distance Metrics](#distance-metrics)
- [Code Examples](#code-examples)
- [Running the Samples](#running-the-samples)
- [Understanding Query Results](#understanding-query-results)
- [Troubleshooting](#troubleshooting)
- [Resources](#resources)

## 🏗️ Architecture Overview

```
┌──────────┐      Request embeddings      ┌───────────────┐
│   App    │ ─────────────────────────────> │ Azure OpenAI  │
└──────────┘                                └───────────────┘
     │                                              │
     │ Request AAD token                       Return vector
     │                                              │
     ▼                                              ▼
┌──────────────┐  Role assignment    ┌─────────────────────┐
│   Managed    │ ◄──────────────────>│   Cosmos DB NoSQL   │
│   Identity   │                      │   (Vector Store)    │
└──────────────┘                      └─────────────────────┘
     │                                        ▲
     │ AAD token                              │
     └────────────────────────────────────────┘
              Upsert doc with vector
              VectorDistance top-k query
```

The script will:
1. Connect to Azure Cosmos DB and Azure OpenAI using passwordless authentication
2. Load hotel documents with pre-computed vector embeddings
3. Bulk-insert documents into the selected container (DiskANN or QuantizedFlat)
4. Generate an embedding for a search query via Azure OpenAI
5. Execute a `VectorDistance()` SQL query for nearest-neighbor search
6. Display ranked results with similarity scores and RU cost

## ✨ Features

- **Passwordless authentication** using `DefaultAzureCredential` (managed identity / Azure CLI)
- **Key-based fallback** for local development
- **Two vector algorithms**: DiskANN and QuantizedFlat
- **Bulk insert** with RU (Request Unit) tracking
- **Field name validation** for injection safety
- **Configurable distance function**: cosine (default), euclidean, dotproduct
- **Shared data file** with the TypeScript sample

## 📋 Prerequisites

- **Python 3.9+**
- **Azure CLI** installed and logged in (`az login`)
- **Azure subscription** with:
  - Azure Cosmos DB for NoSQL account with vector search enabled
  - Azure OpenAI service with `text-embedding-3-small` model deployed
- **Cosmos DB containers** pre-created with **MultiHash** partition key on `/HotelId`:
  - `hotels_diskann` — container with DiskANN vector index policy
  - `hotels_quantizedflat` — container with QuantizedFlat vector index policy
- **RBAC roles** assigned:
  - **Cosmos DB**: Cosmos DB Built-in Data Contributor
  - **Azure OpenAI**: Cognitive Services OpenAI User

## 🚀 Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/Azure-Samples/cosmos-db-vector-samples.git
cd cosmos-db-vector-samples/nosql-vector-search-python
```

### 2. Create a virtual environment

```bash
python -m venv venv

# On macOS/Linux:
source venv/bin/activate

# On Windows:
venv\Scripts\activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure environment variables

If you provisioned resources with Azure Developer CLI (`azd`), generate your `.env` file from the deployed environment:

```bash
azd env get-values > .env
```

Otherwise, copy the template and fill in your Azure resource values manually:

```bash
cp sample.env .env
```

### 5. Authenticate with Azure

```bash
az login
```

## 🔍 Understanding Vector Search

Azure Cosmos DB for NoSQL supports vector search using the `VectorDistance()` SQL function. This function computes the distance between a stored vector and a query vector, enabling semantic similarity search directly in the database.

```sql
SELECT TOP 5
    c.HotelName,
    c.Description,
    c.Rating,
    VectorDistance(c.DescriptionVector, @embedding) AS SimilarityScore
FROM c
ORDER BY VectorDistance(c.DescriptionVector, @embedding)
```

## 📊 Vector Index Types

Cosmos DB for NoSQL supports two vector indexing algorithms optimized for different workloads.

### DiskANN (Recommended for Production at Scale)

**Best for:** Large datasets (millions of vectors), production workloads, low-latency requirements.

**Characteristics:**
- ⚡ Optimized for low latency and highly scalable workloads
- 📊 High recall with configurable trade-offs
- 💾 Efficient RU consumption at scale
- 📐 Supports up to 4096 dimensions
- 🎯 Ideal for RAG, semantic search, recommendations
- ✅ **Recommended for most production scenarios**

**Trade-offs:** Higher RU cost during indexing; slightly higher query cost than QuantizedFlat for small result sets.

### QuantizedFlat (Recommended for General Use)

**Best for:** Smaller datasets, balanced accuracy/performance, testing, exact nearest-neighbor search.

**Characteristics:**
- ⚙️ Brute-force similarity scan (scans all vectors)
- 📍 Highest accuracy — returns exact nearest neighbors
- 🎯 Simple configuration, no hyperparameter tuning
- 🔧 Predictable latency and RU consumption
- 💪 Suitable for datasets up to ~100K vectors

**Trade-offs:** Scans entire dataset for each query; higher query RU cost for large result sets.

### Comparison Table

| Algorithm | Best For | Trade-offs |
|-----------|----------|------------|
| **DiskANN** | Large datasets (millions of vectors) | High recall, low latency, higher RU for indexing |
| **QuantizedFlat** | Smaller datasets or exact results | Brute-force scan, highest accuracy, higher query RU |

> **Note:** HNSW and IVF algorithms are **not** supported by Cosmos DB NoSQL. Those algorithms are available in Azure Cosmos DB for MongoDB (DocumentDB).

## 📏 Distance Metrics

| Metric | Range | Interpretation |
|--------|-------|----------------|
| **cosine** (default) | [0, 2] | Lower = more similar |
| **euclidean** | [0, ∞] | Lower = more similar |
| **dotproduct** | [-∞, ∞] | Higher = more similar |

Set via the `VECTOR_DISTANCE_FUNCTION` environment variable.

## 💻 Code Examples

### Client initialization (passwordless)

```python
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from azure.cosmos import CosmosClient
from openai import AzureOpenAI

credential = DefaultAzureCredential()

# Azure OpenAI
token_provider = get_bearer_token_provider(
    credential, "https://cognitiveservices.azure.com/.default"
)
ai_client = AzureOpenAI(
    azure_endpoint=endpoint,
    azure_ad_token_provider=token_provider,
    api_version=api_version,
)

# Cosmos DB
db_client = CosmosClient(url=cosmos_endpoint, credential=credential)
```

### Vector search query

```python
from src.utils import validate_field_name

safe_field = validate_field_name("DescriptionVector")
query = (
    f"SELECT TOP 5 c.HotelName, c.Description, c.Rating, "
    f"VectorDistance(c.{safe_field}, @embedding) AS SimilarityScore "
    f"FROM c ORDER BY VectorDistance(c.{safe_field}, @embedding)"
)

results = list(container.query_items(
    query=query,
    parameters=[{"name": "@embedding", "value": embedding_vector}],
    enable_cross_partition_query=True,
))
```

## 🏃 Running the Samples

### Run with DiskANN (default)

```bash
python src/vector_search.py
```

Or explicitly:

```bash
# Linux/macOS
VECTOR_ALGORITHM=diskann python src/vector_search.py

# Windows (PowerShell)
$env:VECTOR_ALGORITHM="diskann"; python src/vector_search.py
```

### Run with QuantizedFlat

```bash
# Linux/macOS
VECTOR_ALGORITHM=quantizedflat python src/vector_search.py

# Windows (PowerShell)
$env:VECTOR_ALGORITHM="quantizedflat"; python src/vector_search.py
```

### Run with a different distance function

```bash
# Linux/macOS
VECTOR_ALGORITHM=diskann VECTOR_DISTANCE_FUNCTION=euclidean python src/vector_search.py

# Windows (PowerShell)
$env:VECTOR_ALGORITHM="diskann"; $env:VECTOR_DISTANCE_FUNCTION="euclidean"; python src/vector_search.py
```

### Expected output

```
Connected to database: Hotels
Connected to container: hotels_diskann

📊 Vector Search Algorithm: DiskANN
📏 Distance Function: cosine

Reading JSON file from ..\data\HotelsData_toCosmosDB_Vector.json
Container already has 50 documents. Skipping insert.

--- Executing Vector Search Query ---
Query: SELECT TOP 5 c.HotelName, c.Description, c.Rating, VectorDistance(c.DescriptionVector, @embedding) AS SimilarityScore FROM c ORDER BY VectorDistance(c.DescriptionVector, @embedding)
Parameters: @embedding (vector with 1536 dimensions)
--------------------------------------

--- Search Results ---
1. Stay-Kay City Hotel, Score: 0.9234
2. Countryside Hotel, Score: 0.8876
3. Royal Cottage Resort, Score: 0.8543
4. Winter Panorama Resort, Score: 0.8210
5. Luxury Lion Resort, Score: 0.7998

Vector Search Request Charge: 4.50 RUs
```

## 📊 Understanding Query Results

- **SimilarityScore**: The distance between the query vector and the document vector. Lower scores mean higher similarity (for cosine and euclidean distance).
- **Request Charge (RUs)**: The cost of the query in Azure Cosmos DB Request Units.

## 🔧 Troubleshooting

### Vector query return codes

| Status | Meaning | Typical causes | Fix |
| --- | --- | --- | --- |
| 200 | Query succeeded | n/a | n/a |
| 204 | No results | Query valid but no matches | Verify data and query text |
| 400 | Bad request | Wrong vector path, wrong dimensions, vector capability not enabled, invalid SQL | Check vector policy path/dimensions and account capability |
| 401 | Unauthorized | Missing or expired token | Re-authenticate via `az login`, check credential source |
| 403 | Forbidden | RBAC missing for data plane | Assign Cosmos DB Built-in Data Contributor role; re-authenticate via `az login` |
| 404 | Not found | Database or container name mismatch | Verify `AZURE_COSMOSDB_DATABASENAME`, `hotels_diskann`, and `hotels_quantizedflat` exist |
| 409 | Conflict | Write conflicts (not typical for queries) | Use unique IDs or retry write |
| 412 | Precondition failed | ETag mismatch | Refresh ETag or remove condition |
| 429 | Rate limited | RU throttling | Retry with backoff or increase container RU capacity |

### Common issues

| Problem | Solution |
|---------|----------|
| `DefaultAzureCredential` fails | Run `az login` or set `AZURE_COSMOSDB_KEY` + `AZURE_OPENAI_EMBEDDING_KEY` for key-based auth |
| Invalid algorithm error | Set `VECTOR_ALGORITHM` to `diskann` or `quantizedflat` |
| Module not found | Run from the `nosql-vector-search-python/` directory, not from `src/` |
| Vector query returns 400 | Verify vector policy matches `EMBEDDING_DIMENSIONS=1536`; check account has vector search enabled |

## 📚 Resources

- [Azure Cosmos DB Vector Search Documentation](https://learn.microsoft.com/azure/cosmos-db/nosql/vector-search)
- [VectorDistance() function reference](https://learn.microsoft.com/azure/cosmos-db/nosql/query/vectordistance)
- [Azure OpenAI Embeddings](https://learn.microsoft.com/azure/ai-services/openai/how-to/embeddings)
- [DefaultAzureCredential](https://learn.microsoft.com/python/api/azure-identity/azure.identity.defaultazurecredential)
- [azure-cosmos Python SDK](https://learn.microsoft.com/python/api/azure-cosmos/azure.cosmos)
