# Azure Cosmos DB for NoSQL vector indexes with Python

## Overview

This sample demonstrates control-plane vector index creation and data-plane vector search operations against an existing Azure Cosmos DB for NoSQL database.

The sample:
- authenticates with `DefaultAzureCredential`
- diagnoses the existing database, then deletes and recreates `hotels_diskann_py` and `hotels_quantizedflat_py`
- loads the shared hotel dataset from `./data/HotelsData_toCosmosDB_Vector_byRegion.json`
- groups documents by `Region` and upserts each region with `execute_item_batch(..., partition_key=region)`
- generates a query embedding with the Azure OpenAI client
- runs `VectorDistance()` queries for Cosine, DotProduct, and Euclidean and prints a comparison table
- deletes the sample containers during cleanup

## Prerequisites

- Python 3.9+
- Azure CLI installed and signed in with `az login`
- An Azure Cosmos DB for NoSQL account and existing database
- Azure subscription ID, resource group name, and Cosmos DB account name for the control-plane container create/delete step
- Azure RBAC roles for your identity:
  - **Cosmos DB Built-in Data Contributor**
  - **Cognitive Services OpenAI User**
- An Azure OpenAI embedding deployment for **`text-embedding-3-small`**
- The `azure-mgmt-cosmosdb` package in addition to `requirements.txt`

## Setup

1. Create and activate a virtual environment.

   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   ```

2. Install control plane dependencies.

   ```powershell
   pip install -r requirements.txt
   pip install azure-mgmt-cosmosdb
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

   **Before running the sample, load environment variables into your session:**

   | Action | PowerShell | Bash |
   |--------|-----------|------|
   | Load from `.env` file | `Get-Content .env \| ForEach-Object { if ($_ -match "^([^=]+)=(.*)$") { [Environment]::SetEnvironmentVariable($matches[1], $matches[2]) } }` | `export $(grep -v "^#" .env \| xargs)` |
   | Set single variable | `[Environment]::SetEnvironmentVariable("AZURE_COSMOSDB_ENDPOINT", "https://your-account.documents.azure.com:443/")` | `export AZURE_COSMOSDB_ENDPOINT="https://your-account.documents.azure.com:443/"` |

   **⚠️ Important:** Environment variables MUST be set in your current session BEFORE running the sample. They are not passed via the `azd` command—they are read by the Python process at runtime.

4. Verify your configuration.

   These environment variables are required:
   - `AZURE_COSMOSDB_ENDPOINT` — Cosmos DB endpoint URL
   - `AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME` — Database name (e.g., "HotelsCreateIndex")
   - `AZURE_SUBSCRIPTION_ID` — Your Azure subscription ID
   - `AZURE_RESOURCE_GROUP` — Your Azure resource group name
   - `AZURE_COSMOSDB_ACCOUNT_NAME` — Your Cosmos DB account name
   - `AZURE_OPENAI_EMBEDDING_ENDPOINT` — Azure OpenAI endpoint URL
   - `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` — Deployment name (e.g., "text-embedding-3-small")

   Optional environment variables:
   - `VECTOR_ALGORITHM` — "diskann" or "quantizedflat"; leave empty to run **both** containers
   - `AZURE_COSMOSDB_CONTAINER_NAME` — Target container by name; leave empty to process all
   - `DATA_FILE_WITH_VECTORS_AND_REGIONS` — Data file path (defaults to `./data/HotelsData_toCosmosDB_Vector_byRegion.json`)
   - `AZURE_COSMOSDB_CREATE_INDEX_DISKANN_CONTAINER_NAME` — Custom diskANN container name (default: "hotels_diskann")
   - `AZURE_COSMOSDB_CREATE_INDEX_QUANTIZEDFLAT_CONTAINER_NAME` — Custom quantizedFlat container name (default: "hotels_quantizedflat")
   VECTOR_ALGORITHM=""
   DATA_FILE_WITH_VECTORS_AND_REGIONS="./data/HotelsData_toCosmosDB_Vector_byRegion.json"
   ```

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
- database diagnostics and control-plane container recreation
- embedding dimension verification for `text-embedding-3-small`
- ingestion status for each target container
- six vector search rows: each target container queried with Cosine, DotProduct, and Euclidean
- cleanup status for the created containers

See `output/sample-output.txt` for an example output file.
