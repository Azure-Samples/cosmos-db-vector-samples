---
title: Quickstart: Create and query vector indexes in Azure Cosmos DB for NoSQL using .NET
description: Compare Cosine, DotProduct, and Euclidean vector distance functions using DiskANN and QuantizedFlat indexes in Azure Cosmos DB for NoSQL with .NET.
author: diberry
ms.author: diberry
ms.service: cosmos-db
ms.topic: quickstart-sdk
ms.devlang: csharp
ms.date: 2026-06-22
---

# Quickstart: Create and query vector indexes in Azure Cosmos DB for NoSQL using .NET

In this quickstart, you run the .NET create-index sample for Azure Cosmos DB for NoSQL. The sample provisions two containers with different vector index types — DiskANN and QuantizedFlat — loads a pre-vectorized hotel dataset, and compares how the same query embedding produces different scores and rankings across three distance functions: Cosine, DotProduct, and Euclidean.

The sample uses a hotel dataset in a JSON file with pre-calculated vectors from the `text-embedding-3-small` model. The hotel data includes hotel names, regions, descriptions, and 1536-dimension vector embeddings partitioned by geographic region.

## Prerequisites

- An Azure subscription. If you don't have one, create a [free account](https://azure.microsoft.com/free/).
- [Azure CLI](/cli/azure/install-azure-cli) installed.
- [Azure Developer CLI (azd)](/azure/developer/azure-developer-cli/install-azd) installed.
- [.NET 8.0 SDK](https://dotnet.microsoft.com/download/dotnet/8.0) or later.
- An Azure Cosmos DB for NoSQL account with vector search enabled and the following RBAC roles assigned to your signed-in identity:
    - Control plane: **Cosmos DB Operator** — grants ARM permission to create, update, and delete SQL containers and vector indexes via Azure Resource Manager.
    - Data plane: **Cosmos DB Built-in Data Contributor**
- An Azure OpenAI resource with a `text-embedding-3-small` deployment and the following RBAC role assigned to your signed-in identity:
    - Data plane: **Cognitive Services OpenAI User**
- To enable infrastructure provisioning for the create-index scenario, set `AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME=HotelsCreateIndex` before running `azd up`. The infrastructure creates the database selected by the deployment scenario. For the create-index scenario, it creates `HotelsCreateIndex`. The sample creates and deletes only the containers; it does not create the database or account.
- (Optional) [Visual Studio Code](https://code.visualstudio.com/) with the **Azure Databases** extension installed, to browse the containers after ingestion.

> [!TIP]
> Agent Kit helps coding agents work with Azure Cosmos DB quickly and efficiently using recommended best practices. To get started, run:
> ```bash
> npx skills add AzureCosmosDB/cosmosdb-agent-kit
> ```
> To learn more, see [Azure Cosmos DB Agent Kit](/azure/cosmos-db/gen-ai/agent-kit).

## App dependencies

The sample uses the following NuGet packages:

- [`Azure.AI.OpenAI`](https://www.nuget.org/packages/Azure.AI.OpenAI): Azure OpenAI client library to generate vector embeddings.
- [`Azure.Identity`](https://www.nuget.org/packages/Azure.Identity): Passwordless authentication with Microsoft Entra ID via `DefaultAzureCredential`.
- [`Azure.ResourceManager.CosmosDB`](https://www.nuget.org/packages/Azure.ResourceManager.CosmosDB): ARM SDK to create and delete SQL containers with vector indexes.
- [`Microsoft.Azure.Cosmos`](https://www.nuget.org/packages/Microsoft.Azure.Cosmos): Azure Cosmos DB data-plane client for document ingestion and vector queries.
- [`Microsoft.Extensions.Configuration.EnvironmentVariables`](https://www.nuget.org/packages/Microsoft.Extensions.Configuration.EnvironmentVariables): Loads configuration from environment variables.
- [`Microsoft.Extensions.Configuration.Json`](https://www.nuget.org/packages/Microsoft.Extensions.Configuration.Json): Loads configuration from `appsettings.json`.
- [`Newtonsoft.Json`](https://www.nuget.org/packages/Newtonsoft.Json): JSON serialization and deserialization.

### Authenticate to Azure

The sample uses passwordless authentication via `DefaultAzureCredential` and Microsoft Entra ID. Sign in to Azure before you run the sample so it can access your Azure resources securely.

> [!NOTE]
> Ensure your signed-in identity has the required control-plane (**Cosmos DB Operator**) and data-plane (**Cosmos DB Built-in Data Contributor**, **Cognitive Services OpenAI User**) roles before running the sample.

# [Azure CLI](#tab/azure-cli)

```azurecli
az login
```

# [Azure Developer CLI](#tab/azure-developer-cli)

```bash
azd auth login
```

# [Azure PowerShell](#tab/azure-powershell)

```powershell
Connect-AzAccount
```

---

## Provision and configure the app resources

### Provision the resources

1. Clone the sample repository:

    ```bash
    git clone https://github.com/Azure-Samples/cosmos-db-vector-samples.git
    ```

2. Navigate to the `nosql-create-index-dotnet` sample folder:

    ```bash
    cd cosmos-db-vector-samples/nosql-create-index-dotnet
    ```

3. Create the `./data` directory and copy the shared hotel dataset into it:

    ```bash
    mkdir -p ./data
    cp ../data/HotelsData_toCosmosDB_Vector_byRegion.json ./data/
    ```

    The sample expects the data file at: `./data/HotelsData_toCosmosDB_Vector_byRegion.json`

4. Generate `appsettings.json`.

    If you deployed with `azd up`, run the helper script from the sample root to generate `appsettings.json` from your `azd` environment values.

    **Windows (PowerShell):**

    ```powershell
    .\scripts\generate-appsettings.ps1
    ```

    **macOS / Linux:**

    ```bash
    chmod +x ./scripts/generate-appsettings.sh
    ./scripts/generate-appsettings.sh
    ```

    Otherwise, copy `appsettings.example.json` to `appsettings.json` and fill in your values manually.

> [!NOTE]
> The sample creates and deletes only the `hotels_diskann` and `hotels_quantizedflat` containers via ARM. The `HotelsCreateIndex` database and your Azure Cosmos DB account must already exist before you run the sample.

### Configure the app

Update `appsettings.json` with your Azure resource values:

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
    "Endpoint": "https://<your-openai-resource>.openai.azure.com/",
    "Deployment": "text-embedding-3-small",
    "ApiVersion": "2024-08-01-preview"
  },
  "VectorAlgorithm": "",
  "EmbeddedField": "embedding",
  "DataFilePath": "./data/HotelsData_toCosmosDB_Vector_byRegion.json"
}
```

> [!NOTE]
> The `SubscriptionId`, `ResourceGroup`, and `AccountName` settings are required for the ARM container-creation path. If you prefer environment variables, use `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`, and `AZURE_COSMOSDB_ACCOUNT_NAME`. Missing values cause a runtime failure during ARM lookup, not at startup.

Leave `ContainerName` and `VectorAlgorithm` empty to process both containers. The sample always creates and cleans up both containers. Set `VectorAlgorithm` to focus ingestion and queries on one container after both are recreated:

- `diskann`
- `quantizedflat`

## Build and run the project

Restore NuGet packages:

```powershell
dotnet restore
```

Run the sample:

```powershell
dotnet run --project .\nosql-create-index-dotnet.csproj
```

**What the sample does:**

1. Connects to the Azure Cosmos DB data plane and Azure OpenAI using `DefaultAzureCredential`
2. Reads `./data/HotelsData_toCosmosDB_Vector_byRegion.json` using `System.Text.Json`
3. Recreates `hotels_diskann` and `hotels_quantizedflat` containers with vector indexes via the ARM SDK
4. Groups documents by `Region` and upserts one transactional batch per region
5. Generates a query embedding with the Azure OpenAI client
6. Runs **three separate** `VectorDistance()` SQL queries with different distance functions, scoping each to one partition via `QueryRequestOptions.PartitionKey`:
   - **Cosine:** Measures the angle between vectors (values: 0 to 2)
   - **DotProduct:** Inner product of vectors (values: any real number)
   - **Euclidean:** Straight-line distance between vectors (values: 0 to 2 for unit-normalized vectors; √6144 is the theoretical max for non-normalized vectors)
7. Prints the top 5 matching hotels for each distance function, showing how rankings differ
8. Deletes both sample containers during cleanup

**Example output:**

```output
Using Azure OpenAI Embedding Deployment/Model: text-embedding-3-small
Reading JSON file from C:\...\nosql-create-index-dotnet\data\HotelsData_toCosmosDB_Vector_byRegion.json
✓ Region validation passed. Found regions: Midwest, Northeast, South, West
  Region 'Northeast': 10 documents
  Region 'Midwest': 10 documents
  Region 'South': 14 documents
  Region 'West': 16 documents
Loaded 50 documents

=== Step 1: Create Container with Vector Index ===
  Container:      hotels_diskann
  Index type:     diskANN
  Dimensions:     1536
  Distance func:  cosine (queried with all 3 metrics)
  Deleting existing container if present...
  Container does not exist (OK)
  Created in 6.7s
  Vector index is IMMUTABLE — cannot be changed after creation

# ... hotels_quantizedflat container creation output (same format as above) ...
# ... document ingestion output for hotels_diskann and hotels_quantizedflat omitted for brevity ...
# ... At runtime: documents are grouped by Region and upserted via TransactionalBatch ...
# ... (Northeast: 10, Midwest: 10, South: 14, West: 16 documents per container) ...

Query: "hotel near the ocean"
Embedding generated (1536 dimensions)

Running searches (top 5 results for each distance function)...
  ✓ hotels_diskann queried (3.54 RUs)
  ✓ hotels_diskann queried (3.54 RUs)
  ✓ hotels_diskann queried (3.54 RUs)
  ✓ hotels_quantizedflat queried (3.54 RUs)
  ✓ hotels_quantizedflat queried (3.54 RUs)
  ✓ hotels_quantizedflat queried (3.54 RUs)

| Index Type     | Distance Function | Top 1 Result               | Score  | Top 2 Result               | Score  | Diff   |
|----------------|-------------------|----------------------------|--------|----------------------------|--------|--------|
| DiskANN        | Cosine            | City Center Summer Wind... | 0.4025 | Red Tide Hotel             | 0.4000 | 0.0025 |
| DiskANN        | DotProduct        | City Center Summer Wind... | 0.4027 | Red Tide Hotel             | 0.4001 | 0.0025 |
| DiskANN        | Euclidean         | City Center Summer Wind... | 1.0934 | Red Tide Hotel             | 1.0957 | -0.0023 |
| QuantizedFlat  | Cosine            | City Center Summer Wind... | 0.4025 | Red Tide Hotel             | 0.4000 | 0.0025 |
| QuantizedFlat  | DotProduct        | City Center Summer Wind... | 0.4027 | Red Tide Hotel             | 0.4001 | 0.0025 |
| QuantizedFlat  | Euclidean         | City Center Summer Wind... | 1.0934 | Red Tide Hotel             | 1.0957 | -0.0023 |

=== Cleanup: Remove Sample Containers ===
  ✓ Deleted container: hotels_diskann
  ✓ Deleted container: hotels_quantizedflat

Complete
```

## Understand the vector distance functions

The sample's core purpose is comparing all three distance functions against the same containers and query embedding. Each function measures "closeness" differently, and that affects both the numeric scores and, for near-ties, the ranking.

### What each function measures

| Function | What it measures | Score range |
|----------|-----------------|-------------|
| **Cosine** | The angle between two vectors — magnitude-independent | 0 to 2 |
| **DotProduct** | The inner product — accounts for both direction and magnitude | Any real number (0 to 1 for the unit-normalized vectors this sample uses) |
| **Euclidean** | Straight-line (L2) distance between vector endpoints — magnitude-sensitive | 0 to 2 (for unit-normalized vectors; √6144 is the general theoretical max for non-normalized vectors with components in [−1, 1]) |

### How the example output reflects these differences

In the example output table, Cosine and DotProduct produce nearly identical scores (0.4025 vs 0.4027 for the top result) and return the hotels in the same order. Euclidean produces scores in a completely different magnitude range (around 1.09) for the same hotels.

**Why Cosine and DotProduct agree here:** The `text-embedding-3-small` model produces unit-normalized vectors (magnitude = 1). For unit-normalized vectors, cosine distance and the dot product are mathematically equivalent in ranking: the angle between two vectors fully captures their similarity when magnitudes are all equal. As a result, both functions rank documents identically.

**Why Euclidean differs:** Euclidean distance is a true distance metric — lower scores mean more similar. `ORDER BY VectorDistance(...)` therefore returns results in ascending score order, so the top-1 score is always lower than the top-2 score. This makes the `Diff` (top1 − top2) **structurally negative** for Euclidean — it is a property of the metric and sort order, not a sign of magnitude accumulation across dimensions. In the example output, the Euclidean rows show the **same hotels at rank 1 and rank 2** as Cosine and DotProduct; there is no reordering in this sample. Observing metric-driven reordering would require a dataset with close near-ties where the choice of distance function changes relative ordering.

### How the distance function override works

Each query in this sample passes the function via the `distanceFunction` option in `VectorDistance()`:

```sql
VectorDistance(c.embedding, @embedding, false, {'distanceFunction': 'Cosine'})
```

The third argument (`false`) tells Cosmos DB to use the vector index if one exists (as opposed to `true`, which forces a brute-force scan). The `distanceFunction` key in the options object overrides the function stored in the container's vector embedding policy for that query only. See the [VectorDistance reference](/azure/cosmos-db/nosql/query/vectordistance) for the full signature.

> [!TIP]
> Match the query distance function to how your embedding model was trained. `cosine` is the standard default for OpenAI text embedding models, including `text-embedding-3-small`. Querying with a different function than the one stored in the container's vector policy still computes correctly, but may not use the vector index as efficiently.

## Explore the app code

The following sections walk through the most important code in the sample. [Visit the GitHub repo](https://github.com/Azure-Samples/cosmos-db-vector-samples/tree/main/nosql-create-index-dotnet) to explore the full app code.

### Explore the credential and client setup

The sample authenticates to both Azure Cosmos DB and Azure OpenAI using `DefaultAzureCredential`, which automatically picks up the credentials you established with `az login` or `azd auth login`:

```csharp
var credential = new DefaultAzureCredential();

using var cosmosClient = new CosmosClient(
    config.CosmosEndpoint,
    credential,
    new CosmosClientOptions { AllowBulkExecution = true });

var azureOpenAIClient = new AzureOpenAIClient(
    new Uri(config.OpenAIEmbeddingEndpoint),
    credential,
    new AzureOpenAIClientOptions(AzureOpenAIClientOptions.ServiceVersion.V2024_10_21));
```

The preceding code:

- Creates a `DefaultAzureCredential` that uses the identity you signed in with via the Azure CLI
- Passes the same credential to both `CosmosClient` (data plane) and `AzureOpenAIClient`
- Enables `AllowBulkExecution` on the Cosmos DB client for efficient batch ingestion

> [!NOTE]
> The third `AzureOpenAIClient` constructor argument sets an explicit API version. The sample reads `OpenAiSettings:ApiVersion` from `appsettings.json` (or the `AZURE_OPENAI_EMBEDDING_API_VERSION` environment variable). The code maps `2024-06-01` to the `V2024_06_01` service version; every other value, including the default `2024-08-01-preview`, maps to `V2024_10_21`.

### Explore the control-plane container creation

The sample uses the Azure Resource Manager SDK (`Azure.ResourceManager.CosmosDB`) to recreate both containers with different vector index types. DiskANN is a graph-based approximate nearest-neighbor index optimized for low latency at scale. QuantizedFlat uses vector quantization techniques for high recall with efficient RU consumption at scale.

```csharp
var armClient = new ArmClient(credential);
var accountIdentifier = CosmosDBAccountResource.CreateResourceIdentifier(
    config.SubscriptionId,
    config.ResourceGroup,
    config.AccountName);

var accountResource = armClient.GetCosmosDBAccountResource(accountIdentifier);
var account = await accountResource.GetAsync(cancellationToken);
var database = await account.Value.GetCosmosDBSqlDatabaseAsync(config.DatabaseName, cancellationToken);
var containers = database.Value.GetCosmosDBSqlContainers();

var indexConfigs = new[]
{
    (Name: "hotels_diskann", IndexType: CosmosDBVectorIndexType.DiskAnn),
    (Name: "hotels_quantizedflat", IndexType: CosmosDBVectorIndexType.QuantizedFlat)
};

foreach (var indexConfig in indexConfigs)
{
    await DeleteContainerIfExistsAsync(containers, indexConfig.Name, cancellationToken);
    var containerDefinition = BuildContainerDefinition(
        indexConfig.Name,
        indexConfig.IndexType,
        embeddingPath,
        config.ExpectedDimensions,
        account.Value.Data.Location);
    await containers.CreateOrUpdateAsync(WaitUntil.Completed, indexConfig.Name, containerDefinition, cancellationToken);
}
```

The preceding code:

- Authenticates to the ARM layer using the same `DefaultAzureCredential`
- Deletes any pre-existing sample containers to ensure a clean state
- Creates `hotels_diskann` with a DiskANN vector index
- Creates `hotels_quantizedflat` with a QuantizedFlat vector index
- Sets `cosine` as the stored distance function; all three metrics are supported at query time

> [!NOTE]
> **Container-level settings are fixed at creation.** The vector index type (DiskANN or QuantizedFlat) and the container's vector embedding policy — including the embedding path, number of dimensions, and the stored default distance function (`cosine` in this sample) — cannot be changed without deleting and recreating the container.
>
> **The distance function is overridable at query time.** Each individual query can specify a different distance function via the `distanceFunction` option in `VectorDistance()` (Cosine, DotProduct, or Euclidean). That is how this sample queries a single `cosine` container with all three metrics. For the most efficient index usage, query with the same distance function stored in the container's vector embedding policy.

### Explore the document ingestion

The sample groups the 50 hotel documents by `Region` and uses a transactional batch per region to upsert documents in one round-trip per partition:

```csharp
var documentsByRegion = GroupDocumentsByRegion(documents);

foreach (var regionGroup in documentsByRegion)
{
    var transactionalBatch = container.CreateTransactionalBatch(
        BuildRegionPartitionKey(regionGroup.Key));
    foreach (var document in regionGroup.Value)
    {
        transactionalBatch.UpsertItem(document);
    }
    using TransactionalBatchResponse response = await transactionalBatch.ExecuteAsync(cancellationToken);
}
```

The preceding code:

- Groups documents by `Region` partition key (Northeast, Midwest, South, West)
- Creates a `TransactionalBatch` per region — all documents in a region land in the same partition in one atomic operation
- Uses `UpsertItem` so the sample is safe to re-run without duplicate-key errors

### Explore the vector similarity queries

After ingestion, the sample generates a query embedding and runs three separate SQL queries, one per distance function. Each query is scoped to a single partition:

```csharp
// Generate the query embedding
EmbeddingClient embeddingClient = azureOpenAIClient.GetEmbeddingClient(config.OpenAIEmbeddingDeployment);
var response = await embeddingClient.GenerateEmbeddingAsync(config.QueryText, cancellationToken: cancellationToken);
var queryEmbedding = response.Value.ToFloats().ToArray();

// Run one query per distance function, scoped to a single partition
var distanceFunctions = new[] { "Cosine", "DotProduct", "Euclidean" };

foreach (var distanceFunction in distanceFunctions)
{
    var queryDefinition = new QueryDefinition(
        $"SELECT TOP @topK c.HotelId, c.HotelName, c.Description, " +
        $"VectorDistance(c.{config.EmbeddingFieldName}, @embedding, false, {{'distanceFunction': '{distanceFunction}'}}) AS SimilarityScore " +
        $"FROM c " +
        $"ORDER BY VectorDistance(c.{config.EmbeddingFieldName}, @embedding, false, {{'distanceFunction': '{distanceFunction}'}})")
        .WithParameter("@topK", config.TopCount)
        .WithParameter("@embedding", queryEmbedding);

    var queryRequestOptions = new QueryRequestOptions
    {
        PartitionKey = BuildRegionPartitionKey(config.PartitionKeyValue)
    };

    using var iterator = container.GetItemQueryIterator<VectorSearchRow>(
        queryDefinition,
        requestOptions: queryRequestOptions);

    while (iterator.HasMoreResults)
    {
        foreach (var row in await iterator.ReadNextAsync(cancellationToken))
        {
            Console.WriteLine($"  {row.HotelName} (score: {row.SimilarityScore:F4})");
        }
    }
}
```

The preceding code:

- Generates a 1536-dimension embedding for `"hotel near the ocean"` using `text-embedding-3-small`
- Injects the embedding field name via `ValidateEmbeddingFieldName` as a validated string (not a SQL parameter) — Cosmos DB SQL doesn't support dynamic field references via parameters, and the validation rejects field names that don't match a safe identifier pattern
- Runs three queries — Cosine, DotProduct, Euclidean — to show how rankings differ across distance functions
- Passes `@topK` and `@embedding` as safe SQL parameters
- Uses `BuildRegionPartitionKey` (backed by `PartitionKeyBuilder`) because the containers use a hierarchical (MultiHash) partition key; the single-value `new PartitionKey(string)` constructor fails at runtime for MultiHash containers

### Explore the single-partition query pattern

The sample scopes every query to a single partition using the **SDK partition filter**: it sets `QueryRequestOptions.PartitionKey` to the value from `config.PartitionKeyValue` (default `"Northeast"`). The SDK routes the request directly to the physical partition that owns that partition-key value — no cross-partition fan-out occurs.

| Mechanism | How it works | Sample code |
|-----------|-------------|-------------|
| **SDK partition key** (used in this sample) | Sets `QueryRequestOptions.PartitionKey`; the SDK routes the request to the single physical partition that owns the specified value | `queryRequestOptions.PartitionKey = BuildRegionPartitionKey(config.PartitionKeyValue)` |

**Benefits of single-partition queries:**

| Metric | Single-Partition | Cross-Partition |
|--------|------------------|-----------------|
| **RU cost** | ~3 RUs per query | ~12 RUs per query |
| **Documents searched** | 10-15 (one region) | 50 (all regions) |
| **Query latency** | Lower | Higher |

> [!NOTE]
> **Alternative: SQL `WHERE` clause on the partition key path.** The same single-partition scope can alternatively be expressed as a predicate on the partition key path directly in the query SQL. Because `/Region` is the container's partition key, the query engine resolves `WHERE c.Region = '<value>'` to the same single physical partition. For example:
>
> ```sql
> SELECT TOP @topK c.HotelId, c.HotelName, c.Description,
>        VectorDistance(c.embedding, @embedding, false, {'distanceFunction': 'Cosine'}) AS SimilarityScore
> FROM c
> WHERE c.Region = "Northeast"
> ORDER BY VectorDistance(c.embedding, @embedding, false, {'distanceFunction': 'Cosine'})
> ```
>
> This is an equivalent way to express the intent in SQL. **This sample does not use this form.** The sample uses the SDK partition filter (`QueryRequestOptions.PartitionKey`) instead, which routes the request at the SDK layer before the query is dispatched.

Override the default `"Northeast"` partition key value (read from `config.PartitionKeyValue`) with `CosmosDbSettings:PartitionKeyValue` in `appsettings.json`:

```json
{
  "CosmosDbSettings": {
    "PartitionKeyValue": "Midwest"
  }
}
```

> [!NOTE]
> An `ORDER BY VectorDistance(...)` clause is **required** for nearest-neighbor ranking. Without it, `SELECT TOP N` returns N arbitrary documents, not the N nearest neighbors. The `ORDER BY` expression must repeat the same `VectorDistance(...)` call used in the `SELECT` clause.

## View and manage data in Visual Studio Code

Use the **Azure Databases** extension for Visual Studio Code to connect to your Azure Cosmos DB account and browse the `hotels_diskann` and `hotels_quantizedflat` containers.

1. In Visual Studio Code, select the **Azure** icon in the Activity Bar.
2. Under **Resources**, expand **Azure Cosmos DB** and locate your account.
3. Expand your account > **HotelsCreateIndex** > **hotels_diskann** or **hotels_quantizedflat**.
4. Select a document to view its hotel fields and the `embedding` vector array.

> [!NOTE]
> The sample deletes both containers at the end of each run. Browse the data before cleanup completes, or comment out the cleanup call in `Program.cs` to retain the containers for inspection.

## Clean up resources

The sample automatically deletes both `hotels_diskann` and `hotels_quantizedflat` containers during its cleanup step at the end of each run. To remove the remaining Azure resources provisioned for this sample, choose one of the following options.

# [Azure portal](#tab/azure-portal)

1. In the [Azure portal](https://portal.azure.com), navigate to your resource group.
2. Select **Delete resource group**, enter the resource group name to confirm, and select **Delete**.

# [Azure CLI](#tab/azure-cli)

```azurecli
az group delete --name <your-resource-group> --yes --no-wait
```

# [Azure PowerShell](#tab/azure-powershell)

```azurepowershell
Remove-AzResourceGroup -Name <your-resource-group> -Force -AsJob
```

---

> [!TIP]
> Review the full sample output in `output/sample-output.txt`. Try setting `VectorAlgorithm` to `diskann` or `quantizedflat` in `appsettings.json` to focus ingestion and queries on one container after both sample containers are recreated.

## Authentication and permissions

All Azure clients use `DefaultAzureCredential`. For local runs, sign in with `az login` or `azd auth login`. Hosted execution can use managed identity. The selected identity needs management-plane permission to create and delete the two configured containers, Cosmos DB data-plane access to insert and query documents, and the Cognitive Services OpenAI User role. Keys and connection strings aren't supported.

## Validate and clean generated artifacts

From the repository root, validate this sample with the shared validator:

```powershell
pwsh -NoProfile -File .github\skills\sample-validate-nosql-create-index\scripts\validate-create-index-samples.ps1 -Language DotNet
```

Preview and then remove generated local artifacts:

```powershell
pwsh -NoProfile -File .github\scripts\clean-all-create-index.ps1 -Language DotNet -WhatIf
pwsh -NoProfile -File .github\scripts\clean-all-create-index.ps1 -Language DotNet
```

## Related content

- [Vector search in Azure Cosmos DB for NoSQL](/azure/cosmos-db/nosql/vector-search)
- [VectorDistance function reference](/azure/cosmos-db/nosql/query/vectordistance)
- [Vector indexes in Azure Cosmos DB for NoSQL](/azure/cosmos-db/nosql/vector-index)

> [!WARNING]
> The sample deletes `hotels_diskann` and `hotels_quantizedflat` before creation and during cleanup. Custom container names require `AZURE_COSMOSDB_CREATE_INDEX_ALLOW_DESTRUCTIVE_OPERATIONS=true`.
