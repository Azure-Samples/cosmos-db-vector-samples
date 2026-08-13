# Azure Cosmos DB for NoSQL vector indexes with .NET

## Overview

This sample demonstrates vector index creation and vector search against Azure Cosmos DB for NoSQL. It uses ARM control-plane APIs to recreate and delete its sample containers, and data-plane SDK APIs to ingest documents and run queries.

The sample:
- authenticates with `DefaultAzureCredential`
- connects to the existing `HotelsCreateIndex` database
- recreates `hotels_diskann` and `hotels_quantizedflat` with vector indexes (non-language-specific names)
- loads pre-vectorized hotel documents from `.\data\HotelsData_toCosmosDB_Vector_byRegion.json`
- validates `Region` values and upserts one transactional batch per region (`Northeast`, `Midwest`, `South`, `West`)
- generates a query embedding with the Azure OpenAI client
- runs single-partition `VectorDistance()` queries for `Cosine`, `DotProduct`, and `Euclidean`
- prints a comparison table using the top matches for each container and distance function
- deletes both sample containers during cleanup

DiskANN is graph-based. QuantizedFlat uses vector quantization techniques.

## Prerequisites

- .NET 8.0 SDK
- Azure CLI installed and signed in with `az login`
- An Azure Cosmos DB for NoSQL account with vector search enabled and an existing `HotelsCreateIndex` database
- Your Azure subscription ID, resource group name, and Cosmos DB account name
- Azure RBAC roles for your identity:
  - **Cosmos DB Built-in Data Contributor**
  - **Cognitive Services OpenAI User**
- Azure RBAC permissions to read the Cosmos DB account and database and to create, update, and delete SQL containers through Azure Resource Manager
- An Azure OpenAI embedding deployment for `text-embedding-3-small`

## Configure the .NET sample

**.NET uses `appsettings.json` + ConfigurationBuilder (NOT `.env` files).** This is the standard .NET configuration pattern. You can override any `appsettings.json` value via environment variables.

⚠️ **Important:** The `appsettings.json` file (or environment variable overrides) MUST be configured BEFORE running `dotnet run`. ConfigurationBuilder reads these values at startup—they are not passed via the command line.

1. Change to the sample directory.

   ```powershell
   Set-Location .\nosql-create-index-dotnet
   ```

2. Generate `appsettings.json`.

   If you deployed with `azd up`, run the helper script to generate `appsettings.json` from your `azd` environment values:

   **PowerShell:**
   ```powershell
   Set-Location .\scripts
   .\generate-appsettings.ps1
   Set-Location ..
   ```

   **Bash/Linux/Mac:**
   ```bash
   cd scripts
   chmod +x generate-appsettings.sh
   ./generate-appsettings.sh
   cd ..
   ```

   **Otherwise**, copy `appsettings.example.json` to `appsettings.json` and edit it directly with values from the Azure portal:

   ```json
   {
     "CosmosDbSettings": {
       "Endpoint": "https://<your-account>.documents.azure.com:443/",
       "DatabaseName": "HotelsCreateIndex",
       "ContainerName": "",
       "PartitionKeyValue": "Northeast",
       "SubscriptionId": "<your-subscription-id>",
       "ResourceGroup": "<your-resource-group>",
       "AccountName": "<your-account-name>"
     },
     "OpenAiSettings": {
       "Endpoint": "https://<your-openai>.openai.azure.com/",
       "Deployment": "text-embedding-3-small",
       "ApiVersion": "2024-08-01-preview"
     },
     "VectorAlgorithm": "",
     "EmbeddedField": "embedding",
     "DataFilePath": "./data/HotelsData_toCosmosDB_Vector_byRegion.json"
   }
   ```

3. Environment variable overrides (optional).

   ConfigurationBuilder reads `appsettings.json` first, then allows environment variables to override those values. If you need to override specific settings, set environment variables before running:

   | Setting | Environment Variable | Example |
   |---------|---------------------|---------|
   | CosmosDbSettings:Endpoint | `COSMOSDBSETTINGS__ENDPOINT` | `https://account.documents.azure.com:443/` |
   | CosmosDbSettings:DatabaseName | `COSMOSDBSETTINGS__DATABASENAME` | `HotelsCreateIndex` |
   | OpenAiSettings:Endpoint | `OPENAISETTINGS__ENDPOINT` | `https://resource.openai.azure.com/` |

   **Set environment variables before running:**

   | Action | PowerShell | Bash |
   |--------|-----------|------|
   | Set single variable | `[Environment]::SetEnvironmentVariable("COSMOSDBSETTINGS__ENDPOINT", "https://your-account.documents.azure.com:443/")` | `export COSMOSDBSETTINGS__ENDPOINT="https://your-account.documents.azure.com:443/"` |
   | Load from `.env` (convert to ConfigurationBuilder format) | `Get-Content .env \| ForEach-Object { if ($_ -match "^([^=]+)=(.*)$") { $var=$matches[1]; $val=$matches[2]; $configVar=$var -replace "_", "__"; [Environment]::SetEnvironmentVariable($configVar, $val) } }` | Not necessary—use appsettings.json |

   **Note:** .NET ConfigurationBuilder uses double underscores (`__`) to separate nested configuration keys (e.g., `CosmosDbSettings:Endpoint` becomes `COSMOSDBSETTINGS__ENDPOINT` in environment variables).

4. Restore dependencies.

   ```powershell
   dotnet restore
   ```

## Run the sample

Run the sample:

```powershell
dotnet run --project .\nosql-create-index-dotnet.csproj
```

Examples:

```powershell
# Run both containers for ingestion and queries (default when VectorAlgorithm is empty in appsettings.json)
dotnet run --project .\nosql-create-index-dotnet.csproj

# Override via environment variable before running (optional)
[Environment]::SetEnvironmentVariable("COSMOSDBSETTINGS__DATABASENAME", "YourDatabaseName")
dotnet run --project .\nosql-create-index-dotnet.csproj
```

## Configuration notes

- `VectorAlgorithm` accepts `diskann` or `quantizedflat`.
- Leave `VectorAlgorithm` empty in `appsettings.json` to ingest and query **both** containers.
- The sample always creates and cleans up both sample containers, even when `VectorAlgorithm` focuses ingestion and queries on one container.
- Leave `CosmosDbSettings:ContainerName` empty unless you want to ingest and query one container by name.
- `CosmosDbSettings:PartitionKeyValue` must be one of `Northeast`, `Midwest`, `South`, or `West`.
- `OpenAiSettings:ApiVersion` is kept for cross-language consistency with the other samples.
- Container names come from environment variables: `AZURE_COSMOSDB_CREATE_INDEX_DISKANN_CONTAINER_NAME` (default: `hotels_diskann`) and `AZURE_COSMOSDB_CREATE_INDEX_QUANTIZEDFLAT_CONTAINER_NAME` (default: `hotels_quantizedflat`).

## Expected output

The sample prints:
- configuration validation
- embedding dimension verification for `text-embedding-3-small`
- container creation status for both sample containers
- ingestion status for each target container
- query status and a comparison table for each queried container and distance function
- cleanup status for both sample containers

See `output/sample-output.txt` for an example output file.
