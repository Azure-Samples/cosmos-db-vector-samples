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

This sample demonstrates the full `nosql-create-index` scenario in Go. Bicep
creates the configured `HotelsCreateIndex` database. The sample uses the ARM
SDK control plane to create the `hotels_diskann` and `hotels_quantizedflat`
containers with vector indexes, then uses data-plane operations to:

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
- Permissions for your identity to create and delete the configured SQL containers in the Azure Cosmos DB account
- Cosmos DB data-plane access to create and query items
- An Azure OpenAI embedding deployment for `text-embedding-3-small`

## Setup

1. Change to the sample directory:

   ```powershell
   Set-Location .\nosql-create-index-go
   ```

2. Create the environment variables file.

   **If you deployed with `azd up`:**

   ```powershell
   azd env get-values > .env
   ```

   **Otherwise**, copy the template and fill in values from the Azure portal:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Download dependencies:

   ```powershell
   go mod download
   ```

## Load environment variables and run the sample

**⚠️ Important:** Go does NOT automatically load `.env` files. Environment variables MUST be exported in your current session BEFORE running the sample.

**Load environment variables from `.env` into your session:**

| Action | PowerShell | Bash |
|--------|-----------|------|
| Load from `.env` file | `Get-Content .env \| ForEach-Object { if ($_ -match "^([^=]+)=(.*)$") { [Environment]::SetEnvironmentVariable($matches[1], $matches[2]) } }` | `export $(grep -v "^#" .env \| xargs)` |
| Set single variable | `[Environment]::SetEnvironmentVariable("AZURE_COSMOSDB_ENDPOINT", "https://your-account.documents.azure.com:443/")` | `export AZURE_COSMOSDB_ENDPOINT="https://your-account.documents.azure.com:443/"` |

**Required environment variables for control plane operations** (creating and deleting containers with ARM SDK):
- `AZURE_SUBSCRIPTION_ID` — Your Azure subscription ID
- `AZURE_RESOURCE_GROUP` — Your Azure resource group name
- `AZURE_COSMOSDB_ACCOUNT_NAME` — Your Cosmos DB account name
- `AZURE_LOCATION` — Azure region where resources are deployed

**Required environment variables for data plane operations** (querying and inserting data):
- `AZURE_COSMOSDB_ENDPOINT` — Cosmos DB endpoint URL
- `AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME` — Database name (e.g., "HotelsCreateIndex")
- `AZURE_OPENAI_EMBEDDING_ENDPOINT` — Azure OpenAI endpoint URL
- `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` — Deployment name (e.g., "text-embedding-3-small")

**⚠️ Control Plane Requirement:** This sample uses the Azure Resource Manager (ARM) SDK to create and delete containers at runtime. All ARM SDK environment variables above (subscription ID, resource group, account name, location) MUST be set before running the sample. No defaults are provided for these values.

**Optional environment variables:**
- `VECTOR_ALGORITHM` — "diskann" or "quantizedflat"; leave empty to run **both** containers
- `AZURE_COSMOSDB_CONTAINER_NAME` — Target container by name; leave empty to process all
- `AZURE_COSMOSDB_CREATE_INDEX_DISKANN_CONTAINER_NAME` — Custom diskANN container name (default: "hotels_diskann")
- `AZURE_COSMOSDB_CREATE_INDEX_QUANTIZEDFLAT_CONTAINER_NAME` — Custom quantizedFlat container name (default: "hotels_quantizedflat")
- `AZURE_COSMOSDB_CREATE_INDEX_ALLOW_DESTRUCTIVE_OPERATIONS` — Set to `true` only when custom container names are intentional and safe to delete

**Run the sample:**

```bash
# Bash/Linux/Mac
export $(grep -v '^#' .env | xargs) && go run .
```

```powershell
# PowerShell
Get-Content .env | ForEach-Object { if ($_ -match "^([^=]+)=(.*)$") { [Environment]::SetEnvironmentVariable($matches[1], $matches[2]) } }; go run .
```

The sample uses the Bicep-created database, creates both containers, loads the
shared dataset, queries both vector indexes, and waits for both container
deletions during cleanup.

## Build

To compile without running:

```bash
go build -o create-index-go .
```

Then run the binary:

```bash
# Bash/Linux/Mac (load env then run)
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

=== Phase 1: Use Configured Database ===
  Database: HotelsCreateIndex
  ✓ Using existing database

=== Creating Container: hotels_diskann ===
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

=== Creating Container: hotels_quantizedflat ===
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
  ✓ hotels_diskann: 50 inserted (5243.74 RUs)
  ✓ Verified: 10 documents in partition 'Northeast'
  ✓ hotels_quantizedflat: 50 inserted (2621.83 RUs)
  ✓ Verified: 10 documents in partition 'Northeast'

⏳ Waiting 5 seconds for index stabilization...

Query: "hotel near the ocean"
Embedding generated (1536 dimensions)

Running search (top 5 results for each distance function)...
  ✓ hotels_diskann queried (3.65 RUs)
  ✓ hotels_diskann queried (3.65 RUs)
  ✓ hotels_diskann queried (3.65 RUs)
  ✓ hotels_quantizedflat queried (3.65 RUs)
  ✓ hotels_quantizedflat queried (3.65 RUs)
  ✓ hotels_quantizedflat queried (3.65 RUs)

| Container            | Metric     | Top 1 Result               | Score  | Top 2 Result               | Score  | Diff   |
|----------------------|------------|----------------------------|--------|----------------------------|--------|--------|
| hotels_diskann    | Cosine     | City Center Summer Wind... | 0.4025 | Red Tide Hotel             | 0.4000 | 0.0025 |
| hotels_diskann    | DotProduct | City Center Summer Wind... | 0.4027 | Red Tide Hotel             | 0.4001 | 0.0025 |
| hotels_diskann    | Euclidean  | City Center Summer Wind... | 1.0934 | Red Tide Hotel             | 1.0957 | -0.0023 |
| hotels_quantizedf... | Cosine     | City Center Summer Wind... | 0.4025 | Red Tide Hotel             | 0.4000 | 0.0025 |
| hotels_quantizedf... | DotProduct | City Center Summer Wind... | 0.4027 | Red Tide Hotel             | 0.4001 | 0.0025 |
| hotels_quantizedf... | Euclidean  | City Center Summer Wind... | 1.0934 | Red Tide Hotel             | 1.0957 | -0.0023 |

=== Phase 4: Cleanup ===
  ✓ Deleted hotels_diskann
  ✓ Deleted hotels_quantizedflat

Complete
```

The output includes control-plane creation, ingestion, per-metric query results, and cleanup. Query scores can vary between runs.

## Authentication and permissions

All Azure clients use `DefaultAzureCredential`. For local runs, sign in with `az login` or `azd auth login`. Hosted execution can use managed identity. The selected identity needs management-plane permission to create and delete the two configured containers, Cosmos DB data-plane access to insert and query documents, and the Cognitive Services OpenAI User role. Keys and connection strings aren't supported.

## Validate and clean generated artifacts

From the repository root, validate this sample with the shared validator:

```powershell
pwsh -NoProfile -File .github\skills\sample-validate-nosql-create-index\scripts\validate-create-index-samples.ps1 -Language Go
```

Preview and then remove generated local artifacts:

```powershell
pwsh -NoProfile -File .github\scripts\clean-all-create-index.ps1 -Language Go -WhatIf
pwsh -NoProfile -File .github\scripts\clean-all-create-index.ps1 -Language Go
```
