# Azure Cosmos DB for NoSQL vector indexes with Python

## Overview

This sample demonstrates **data-plane only** vector search operations against Azure Cosmos DB for NoSQL containers that were provisioned ahead of time by shared Bicep.

The sample:
- authenticates with `DefaultAzureCredential`
- loads the shared hotel dataset from the repo root
- adds `PartitionKey="hotels"` during ingestion
- upserts data into `hotels_diskann` and `hotels_quantizedflat`
- generates a query embedding with the Azure OpenAI client
- runs `VectorDistance()` queries and prints the top 5 matches

## Prerequisites

- Python 3.9+
- Azure CLI installed and signed in with `az login`
- An Azure Cosmos DB for NoSQL account and database already provisioned
- The following existing containers created by shared Bicep:
  - `hotels_diskann`
  - `hotels_quantizedflat`
- Azure RBAC roles for your identity:
  - **Cosmos DB Built-in Data Contributor**
  - **Cognitive Services OpenAI User**
- An Azure OpenAI embedding deployment for **`text-embedding-3-small`**

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

3. Populate environment variables.

   **If you deployed with `azd up`:**

   ```powershell
   azd env get-values > .env
   ```

   **Otherwise**, copy the template and fill in values from the Azure portal:

   ```powershell
   Copy-Item .env.example .env
   ```

4. Verify `.env` has your values.

   Notes:
   - `VECTOR_ALGORITHM` accepts `diskann` or `quantizedflat`.
   - Leave `VECTOR_ALGORITHM` empty to run **both** containers.
   - Leave `AZURE_COSMOSDB_CONTAINER_NAME` empty unless you want to target one container by name.
   - `DATA_FILE_WITH_VECTORS` points to the shared repo-root dataset.

## Run

Run the sample from this directory:

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
- embedding dimension verification for `text-embedding-3-small`
- ingestion status for each target container
- top 5 vector matches for each queried container

See `output/sample-output.txt` for an example output file.
