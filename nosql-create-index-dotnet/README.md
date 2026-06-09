# Azure Cosmos DB for NoSQL vector indexes with .NET

## Overview

This sample demonstrates **data-plane only** vector search operations against Azure Cosmos DB for NoSQL containers that already exist.

The sample:
- authenticates with `DefaultAzureCredential`
- connects to the existing `Hotels` database and existing vector containers
- loads pre-vectorized hotel documents from `..\data\HotelsData_toCosmosDB_Vector.json`
- inserts documents into `hotels_diskann` and `hotels_quantizedflat` by using bulk-friendly parallel `CreateItemAsync` calls with `AllowBulkExecution = true`
- generates a query embedding with the Azure OpenAI client
- runs a `VectorDistance()` query for similarity search
- prints the top 5 matches for each container

The sample never creates databases, containers, or vector indexes in code.

## Prerequisites

- .NET 8.0 SDK
- Azure CLI installed and signed in with `az login`
- An Azure Cosmos DB for NoSQL account and database already provisioned
- The following existing containers created by shared Bicep or `azd up`:
  - `hotels_diskann`
  - `hotels_quantizedflat`
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
   - `AZURE_OPENAI_EMBEDDING_API_VERSION` is kept for cross-language consistency with the other samples.
   - `DATA_FILE_WITH_VECTORS` points to the shared repo-root dataset.

4. Restore dependencies.

   ```powershell
   dotnet restore
   ```

## Run

Run the sample from this directory:

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
