# Azure Cosmos DB for NoSQL vector indexes with .NET

## Overview

This sample demonstrates **data-plane only** vector search operations against Azure Cosmos DB for NoSQL containers that already exist.

The sample:
- authenticates with `DefaultAzureCredential`
- connects to the existing `HotelsCreateIndex` database and existing vector containers
- loads pre-vectorized hotel documents from `.\data\HotelsData_toCosmosDB_Vector_byRegion.json`
- validates `Region` values and upserts one transactional batch per region (`Northeast`, `Midwest`, `South`, `West`)
- generates a query embedding with the Azure OpenAI client
- runs single-partition `VectorDistance()` queries for `Cosine`, `DotProduct`, and `Euclidean`
- prints the top 5 matches for each container

The sample never creates databases, containers, or vector indexes in code.

## Prerequisites

- .NET 8.0 SDK
- Azure CLI installed and signed in with `az login`
- An Azure Cosmos DB for NoSQL account and database already provisioned
- The following existing containers created by shared Bicep or `azd up`:
  - `hotels_diskann_dotnet`
  - `hotels_quantizedflat_dotnet`
- Azure RBAC roles for your identity:
  - **Cosmos DB Built-in Data Contributor**
  - **Cognitive Services OpenAI User**
- An Azure OpenAI embedding deployment for `text-embedding-3-small`

## Setup

1. Change to the sample directory.

   ```powershell
   Set-Location .\nosql-create-index-dotnet
   ```

2. Populate configuration.

   **If you deployed with `azd up`**, set environment variables that override `appsettings.json`:

   ```powershell
   azd env get-values | ForEach-Object {
     if ($_ -match '^([^=]+)=["'']?(.+?)["'']?$') {
       $key = $matches[1]; $val = $matches[2]
       [Environment]::SetEnvironmentVariable($key, $val)
     }
   }
   ```

   **Otherwise**, edit `appsettings.json` directly with values from the Azure portal:

   ```json
   {
     "AZURE_COSMOSDB_ENDPOINT": "https://<your-account>.documents.azure.com:443/",
     "AZURE_OPENAI_EMBEDDING_ENDPOINT": "https://<your-openai>.openai.azure.com/"
   }
   ```

   You can also set values as environment variables — they override `appsettings.json`.

3. Notes:
   - `VECTOR_ALGORITHM` accepts `diskann` or `quantizedflat`.
   - Leave `VECTOR_ALGORITHM` empty to run **both** containers.
   - Leave `AZURE_COSMOSDB_CONTAINER_NAME` empty unless you want to target one container by name.
   - `PARTITION_KEY_VALUE` must be one of `Northeast`, `Midwest`, `South`, or `West`.
   - `AZURE_OPENAI_EMBEDDING_API_VERSION` is kept for cross-language consistency with the other samples.
   - `DATA_FILE_WITH_VECTORS_AND_REGIONS` is the preferred data-file setting and defaults to the region-partitioned dataset used by the create-index samples.

4. Restore dependencies.

   ```powershell
   dotnet restore
   ```

## Run

**Load environment variables from `.env` first (if not using appsettings.json):**

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
dotnet run --project .\nosql-create-index-dotnet.csproj
```

Examples:

```powershell
# Run both containers (default when VECTOR_ALGORITHM is empty)
dotnet run --project .\nosql-create-index-dotnet.csproj

# Run only DiskANN
$env:VECTOR_ALGORITHM = 'diskann'
dotnet run --project .\nosql-create-index-dotnet.csproj

# Run only QuantizedFlat
$env:VECTOR_ALGORITHM = 'quantizedflat'
dotnet run --project .\nosql-create-index-dotnet.csproj
```

## Expected output

The sample prints:
- configuration validation
- embedding dimension verification for `text-embedding-3-small`
- ingestion status for each target container
- top 5 vector matches for each queried container

See `output/sample-output.txt` for an example output file.
