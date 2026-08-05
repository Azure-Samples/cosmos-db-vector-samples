# Azure Cosmos DB for NoSQL vector indexes with .NET

## Overview

This sample demonstrates vector index creation and vector search against Azure Cosmos DB for NoSQL. It uses ARM control-plane APIs to recreate and delete its sample containers, and data-plane SDK APIs to ingest documents and run queries.

The sample:
- authenticates with `DefaultAzureCredential`
- connects to the existing `HotelsCreateIndex` database
- recreates `hotels_diskann_dotnet` and `hotels_quantizedflat_dotnet` with vector indexes
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

## Setup

1. Change to the sample directory.

   ```powershell
   Set-Location .\nosql-create-index-dotnet
   ```

2. Generate `appsettings.json`.

   If you deployed with `azd up`, run the helper script from the `scripts` directory to generate `appsettings.json` from your `azd` environment values:

   ```powershell
   Set-Location .\scripts
   .\generate-appsettings.ps1
   Set-Location ..
   ```

   On macOS or Linux:

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

   `DataFilePath` defaults to `./data/HotelsData_toCosmosDB_Vector_byRegion.json`.

3. Notes:
   - `VectorAlgorithm` accepts `diskann` or `quantizedflat`.
   - Leave `VectorAlgorithm` empty to ingest and query **both** containers.
   - The sample always creates and cleans up both sample containers, even when `VectorAlgorithm` focuses ingestion and queries on one container.
   - Leave `CosmosDbSettings:ContainerName` empty unless you want to ingest and query one container by name.
   - `CosmosDbSettings:PartitionKeyValue` must be one of `Northeast`, `Midwest`, `South`, or `West`.
   - `OpenAiSettings:ApiVersion` is kept for cross-language consistency with the other samples.

4. Restore dependencies.

   ```powershell
   dotnet restore
   ```

## Run

Run the sample:

```powershell
dotnet run --project .\nosql-create-index-dotnet.csproj
```

Examples:

```powershell
# Run both containers for ingestion and queries (default when VectorAlgorithm is empty)
dotnet run --project .\nosql-create-index-dotnet.csproj

# To focus ingestion and queries on DiskANN, set "VectorAlgorithm": "diskann" in appsettings.json
dotnet run --project .\nosql-create-index-dotnet.csproj

# To focus ingestion and queries on QuantizedFlat, set "VectorAlgorithm": "quantizedflat" in appsettings.json
dotnet run --project .\nosql-create-index-dotnet.csproj
```

## Expected output

The sample prints:
- configuration validation
- embedding dimension verification for `text-embedding-3-small`
- container creation status for both sample containers
- ingestion status for each target container
- query status and a comparison table for each queried container and distance function
- cleanup status for both sample containers

See `output/sample-output.txt` for an example output file.
