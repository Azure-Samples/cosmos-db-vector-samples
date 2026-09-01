# Azure Cosmos DB for NoSQL vector indexes with Python

## Overview

This sample demonstrates control-plane vector index creation and data-plane vector search operations against an existing Azure Cosmos DB for NoSQL database.

The sample:
- authenticates with `DefaultAzureCredential`
- uses the Bicep-created database, then deletes and recreates `hotels_diskann` and `hotels_quantizedflat`
- loads the shared hotel dataset from `./data/HotelsData_toCosmosDB_Vector_byRegion.json`
- groups documents by `Region` and upserts each region with `execute_item_batch(..., partition_key=region)`
- generates a query embedding with the Azure OpenAI client
- runs `VectorDistance()` queries for Cosine, DotProduct, and Euclidean and prints a comparison table
- deletes the sample containers during cleanup

## Prerequisites

- Python 3.10+
- Azure CLI installed and signed in with `az login`
- An Azure Cosmos DB for NoSQL account and existing database
- Azure subscription ID, resource group name, and Cosmos DB account name for the control-plane container create/delete step
- Azure RBAC roles for your identity:
  - **Cosmos DB Built-in Data Contributor**
  - **Cognitive Services OpenAI User**
- An Azure OpenAI embedding deployment for **`text-embedding-3-small`**
- Dependencies declared in `requirements.txt`, including `azure-mgmt-cosmosdb`

## Setup

1. Create and activate a virtual environment.

   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   ```

2. Install dependencies.

   ```powershell
   pip install -r requirements.txt
   ```

3. Set environment variables.

   **If you deployed with `azd up`:**

   ```powershell
   azd env get-values > .env
   ```

   **Otherwise**, copy the template and fill in values from the Azure portal:

   ```powershell
   Copy-Item .env.example .env
   ```

   The `.env.example` file contains only the required settings for this sample. Add your subscription, resource group, account, Cosmos DB, and Azure OpenAI values to the copied `.env` file before running the sample. Python reads these values from the process environment; it does not load `.env` automatically.

   **Before running the sample, load environment variables into your session:**

   | Action | PowerShell | Bash |
   |--------|-----------|------|
   | Load from `.env` file | `Get-Content .env \| ForEach-Object { if ($_ -match "^([^=]+)=(.*)$") { [Environment]::SetEnvironmentVariable($matches[1], $matches[2]) } }` | `export $(grep -v "^#" .env \| xargs)` |
   | Set single variable | `[Environment]::SetEnvironmentVariable("AZURE_COSMOSDB_ENDPOINT", "https://your-account.documents.azure.com:443/")` | `export AZURE_COSMOSDB_ENDPOINT="https://your-account.documents.azure.com:443/"` |

   **⚠️ Important:** Environment variables MUST be set in your current session BEFORE running the sample. They are not passed via the `azd` command—they are read by the Python process at runtime.

4. Verify your configuration.

   These environment variables are **required for control plane operations** (creating and deleting containers with ARM SDK):
   - `AZURE_SUBSCRIPTION_ID` — Your Azure subscription ID (required for ARM SDK)
   - `AZURE_RESOURCE_GROUP` — Your Azure resource group name (required for ARM SDK)
   - `AZURE_COSMOSDB_ACCOUNT_NAME` — Your Cosmos DB account name (required for ARM SDK)
   - `AZURE_LOCATION` — Azure region where resources are deployed (required for ARM SDK)

   These environment variables are **required for data plane operations** (querying and inserting data):
   - `AZURE_COSMOSDB_ENDPOINT` — Cosmos DB endpoint URL
   - `AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME` — Database name (e.g., "HotelsCreateIndex")
   - `AZURE_OPENAI_EMBEDDING_ENDPOINT` — Azure OpenAI endpoint URL
   - `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` — Deployment name (e.g., "text-embedding-3-small")

   ⚠️ **Control Plane Requirement:** The sample uses Azure SDK ARM APIs to create and delete containers at runtime. All ARM SDK environment variables above (subscription ID, resource group, account name, location) MUST be set before running the sample. No defaults are provided for these values.

   Optional environment variables:
   - `VECTOR_ALGORITHM` — "diskann" or "quantizedflat"; leave empty to run **both** containers
   - `AZURE_COSMOSDB_CONTAINER_NAME` — Target container by name; leave empty to process all
   - `DATA_FILE_WITH_VECTORS_AND_REGIONS` — Data file path (defaults to `./data/HotelsData_toCosmosDB_Vector_byRegion.json`)
   - `AZURE_COSMOSDB_CREATE_INDEX_DISKANN_CONTAINER_NAME` — Custom diskANN container name (default: "hotels_diskann")
   - `AZURE_COSMOSDB_CREATE_INDEX_QUANTIZEDFLAT_CONTAINER_NAME` — Custom quantizedFlat container name (default: "hotels_quantizedflat")
   - `AZURE_COSMOSDB_CREATE_INDEX_ALLOW_DESTRUCTIVE_OPERATIONS` — Set to `true` only when custom container names are intentional and safe to delete

## Run

**Load environment variables from `.env` first:**

```powershell
# PowerShell (strips quotes from values)
Get-Content .env | Where-Object { $_ -match '^[^#].*=' } | ForEach-Object { $k,$v = $_ -split '=',2; [Environment]::SetEnvironmentVariable($k.Trim(), $v.Trim().Trim('"').Trim("'")) }
```

```bash
# Bash/Linux/Mac
set -a; source .env; set +a
```

**Then run the sample:**

```powershell
python -m src.index
```

Examples:

```powershell
# Run both containers (default when VECTOR_ALGORITHM is empty)
python -m src.index

# Run only DiskANN
$env:VECTOR_ALGORITHM = 'diskann'
python -m src.index

# Run only QuantizedFlat
$env:VECTOR_ALGORITHM = 'quantizedflat'
python -m src.index
```

## Expected Output

The sample prints:
- configuration validation
- configured database and control-plane container recreation
- embedding dimension verification for `text-embedding-3-small`
- ingestion status for each target container
- six vector search rows: each target container queried with Cosine, DotProduct, and Euclidean
- cleanup status for the created containers

See `output/sample-output.txt` for an example output file.

## Authentication and permissions

All Azure clients use `DefaultAzureCredential`. For local runs, sign in with `az login` or `azd auth login`. Hosted execution can use managed identity. The selected identity needs management-plane permission to create and delete the two configured containers, Cosmos DB data-plane access to insert and query documents, and the Cognitive Services OpenAI User role. Keys and connection strings aren't supported.

## Validate and clean generated artifacts

From the repository root, validate this sample with the shared validator:

```powershell
pwsh -NoProfile -File .github\skills\sample-validate-nosql-create-index\scripts\validate-create-index-samples.ps1 -Language Python
```

Preview and then remove generated local artifacts:

```powershell
pwsh -NoProfile -File .github\scripts\clean-all-create-index.ps1 -Language Python -WhatIf
pwsh -NoProfile -File .github\scripts\clean-all-create-index.ps1 -Language Python
```
