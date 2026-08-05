<!--
---
page_type: sample
name: "Azure Cosmos DB NoSQL create index sample for Go"
description: "This sample demonstrates Azure Cosmos DB for NoSQL vector index creation and vector queries in Go using ARM SDK control-plane operations and data-plane operations."
urlFragment: nosql-create-index-go
languages:
- go
products:
- azure-cosmos-db
---
-->
# Azure Cosmos DB for NoSQL create index sample (Go)

## Overview

This sample demonstrates the full `nosql-create-index` scenario in Go. The sample uses the ARM SDK control plane to create the `HotelsCreateIndex` database and the `hotels_diskann_go` and `hotels_quantizedflat_go` containers with vector indexes, then uses data-plane operations to:

- authenticate with `DefaultAzureCredential`
- load hotel documents from the shared dataset
- use `Region` as the partition key during ingestion
- write documents to both containers with bounded sequential creates
- generate an embedding with the Azure OpenAI embeddings REST API by using a bearer token from `DefaultAzureCredential`
- run a `SELECT TOP 5 ... ORDER BY VectorDistance(...)` query against both containers
- delete both containers during cleanup

The sample creates and deletes containers in code by using the Azure Cosmos DB ARM SDK.

## Prerequisites

- Go 1.23 or later
- Azure CLI with a signed-in account: `az login`
- An Azure Cosmos DB for NoSQL account with vector search enabled
- Permissions for your identity to create and delete SQL databases and containers in the Azure Cosmos DB account
- Cosmos DB data-plane access to create and query items
- An Azure OpenAI embedding deployment for `text-embedding-3-small`

## Setup

1. Change to the sample directory:

   ```powershell
   Set-Location .\nosql-create-index-go
   ```

2. Populate environment variables. The Go code calls `os.Getenv` directly and doesn't load `.env` files automatically, so export or set these values in your shell before running the sample.

   **If you deployed with `azd up`:**

   ```powershell
   azd env get-values > .env
   ```

   **Otherwise**, copy the template and fill in values from the Azure portal:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Set the canonical environment variables:

   | Variable | Example value |
   |---|---|
   | `AZURE_COSMOSDB_ENDPOINT` | `https://<account>.documents.azure.com:443/` |
   | `AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME` | `HotelsCreateIndex` |
   | `AZURE_COSMOSDB_CONTAINER_NAME` | Optional. `hotels_diskann_go` or `hotels_quantizedflat_go` |
   | `AZURE_OPENAI_EMBEDDING_ENDPOINT` | `https://<resource>.openai.azure.com/` |
   | `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | `text-embedding-3-small` |
   | `VECTOR_ALGORITHM` | Optional. `diskann` or `quantizedflat` |
   | `AZURE_COSMOSDB_CREATE_INDEX_EMBEDDED_FIELD` | `embedding` |
   | `DATA_FILE_WITH_VECTORS_AND_REGIONS` | `..\data\HotelsData_toCosmosDB_Vector_byRegion.json` |
   | `AZURE_SUBSCRIPTION_ID` | Your Azure subscription ID |
   | `AZURE_RESOURCE_GROUP` | Resource group for the Cosmos DB account |
   | `AZURE_COSMOSDB_ACCOUNT_NAME` | Cosmos DB account name |
   | `AZURE_LOCATION` | Azure region for the database and containers |

   Leave both `AZURE_COSMOSDB_CONTAINER_NAME` and `VECTOR_ALGORITHM` empty to run both containers. If you set both, they must match:

   - `diskann` → `hotels_diskann_go`
   - `quantizedflat` → `hotels_quantizedflat_go`

4. Download dependencies:

   ```powershell
   go mod download
   ```

## Run

**Load environment variables from `.env`:**

```bash
# Bash/Linux/Mac
export $(grep -v '^#' .env | xargs) && go run .
```

```powershell
# PowerShell
Get-Content .env | Where-Object { $_ -match '^[^#].*=' } | ForEach-Object { $k,$v = $_ -split '=',2; [Environment]::SetEnvironmentVariable($k.Trim(), $v.Trim()) }; go run .
```

The sample creates the database and containers, loads the shared dataset, writes documents to both containers, queries both vector indexes with the same embedding, and deletes both containers during cleanup.

## Build

To compile without running:

```bash
go build -o create-index-go .
```

Then run the binary:

```bash
# Bash/Linux/Mac
export $(grep -v '^#' .env | xargs) && ./create-index-go
```

```powershell
# PowerShell (load env then run)
Get-Content .env | Where-Object { $_ -match '^[^#].*=' } | ForEach-Object { $k,$v = $_ -split '=',2; [Environment]::SetEnvironmentVariable($k.Trim(), $v.Trim()) }; .\create-index-go.exe
```

## Expected Output

The exact scores vary, but the format is consistent:

```text
✓ Region validation passed. Found regions: Midwest, Northeast, South, West
  Region 'Northeast': 10 documents
  Region 'Midwest': 10 documents
  Region 'South': 14 documents
  Region 'West': 16 documents
Using Azure OpenAI Embedding Deployment/Model: text-embedding-3-small
Reading JSON file from C:\project-dina-data-ai\repos\cosmos-db-vector-samples-2\nosql-create-index-go\data\HotelsData_toCosmosDB_Vector_byRegion.json
Loaded 50 documents

=== Phase 1: Create Database ===
  Database: HotelsCreateIndex
  ✓ Database created or already exists

=== Creating Container: hotels_diskann_go ===
  Index type:     diskANN
  Embedding path: /embedding
  Dimensions:     1536
  Distance func:  cosine (queried with all 3 metrics)
  Cleaning up existing container...
  Deleted existing container
  Creating container with vector index...
  ✓ Container created in 6.61s
  ✓ Verified: Vector embedding policy configured
    - Path: /embedding
    - DataType: float32
    - Dimensions: 1536
    - DistanceFunction: cosine
  ✓ Verified: Vector index configured
    - Path: /embedding
    - Type: diskANN

=== Creating Container: hotels_quantizedflat_go ===
  Index type:     quantizedFlat
  Embedding path: /embedding
  Dimensions:     1536
  Distance func:  cosine (queried with all 3 metrics)
  Cleaning up existing container...
  Deleted existing container
  Creating container with vector index...
  ✓ Container created in 6.16s
  ✓ Verified: Vector embedding policy configured
    - Path: /embedding
    - DataType: float32
    - Dimensions: 1536
    - DistanceFunction: cosine
  ✓ Verified: Vector index configured
    - Path: /embedding
    - Type: quantizedFlat

✓ All containers created successfully
Processing in batches of 50...
  ✓ hotels_diskann_go: 50 inserted (5243.74 RUs)
  ✓ Verified: 10 documents in partition 'Northeast'
  ✓ hotels_quantizedflat_go: 50 inserted (2621.83 RUs)
  ✓ Verified: 10 documents in partition 'Northeast'

⏳ Waiting 5 seconds for index stabilization...

Query: "hotel near the ocean"
Embedding generated (1536 dimensions)

Running search (top 5 results for each distance function)...
  ✓ hotels_diskann_go queried (3.65 RUs)
  ✓ hotels_diskann_go queried (3.65 RUs)
  ✓ hotels_diskann_go queried (3.65 RUs)
  ✓ hotels_quantizedflat_go queried (3.65 RUs)
  ✓ hotels_quantizedflat_go queried (3.65 RUs)
  ✓ hotels_quantizedflat_go queried (3.65 RUs)

| Container            | Metric     | Top 1 Result               | Score  | Top 2 Result               | Score  | Diff   |
|----------------------|------------|----------------------------|--------|----------------------------|--------|--------|
| hotels_diskann_go    | Cosine     | City Center Summer Wind... | 0.4025 | Red Tide Hotel             | 0.4000 | 0.0025 |
| hotels_diskann_go    | DotProduct | City Center Summer Wind... | 0.4027 | Red Tide Hotel             | 0.4001 | 0.0025 |
| hotels_diskann_go    | Euclidean  | City Center Summer Wind... | 1.0934 | Red Tide Hotel             | 1.0957 | -0.0023 |
| hotels_quantizedf... | Cosine     | City Center Summer Wind... | 0.4025 | Red Tide Hotel             | 0.4000 | 0.0025 |
| hotels_quantizedf... | DotProduct | City Center Summer Wind... | 0.4027 | Red Tide Hotel             | 0.4001 | 0.0025 |
| hotels_quantizedf... | Euclidean  | City Center Summer Wind... | 1.0934 | Red Tide Hotel             | 1.0957 | -0.0023 |

=== Phase 4: Cleanup ===
  ✓ Deleted hotels_diskann_go
  ✓ Deleted hotels_quantizedflat_go

Complete
```

The output includes control-plane creation, ingestion, per-metric query results, and cleanup. Query scores can vary between runs.
