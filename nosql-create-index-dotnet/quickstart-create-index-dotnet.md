---
title: Quickstart: Create and query vector indexes in Azure Cosmos DB for NoSQL using .NET
description: Create vector indexes in Azure Cosmos DB for NoSQL using .NET and the ARM SDK. Load pre-vectorized hotel documents and compare vector distance functions (Cosine, DotProduct, Euclidean).
author: diberry
ms.author: diberry
ms.service: cosmos-db
ms.topic: quickstart
ms.date: 2026-06-22
---

# Quickstart: Create and query vector indexes in Azure Cosmos DB for NoSQL using .NET

In this quickstart, you run the .NET create-index sample for Azure Cosmos DB for NoSQL to demonstrate two key goals:

- **Goal 1 (Control Plane):** Use the ARM SDK to create the `HotelsCreateIndex` database and two vector-indexed containers: `hotels_diskann` (approximate search) and `hotels_quantizedflat` (exact search).
- **Goal 2 (Distance Functions):** Compare how the same query embedding produces different scores and rankings when using different vector distance functions: Cosine, DotProduct, and Euclidean.

## Prerequisites

- An Azure subscription. If you don't have one, create a [free account](https://azure.microsoft.com/free/).
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) installed and signed in with `az login`.
- [.NET 8.0 SDK](https://dotnet.microsoft.com/download/dotnet/8.0).
- An Azure Cosmos DB for NoSQL account with vector search enabled.
- Microsoft Entra ID roles for your identity:
  - **Cosmos DB Built-in Data Contributor**
  - **Cognitive Services OpenAI User**
- An Azure OpenAI resource with a `text-embedding-3-small` deployment.

> [!IMPORTANT]
> **Two Phases:**
>
> 1. **Control Plane (Goal 1):** The sample uses the ARM SDK with `DefaultAzureCredential` to create:
>    - Database: `HotelsCreateIndex`
>    - Containers: `hotels_diskann` (DiskANN index) and `hotels_quantizedflat` (QuantizedFlat index)
>    - Partition key path: `/Region` (valid values: `Northeast`, `Midwest`, `South`, `West`)
>    - Vector field path: `/embedding` (1536 dimensions, float32)
>
> 2. **Data Plane (Goal 2):** After containers are created, the sample:
>    - Loads pre-vectorized hotel documents
>    - Groups them by Region and upserts using transactional batches
>    - Generates a query embedding with Azure OpenAI
>    - Runs `VectorDistance()` queries with three distance functions: **Cosine**, **DotProduct**, and **Euclidean**
>    - Displays rankings for each distance function to show how results differ

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

   **Otherwise**, edit `appsettings.json` with values from the Azure portal.

2. Update `appsettings.json` with your values:

   ```json
   {
     "CosmosDbSettings": {
       "Endpoint": "https://<your-account>.documents.azure.com:443/",
       "DatabaseName": "HotelsCreateIndex",
       "ContainerName": "",
       "PartitionKeyValue": "Northeast"
     },
     "OpenAiSettings": {
       "Endpoint": "https://<your-openai-resource>.openai.azure.com/",
       "Deployment": "text-embedding-3-small",
       "ApiVersion": "2024-08-01-preview"
     },
     "VectorAlgorithm": "",
     "EmbeddedField": "embedding",
     "DataFilePath": "./data/HotelsData_toCosmosDB_Vector_byRegion.json"
   }
   ```

Leave `ContainerName` and `VectorAlgorithm` empty to run both containers. If you set `VectorAlgorithm`, use one of these values:

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

**What the sample does:**

The sample demonstrates both goals in sequence:

**Goal 1 - Control Plane (create containers with vector indexes):**
1. Loads configuration from `appsettings.json`
2. Authenticates with `DefaultAzureCredential`
3. Creates an Azure Resource Manager client
4. Creates the `HotelsCreateIndex` database (if needed)
5. Creates the `hotels_diskann` container with DiskANN vector index on `/embedding`
6. Creates the `hotels_quantizedflat` container with QuantizedFlat vector index on `/embedding`

**Goal 2 - Data Plane (load and query with distance functions):**
1. Connects to the data plane SDK using `DefaultAzureCredential`
2. Reads `./data/HotelsData_toCosmosDB_Vector_byRegion.json` using `System.Text.Json`
3. Groups documents by `Region` and upserts one transactional batch per region
4. Generates a query embedding with the Azure OpenAI client
5. Runs **three separate** `VectorDistance()` SQL queries with different distance functions:
   - **Cosine:** Measures angle between vectors (values: 0 to 2)
   - **DotProduct:** Inner product of vectors (values: any real number)
   - **Euclidean:** Straight-line distance between vectors (values: 0 to √6144)
6. Prints the top 5 matching hotels for each distance function, showing how rankings differ

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

### Goal 1: Create containers using ARM SDK

The control-plane module uses the ARM SDK with `DefaultAzureCredential` to create containers with vector policies. The `ArmClient` connects to the resource, database, and containers collection:

```csharp
var credential = new DefaultAzureCredential();
var armClient = new ArmClient(credential);

// Get the resource and database
var accountIdentifier = CosmosDBAccountResource.CreateResourceIdentifier(
    config.SubscriptionId,
    config.ResourceGroup,
    config.AccountName);
var accountResource = armClient.GetCosmosDBAccountResource(accountIdentifier);
var account = await accountResource.GetAsync();
var database = await account.Value.GetCosmosDBSqlDatabaseAsync(config.DatabaseName);
var containers = database.Value.GetCosmosDBSqlContainers();

// Build container definition with vector policies
var containerDefinition = new CosmosDBSqlContainerCreateOrUpdateContent
{
    Resource = new CosmosDBSqlContainerResourceInfo(containerName)
    {
        PartitionKey = new CosmosDBContainerPartitionKey
        {
            Paths = { "/Region" },
            Kind = CosmosDBPartitionKind.Hash
        },
        VectorEmbeddingPolicy = new CosmosDBVectorEmbeddingPolicy
        {
            VectorEmbeddings =
            {
                new CosmosDBVectorEmbedding
                {
                    Path = "/embedding",
                    DataType = CosmosDBVectorDataType.Float32,
                    Dimensions = config.ExpectedDimensions,
                    DistanceFunction = CosmosDBVectorDistanceFunction.Cosine
                }
            }
        },
        IndexingPolicy = new CosmosDBIndexingPolicy
        {
            IsAutomatic = true,
            IndexingMode = CosmosDBIndexingMode.Consistent,
            IncludedPaths = { new CosmosDBIncludedPath { Path = "/*" } },
            ExcludedPaths = { new CosmosDBExcludedPath { Path = "/_etag/?" } },
            VectorIndexes =
            {
                new CosmosDBVectorIndex("/embedding", CosmosDBVectorIndexType.DiskAnn),
                new CosmosDBVectorIndex("/embedding", CosmosDBVectorIndexType.QuantizedFlat)
            }
        }
    }
};

// Create or update container
await containers.CreateOrUpdateAsync(WaitUntil.Completed, containerName, containerDefinition);
```

### Goal 2: Load configuration and connect with Microsoft Entra ID

Configuration is loaded from `appsettings.json` and `DefaultAzureCredential` is passed directly to both `CosmosClient` and `AzureOpenAIClient`:

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

The sample groups documents by Region and upserts one transactional batch per partition:

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

### Run vector similarity queries with different distance functions

After inserting documents, the sample generates a query embedding and executes **three separate** SQL queries with different distance functions. Each uses a parameterized value for the embedding:

```csharp
// Generate query embedding
var embeddingResponse = await azureOpenAIClient.GetEmbeddingsAsync(
    new EmbeddingsOptions
    {
        Input = { queryText },
        Dimensions = config.ExpectedDimensions
    });
var queryEmbedding = embeddingResponse.Value.Data[0].Embedding.ToList();

// Query with each distance function
string[] distanceFunctions = { "Cosine", "DotProduct", "Euclidean" };

foreach (var distanceFunc in distanceFunctions)
{
    Console.WriteLine($"\n=== Query Results using {distanceFunc} ===");

    var query = new QueryDefinition(
        $"SELECT TOP 5 c.HotelId, c.HotelName, c.Description, " +
        $"VectorDistance(c.embedding, @embedding, false, {{'distanceFunction': '{distanceFunc}'}}) AS SimilarityScore " +
        "FROM c WHERE c.Region = @partitionKey")
        .WithParameter("@embedding", queryEmbedding)
        .WithParameter("@partitionKey", "Northeast");

    var iterator = container.GetItemQueryIterator<HotelDocument>(query, requestOptions: new QueryRequestOptions { PartitionKey = new PartitionKey("Northeast") });

    while (iterator.HasMoreResults)
    {
        foreach (var doc in await iterator.ReadNextAsync())
        {
            Console.WriteLine($"  {doc.HotelName} (score: {doc.SimilarityScore:F4})");
        }
    }
}
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
