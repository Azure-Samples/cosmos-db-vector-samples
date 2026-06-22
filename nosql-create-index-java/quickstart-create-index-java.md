---
title: Quickstart: Create and query vector indexes in Azure Cosmos DB for NoSQL using Java
description: Create vector indexes in Azure Cosmos DB for NoSQL using Java and the ARM SDK. Load pre-vectorized hotel documents and compare vector distance functions (Cosine, DotProduct, Euclidean).
author: diberry
ms.author: diberry
ms.service: azure-cosmos-db
ms.topic: quickstart
ms.date: 2026-06-22
---

# Quickstart: Create and query vector indexes in Azure Cosmos DB for NoSQL using Java

In this quickstart, you run the Java create-index sample for Azure Cosmos DB for NoSQL to demonstrate two key goals:

- **Goal 1 (Control Plane):** Use the ARM SDK to create the `HotelsCreateIndex` database and two vector-indexed containers: `hotels_diskann` (approximate search) and `hotels_quantizedflat` (exact search).
- **Goal 2 (Distance Functions):** Compare how the same query embedding produces different scores and rankings when using different vector distance functions: Cosine, DotProduct, and Euclidean.

## Prerequisites

- An Azure subscription. If you don't have one, create a [free account](https://azure.microsoft.com/free/).
- [Java 17 LTS](https://learn.microsoft.com/java/openjdk/download)
- [Apache Maven 3.9](https://maven.apache.org/download.cgi) or later
- [Azure CLI](/cli/azure/install-azure-cli) installed and signed in with `az login`.
- An Azure Cosmos DB for NoSQL account with vector search enabled.
- Microsoft Entra ID roles for your identity:
  - **Cosmos DB Built-in Data Contributor**
  - **Cognitive Services OpenAI User**
- An Azure OpenAI resource with a `text-embedding-3-small` deployment.

> [!IMPORTANT]
> **Two Phases:**
>
> 1. **Control Plane (Goal 1):** The sample uses the ARM SDK (azure-resourcemanager-cosmos 2.54.3) with `DefaultAzureCredential` to create:
>    - Database: `HotelsCreateIndex`
>    - Containers: `hotels_diskann` (DiskANN index) and `hotels_quantizedflat` (QuantizedFlat index)
>    - Partition key path: `/Region` (valid values: `Northeast`, `Midwest`, `South`, `West`)
>    - Vector field path: `/embedding` (1536 dimensions, float32)
>
> 2. **Data Plane (Goal 2):** After containers are created, the sample:
>    - Loads pre-vectorized hotel documents
>    - Inserts them using bulk-upsert operations
>    - Generates a query embedding with Azure OpenAI
>    - Runs `VectorDistance()` queries with three distance functions: **Cosine**, **DotProduct**, and **Euclidean**
>    - Displays rankings for each distance function to show how results differ

## Clone the repository

```bash
git clone https://github.com/Azure-Samples/cosmos-db-vector-samples.git
cd cosmos-db-vector-samples/nosql-create-index-java
```

## Set up the data directory

The sample requires `HotelsData_toCosmosDB_Vector.json` to be in a local `data/` subdirectory:

```bash
# Create the data directory if it doesn't exist
mkdir -p ./data

# Copy the data file from the shared location
cp ../HotelsData_toCosmosDB_Vector.json ./data/
```

The sample expects the data file at: `./data/HotelsData_toCosmosDB_Vector.json`

## Understand what the sample does

The Java create-index sample demonstrates both control plane and data plane operations:

| Layer | Tool | Responsibility |
|---|---|---|
| Provisioning | Java ARM SDK | Creates the Azure Cosmos DB database and containers with vector policies |
| Runtime | Java data plane SDK | Loads documents, generates query embeddings, and runs `VectorDistance()` queries |

Both phases use `DefaultAzureCredential` for authentication, so you don't need to manage API keys or connection strings.

> [!NOTE]
> **RBAC roles:** Data-plane RBAC role definitions and assignments are created by `azd up` via Bicep templates (if using it), or can be created programmatically using the management SDK — see [`SqlResources.beginCreateUpdateSqlRoleDefinition`](https://learn.microsoft.com/java/api/com.azure.resourcemanager.cosmos.models.sqlresources.begincreateupdate-sqlroledefinition) (Java).

## Configure environment variables

1. Configure environment variables.

   **If you deployed with `azd up`:**

   ```bash
   azd env get-values > .env
   ```

   **Otherwise**, copy the template and fill in values from the Azure portal:

   ```bash
   cp sample.env .env
   ```

2. Update `.env` with your Azure resource values:

   ```dotenv
   AZURE_COSMOSDB_ENDPOINT="https://<your-account>.documents.azure.com:443/"
   AZURE_COSMOSDB_DATABASENAME="HotelsCreateIndex"
   AZURE_COSMOSDB_CONTAINER_NAME=""
   AZURE_OPENAI_EMBEDDING_ENDPOINT="https://<your-openai-resource>.openai.azure.com/"
   AZURE_OPENAI_EMBEDDING_DEPLOYMENT="text-embedding-3-small"
   AZURE_OPENAI_EMBEDDING_API_VERSION="2024-08-01-preview"
   VECTOR_ALGORITHM=""
   DATA_FILE_WITH_VECTORS="./data/HotelsData_toCosmosDB_Vector.json"
   AZURE_COSMOSDB_CREATE_INDEX_EMBEDDED_FIELD="embedding"
   ```

Leave `AZURE_COSMOSDB_CONTAINER_NAME` and `VECTOR_ALGORITHM` empty to run both containers. Set `VECTOR_ALGORITHM` to `diskann` or `quantizedflat` if you want to target one algorithm.

## Build and run the sample

Compile the sample:

```bash
mvn compile
```

Run it:

```bash
mvn exec:java
```

**What the sample does:**

The sample demonstrates both goals in sequence:

**Goal 1 - Control Plane (create containers with vector indexes):**
1. Loads configuration from environment variables
2. Authenticates with `DefaultAzureCredential`
3. Creates an Azure Resource Manager client
4. Creates the `HotelsCreateIndex` database (if needed)
5. Creates the `hotels_diskann` container with DiskANN vector index on `/embedding`
6. Creates the `hotels_quantizedflat` container with QuantizedFlat vector index on `/embedding`

**Goal 2 - Data Plane (load and query with distance functions):**
1. Creates a Cosmos DB data plane client using `DefaultAzureCredential`
2. Reads `.../data/HotelsData_toCosmosDB_Vector.json`
3. Bulk-upserts documents into both containers
4. Uses the Azure OpenAI client to generate a query embedding
5. Executes **three separate** parameterized `VectorDistance()` queries with different distance functions:
   - **Cosine:** Measures angle between vectors (values: 0 to 2)
   - **DotProduct:** Inner product of vectors (values: any real number)
   - **Euclidean:** Straight-line distance between vectors (values: 0 to √6144)
6. Prints the top 5 matching hotels for each distance function, showing how rankings differ

## Review the Java project structure

```text
nosql-create-index-java/
├── .env.example
├── output/
│   └── sample-output.txt
├── pom.xml
├── README.md
├── sample.env
└── src/main/java/com/azure/cosmos/createindex/
    ├── App.java
    ├── Config.java
    └── DataPlane.java
```

### ControlPlane.java

`ControlPlane.java` uses the ARM SDK (azure-resourcemanager-cosmos 2.54.3) to create the database and containers with vector indexes. This demonstrates **Goal 1** (control plane).

### App.java

`App.java` orchestrates the sample. It loads configuration, creates the shared credential, verifies embedding dimensions, ingests the hotel dataset, and runs vector queries for each target container.

### Config.java

`Config.java` loads environment variables from the shell, resolves the shared dataset path, and maps `VECTOR_ALGORITHM` values to the existing container names.

### DataPlane.java

`DataPlane.java` contains the Azure Cosmos DB and Azure OpenAI client factories plus the data-plane operations:

- bulk upsert using `executeBulkOperations()`
- embedding generation with `EmbeddingsOptions`
- field-name validation before interpolating the embedding field into `VectorDistance()`
- parameterized SQL queries for the embedding vector and `TOP` value

## Key implementation details

### Goal 1: Create containers using ARM SDK (azure-resourcemanager-cosmos 2.54.3)

The control-plane phase uses the ARM SDK with `DefaultAzureCredential` to create containers with vector policies:

```java
// Create Azure credential
TokenCredential credential = new DefaultAzureCredentialBuilder().build();

// Authenticate and get Azure Resource Manager with subscription
AzureResourceManager azure = AzureResourceManager
    .authenticate(credential, profile)
    .withSubscription(subscriptionId);

// Get the SQL resources client
SqlResourcesClient sqlResourcesClient = azure.cosmosDBAccounts()
    .manager()
    .serviceClient()
    .getSqlResources();

// Create database
sqlResourcesClient.createUpdateSqlDatabase(
    resourceGroup,
    accountName,
    DATABASE_NAME,
    new SqlDatabaseCreateUpdateParameters()
        .withLocation(location)
        .withResource(new SqlDatabaseResource().withId(DATABASE_NAME))
        .withOptions(new CreateUpdateOptions()));

// Build vector embedding policy
VectorEmbedding vectorEmbedding = new VectorEmbedding()
    .withPath(EMBEDDING_PATH)
    .withDataType(VectorDataType.FLOAT32)
    .withDimensions(EMBEDDING_DIMENSIONS)
    .withDistanceFunction(DistanceFunction.COSINE);

VectorEmbeddingPolicy vectorEmbeddingPolicy = new VectorEmbeddingPolicy()
    .withVectorEmbeddings(Arrays.asList(vectorEmbedding));

// Build vector index
VectorIndex vectorIndex = new VectorIndex()
    .withPath(EMBEDDING_PATH)
    .withType(indexType);  // VectorIndexType.DISK_ANN or QUANTIZED_FLAT

// Create container with vector policies
sqlResourcesClient.createUpdateSqlContainer(
    resourceGroup,
    accountName,
    DATABASE_NAME,
    containerName,
    new SqlContainerCreateUpdateParameters()
        .withLocation(location)
        .withResource(new SqlContainerResource()
            .withId(containerName)
            .withPartitionKey(new ContainerPartitionKey()
                .withPaths(Arrays.asList(REGION_PARTITION_KEY))
                .withKind(PartitionKind.HASH))
            .withVectorEmbeddingPolicy(vectorEmbeddingPolicy)
            .withIndexingPolicy(buildIndexingPolicy(vectorIndex)))
        .withOptions(new CreateUpdateOptions()
            .withThroughput(THROUGHPUT_RUS)));
```

### Goal 2: Bulk-insert documents and query with distance functions

After creating containers, bulk-insert documents and generate query embeddings:

```java
// Create Azure Cosmos DB client
CosmosClient cosmosClient = new CosmosClientBuilder()
    .endpoint(cosmosEndpoint)
    .credential(credential)
    .buildClient();

// Load and bulk-insert documents
List<HotelDocument> documents = loadDocuments();
container.executeBulkOperations(
    documents.stream()
        .map(doc -> new CosmosItemOperation(CosmosItemOperationType.UPSERT, doc.getId(), doc))
        .collect(Collectors.toList())
);

// Generate query embedding using Azure OpenAI
EmbeddingsOptions embeddingOptions = new EmbeddingsOptions(Arrays.asList(queryText))
    .setDimensions(EMBEDDING_DIMENSIONS);
EmbeddingsUsage embeddingUsage = openaiClient.getEmbeddings(EMBEDDING_DEPLOYMENT, embeddingOptions);
List<Float> queryEmbedding = embeddingUsage.getData().get(0).getEmbedding();

// Query with each distance function
String[] distanceFunctions = {"Cosine", "DotProduct", "Euclidean"};
for (String distanceFunc : distanceFunctions) {
    String query = String.format(
        "SELECT TOP 5 c.HotelId, c.HotelName, c.Description, " +
        "VectorDistance(c.embedding, @embedding, false, {'distanceFunction': '%s'}) AS similarityScore " +
        "FROM c WHERE c.Region = @partitionKey",
        distanceFunc);

    SqlQuerySpec querySpec = new SqlQuerySpec(query)
        .withParameters(Arrays.asList(
            new SqlParameter("@embedding", queryEmbedding),
            new SqlParameter("@partitionKey", "Northeast")));

    container.queryItems(querySpec, new CosmosQueryRequestOptions().setPartitionKey(new PartitionKey("Northeast")), HotelDocument.class)
        .stream()
        .limit(5)
        .forEach(doc -> System.out.printf("  %s (score: %.4f)%n", doc.getHotelName(), doc.getSimilarityScore()));
}
```

## Expected output

The sample prints embedding validation, ingestion status, and query results for each container. A representative output file is included in `output/sample-output.txt`.

## Next steps

- Learn more about [Azure Cosmos DB for NoSQL vector search](/azure/cosmos-db/nosql/vector-search).
- Review the full sample repo for other languages and scenarios.
- If you haven't provisioned the shared infrastructure yet, run `azd up` from the repo root before rerunning the Java sample.
