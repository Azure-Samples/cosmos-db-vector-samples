---
title: Quickstart: Create and query vector indexes in Azure Cosmos DB for NoSQL using .NET
description: Use .NET and Azure SDK libraries to load pre-vectorized hotel documents into existing Azure Cosmos DB for NoSQL vector containers and query them with VectorDistance.
author: diberry
ms.author: diberry
ms.service: cosmos-db
ms.topic: quickstart
ms.date: 2026-06-08
---

# Quickstart: Create and query vector indexes in Azure Cosmos DB for NoSQL using .NET

In this quickstart, you run the `.NET` create-index sample for Azure Cosmos DB for NoSQL. The sample assumes `azd up` already created the `HotelsCreateIndex` database and the `hotels_diskann` and `hotels_quantizedflat` containers with their vector policies. Your code stays on the data plane: it loads pre-vectorized hotel documents, writes them to the existing containers, generates a query embedding with the Azure OpenAI client, and runs `VectorDistance()` similarity queries.

Find the sample code on GitHub in [`nosql-create-index-dotnet`](https://github.com/Azure-Samples/cosmos-db-vector-samples/tree/main/nosql-create-index-dotnet).

## Prerequisites

- An Azure subscription. If you don't have one, create a [free account](https://azure.microsoft.com/free/).
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) installed and signed in with `az login`.
- [.NET 8.0 SDK](https://dotnet.microsoft.com/download/dotnet/8.0).
- An Azure Cosmos DB for NoSQL account with vector search enabled.
- Existing resources created by `azd up` or the shared Bicep deployment:
  - database: `HotelsCreateIndex`
  - containers: `hotels_diskann` and `hotels_quantizedflat`
  - partition key path: `/Region`
  - vector field path: `/embedding`
- Microsoft Entra ID roles for your identity:
  - **Cosmos DB Built-in Data Contributor**
  - **Cognitive Services OpenAI User**
- An Azure OpenAI resource with a `text-embedding-3-small` deployment.

> [!NOTE]
> **RBAC roles:** Data-plane RBAC role definitions and assignments are created by `azd up` via Bicep templates. You can also create them programmatically using the management SDK — see [`SqlResources.CreateUpdateSqlRoleDefinitionAsync`](https://learn.microsoft.com/dotnet/api/azure.resourcemanager.cosmosdb.sqlresources.createupdatesqlroledefinitionasync) (.NET) or [`SqlResourcesClient.BeginCreateUpdateSqlRoleDefinition`](https://pkg.go.dev/github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/cosmosdb/armcosmosdb#SqlResourcesClient.BeginCreateUpdateSqlRoleDefinition) (Go).

> [!IMPORTANT]
> This scenario is data-plane only. Do not add `CreateDatabaseIfNotExistsAsync`, `CreateContainerIfNotExistsAsync`, or any management-plane SDK calls. The sample expects the database and vector containers to already exist.

## Clone the repository

```bash
git clone https://github.com/Azure-Samples/cosmos-db-vector-samples.git
cd cosmos-db-vector-samples/nosql-create-index-dotnet
```

## Set up the data directory

The sample uses the region-partitioned data file `HotelsData_toCosmosDB_Vector_byRegion.json`:

```bash
# Create the data directory if it doesn't exist
mkdir -p ./data

# Copy the data file from the shared location
cp ../data/HotelsData_toCosmosDB_Vector_byRegion.json ./data/
```

The sample expects the data file at: `./data/HotelsData_toCosmosDB_Vector_byRegion.json`

## Configure environment variables

1. Configure environment variables.

   **If you deployed with `azd up`**, set environment variables directly:

   ```powershell
   azd env get-values | ForEach-Object { if ($_ -match '^([^=]+)=["'']?(.+?)["'']?$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2]) } }
   ```

   **Otherwise**, edit `appsettings.json` with values from the Azure portal:

   ```powershell
   # Edit appsettings.json with your endpoint values
   ```

1. Update `appsettings.json` with your values:

   ```dotenv
   AZURE_COSMOSDB_ENDPOINT="https://<your-account>.documents.azure.com:443/"
   AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME="HotelsCreateIndex"
   AZURE_COSMOSDB_CONTAINER_NAME=""
   AZURE_OPENAI_EMBEDDING_ENDPOINT="https://<your-openai-resource>.openai.azure.com/"
   AZURE_OPENAI_EMBEDDING_DEPLOYMENT="text-embedding-3-small"
   AZURE_OPENAI_EMBEDDING_API_VERSION="2024-08-01-preview"
   VECTOR_ALGORITHM=""
   PARTITION_KEY_VALUE="Northeast"
   DATA_FILE_WITH_VECTORS="./data/HotelsData_toCosmosDB_Vector_byRegion.json"
   ```

Leave `AZURE_COSMOSDB_CONTAINER_NAME` and `VECTOR_ALGORITHM` empty to run both containers. If you set `VECTOR_ALGORITHM`, use one of these values:

- `diskann`
- `quantizedflat`

## Restore and run the sample

Restore the NuGet packages:

```powershell
dotnet restore
```

Run the sample:

```powershell
dotnet run --project .\nosql-create-index-dotnet.csproj
```

The sample performs these steps:

1. Loads configuration from `appsettings.json`.
1. Authenticates with `DefaultAzureCredential`.
1. Connects to the existing `HotelsCreateIndex` database and target containers.
1. Reads `.\data\HotelsData_toCosmosDB_Vector_byRegion.json` by using `System.Text.Json`.
1. Groups documents by `Region` and upserts one transactional batch per region.
1. Generates a query embedding with the Azure OpenAI client.
1. Runs `VectorDistance()` SQL queries filtered by `Region` and scoped with `QueryRequestOptions.PartitionKey`.
1. Prints the top 5 matching hotels.

## Understand the project structure

The sample has the following structure:

```text
nosql-create-index-dotnet/
├── .env.example
├── nosql-create-index-dotnet.csproj
├── output/
│   └── sample-output.txt
├── sample.env
└── src/
    ├── Config.cs
    ├── DataPlane.cs
    ├── HotelDocument.cs
    └── Program.cs
```

## Key implementation details

### Load configuration and validate target containers

`Config.cs` loads configuration from `appsettings.json`, resolves the shared data file path, and validates the supported container names:

```csharp
var config = Config.Load();
Config.Validate(config);
var targetContainers = Config.TargetContainers(config);
```

### Connect with Microsoft Entra ID

The sample passes `DefaultAzureCredential` directly to `CosmosClient` and `AzureOpenAIClient`:

```csharp
var credential = new DefaultAzureCredential();
using var cosmosClient = new CosmosClient(
    config.CosmosEndpoint,
    credential,
    new CosmosClientOptions { AllowBulkExecution = true });

var azureOpenAIClient = new AzureOpenAIClient(
    new Uri(config.OpenAIEmbeddingEndpoint),
    credential);
```

### Insert documents into existing containers

The sample adds `id` from `HotelId`, preserves `Region`, and upserts one transactional batch per `/Region` partition:

```csharp
var documentsByRegion = DataPlane.GroupDocumentsByRegion(documents);
foreach (var regionGroup in documentsByRegion)
{
    var batch = container.CreateTransactionalBatch(new PartitionKey(regionGroup.Key));
    foreach (var document in regionGroup.Value)
    {
        batch.UpsertItem(document);
    }

    await batch.ExecuteAsync();
}
```

### Run the vector similarity query

The embedding field name is validated before it is interpolated into the query string. `VectorDistance()` has no `ORDER BY`, includes the distance function options object, and filters to a single `Region` partition:

```csharp
var query = new QueryDefinition(
        $"SELECT TOP @topK c.HotelId, c.HotelName, c.Description, " +
        $"VectorDistance(c.{embeddingFieldName}, @embedding, false, {{'distanceFunction': 'Cosine'}}) AS SimilarityScore " +
        "FROM c WHERE c.Region = @partitionKey")
    .WithParameter("@topK", 5)
    .WithParameter("@embedding", queryEmbedding)
    .WithParameter("@partitionKey", "Northeast");
```

## Example output

```output
========================================================================
Azure Cosmos DB for NoSQL - create and query vector indexes with .NET
========================================================================
Database: Hotels
Data file: C:\project-dina-data-ai\repos\public-azuresamples-cosmos-db-vector-samples\nosql-create-index-dotnet\data\HotelsData_toCosmosDB_Vector_byRegion.json
Target containers: hotels_diskann, hotels_quantizedflat

=== Verify embedding dimensions ===
Deployment: text-embedding-3-small
Actual:     1536
Expected:   1536

=== Ingest documents: hotels_diskann ===
Upserted 50/50 documents using 4 Region transactional batches. RU: 6812.47

=== Query results: hotels_diskann (DiskANN) ===
Request charge: 5.33 RUs
1. HotelId=11 | HotelName=Royal Cottage Resort | score=0.4991 | Description=Your home away from home. Brand new fully equipped premium rooms, fast WiFi, full kitchen, washer & dryer...
```

## Next steps

- Review the sample output in `output/sample-output.txt`.
- Try `VECTOR_ALGORITHM=diskann` or `VECTOR_ALGORITHM=quantizedflat` to focus on one container.
- Learn more about Azure Cosmos DB vector search at `/azure/cosmos-db/nosql/vector-search`.
