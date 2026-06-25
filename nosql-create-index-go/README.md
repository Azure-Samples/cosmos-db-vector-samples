<!--
---
page_type: sample
name: "Azure Cosmos DB NoSQL create index sample for Go"
description: "This sample demonstrates Azure Cosmos DB for NoSQL vector queries in Go against pre-provisioned DiskANN and QuantizedFlat containers using data-plane operations only."
urlFragment: nosql-create-index-go
languages:
- go
products:
- azure-cosmos-db
---
-->
# Azure Cosmos DB for NoSQL create index sample (Go)

## Overview

This sample demonstrates the **data-plane** portion of the `nosql-create-index` scenario in Go. The shared Bicep infrastructure already provisions the `hotels_diskann` and `hotels_quantizedflat` containers, so the sample only:

- authenticates with `DefaultAzureCredential`
- loads hotel documents from the shared dataset
- adds `PartitionKey="hotels"` during ingestion
- writes documents to both pre-provisioned containers with bounded concurrent creates
- generates an embedding with the Azure OpenAI embeddings REST API by using a bearer token from `DefaultAzureCredential`
- runs a `SELECT TOP 5 ... ORDER BY VectorDistance(...)` query against both containers

The sample never creates databases, containers, or vector indexes in code.

## Prerequisites

- Go 1.21 or later
- Azure CLI with a signed-in account: `az login`
- An Azure Cosmos DB for NoSQL account with these existing resources:
  - database: `Hotels`
  - containers: `hotels_diskann` and `hotels_quantizedflat`
  - partition key: `/PartitionKey`
  - vector field: `/DescriptionVector`
- An Azure OpenAI embedding deployment for `text-embedding-3-small`

## Setup

1. Change to the sample directory:

   ```powershell
   Set-Location .\nosql-create-index-go
   ```

2. Populate environment variables.

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
   | `AZURE_COSMOSDB_DATABASENAME` | `Hotels` |
   | `AZURE_COSMOSDB_CONTAINER_NAME` | Optional. `hotels_diskann` or `hotels_quantizedflat` |
   | `AZURE_OPENAI_EMBEDDING_ENDPOINT` | `https://<resource>.openai.azure.com/` |
   | `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | `text-embedding-3-small` |
   | `VECTOR_ALGORITHM` | Optional. `diskann` or `quantizedflat` |
   | `DATA_FILE_WITH_VECTORS_AND_REGIONS` | `data/HotelsData_toCosmosDB_Vector_byRegion.json` |

   Leave both `AZURE_COSMOSDB_CONTAINER_NAME` and `VECTOR_ALGORITHM` empty to run both containers. If you set both, they must match:

   - `diskann` → `hotels_diskann`
   - `quantizedflat` → `hotels_quantizedflat`

4. Download dependencies:

   ```powershell
   go mod tidy
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

The sample loads the shared dataset, writes documents to both containers, and then queries both vector indexes with the same embedding.

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
Azure Cosmos DB vector index sample (Go)
database=Hotels primaryContainer=hotels_diskann vectorAlgorithm=diskann dataFile=C:\...\data\HotelsData_toCosmosDB_Vector_byRegion.json
embeddingDeployment=text-embedding-3-small dimensions=1536 partitionKey=hotels

=== hotels_diskann ===
inserted=50 skipped=0 failed=0 total=50 writeRU=123.45
1. HotelId=12 | HotelName=Ocean Breeze Suites | score=0.0834 | Description=Modern waterfront hotel near the beach and boardwalk...
2. HotelId=34 | HotelName=Harbor View Inn | score=0.0972 | Description=Coastal stay with ocean-facing rooms and easy dining access...
queryRU=3.21

=== hotels_quantizedflat ===
inserted=50 skipped=0 failed=0 total=50 writeRU=121.88
1. HotelId=12 | HotelName=Ocean Breeze Suites | score=0.0834 | Description=Modern waterfront hotel near the beach and boardwalk...
2. HotelId=34 | HotelName=Harbor View Inn | score=0.0972 | Description=Coastal stay with ocean-facing rooms and easy dining access...
queryRU=3.47
```

The output always includes rank, `HotelId`, `HotelName`, a four-decimal vector score, and one descriptive field.
