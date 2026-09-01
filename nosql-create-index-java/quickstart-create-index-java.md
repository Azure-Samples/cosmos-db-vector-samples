---
title: Quickstart: Create and query vector indexes in Azure Cosmos DB for NoSQL using Java
description: Create vector indexes in Azure Cosmos DB for NoSQL using Java and the ARM SDK. Load pre-vectorized hotel documents and compare vector distance functions (Cosine, DotProduct, Euclidean).
author: diberry
ms.author: diberry
ms.service: azure-cosmos-db
ms.topic: quickstart
ms.date: 2026-06-22
---

# Quickstart: Create vector index in Azure Cosmos DB for NoSQL using Java

In this quickstart, you run the Java create-index sample for Azure Cosmos DB for NoSQL to demonstrate two key goals:

- **Goal 1 (Control Plane):** Use the ARM SDK to recreate two vector-indexed containers in the existing `HotelsCreateIndex` database: `hotels_diskann` (DiskANN approximate search) and `hotels_quantizedflat` (QuantizedFlat uses vector quantization techniques).
- **Goal 2 (Distance Functions):** Compare how the same query embedding produces different scores and rankings when using different vector distance functions: Cosine, DotProduct, and Euclidean.

## Prerequisites

- An Azure subscription. If you don't have one, create a [free account](https://azure.microsoft.com/free/).
- [Java 21 LTS](https://learn.microsoft.com/java/openjdk/download)
- [Apache Maven 3.9](https://maven.apache.org/download.cgi) or later
- [Azure CLI](/cli/azure/install-azure-cli) installed and signed in with `az login`.
- An Azure Cosmos DB for NoSQL account with vector search enabled.
- Microsoft Entra ID roles for your identity:
  - **Cosmos DB Built-in Data Contributor**
  - **Cognitive Services OpenAI User**
- An Azure OpenAI resource with a `text-embedding-3-small` deployment.
- To enable infrastructure provisioning for the create-index scenario, set `AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME=HotelsCreateIndex` before running `azd up`. The infrastructure creates the database selected by the deployment scenario. For the create-index scenario, it creates `HotelsCreateIndex`.

> [!IMPORTANT]
> **Two Phases:**
>
> 1. **Control Plane (Goal 1):** The sample uses the ARM SDK (azure-resourcemanager-cosmos 2.49.0) with `DefaultAzureCredential` to manage:
>    - Uses the existing database: `HotelsCreateIndex`
>    - Deletes and recreates containers: `hotels_diskann` (DiskANN index) and `hotels_quantizedflat` (QuantizedFlat index)
>    - Partition key path: `/Region` (valid values: `Northeast`, `Midwest`, `South`, `West`)
>    - Vector field path: `/embedding` (1536 dimensions, float32)
>
> 2. **Data Plane (Goal 2):** After containers are created, the sample:
>    - Loads pre-vectorized hotel documents
>    - Inserts them using bulk-upsert operations
>    - Generates a query embedding with Azure OpenAI
>    - Runs `VectorDistance()` queries with three distance functions: **Cosine**, **DotProduct**, and **Euclidean**
>    - Displays rankings for each distance function to show how results differ
>    - Deletes both sample containers during cleanup

## Clone the repository

```bash
git clone https://github.com/Azure-Samples/cosmos-db-vector-samples.git
cd cosmos-db-vector-samples/nosql-create-index-java
```

## Set up the data directory

The sample requires `HotelsData_toCosmosDB_Vector_byRegion.json` to be in a local `data/` subdirectory:

```bash
# Create the data directory if it doesn't exist
mkdir -p ./data

# Copy the data file from the shared location
cp ../HotelsData_toCosmosDB_Vector_byRegion.json ./data/
```

The sample expects the data file at: `./data/HotelsData_toCosmosDB_Vector_byRegion.json`

## Understand what the sample does

The Java create-index sample demonstrates both control plane and data plane operations:

| Layer | Tool | Responsibility |
|---|---|---|
| Provisioning | Java ARM SDK | Assumes the database exists, then deletes and recreates containers with vector policies |
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
    cp .env.example .env
   ```

2. Update `.env` with your Azure resource values:

   ```dotenv
   AZURE_SUBSCRIPTION_ID="<your-subscription-id>"
   AZURE_RESOURCE_GROUP="<your-resource-group>"
   AZURE_COSMOSDB_ACCOUNT_NAME="<your-account-name>"
   AZURE_LOCATION="<your-account-location>"
   AZURE_COSMOSDB_ENDPOINT="https://<your-account>.documents.azure.com:443/"
   AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME="HotelsCreateIndex"
   AZURE_COSMOSDB_CONTAINER_NAME=""
   AZURE_OPENAI_EMBEDDING_ENDPOINT="https://<your-openai-resource>.openai.azure.com/"
   AZURE_OPENAI_EMBEDDING_DEPLOYMENT="text-embedding-3-small"
   AZURE_OPENAI_EMBEDDING_API_VERSION="2024-08-01-preview"
   VECTOR_ALGORITHM=""
   DATA_FILE_WITH_VECTORS_AND_REGIONS="./data/HotelsData_toCosmosDB_Vector_byRegion.json"
   AZURE_COSMOSDB_CREATE_INDEX_EMBEDDED_FIELD="embedding"
   ```

Leave `AZURE_COSMOSDB_CONTAINER_NAME` and `VECTOR_ALGORITHM` empty to run both containers. Set `VECTOR_ALGORITHM` to `diskann` or `quantizedflat` if you want to target one algorithm.

## Build and run the sample

Compile the sample:

```bash
mvn compile
```

Load environment variables from `.env` first. The sample reads only process environment variables through `System.getenv`; creating `.env` isn't enough.

```powershell
# PowerShell (strips quotes from values)
Get-Content .env | Where-Object { $_ -match '^[^#].*=' } | ForEach-Object { $k,$v = $_ -split '=',2; [Environment]::SetEnvironmentVariable($k.Trim(), $v.Trim().Trim('"').Trim("'")) }
```

```bash
# Bash/Linux/Mac
set -a; source .env; set +a
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
4. Uses the existing `HotelsCreateIndex` database
5. Deletes any existing `hotels_diskann` container, then creates it with DiskANN vector index on `/embedding`
6. Deletes any existing `hotels_quantizedflat` container, then creates it with QuantizedFlat vector index on `/embedding`

**Goal 2 - Data Plane (load and query with distance functions):**
1. Creates a Cosmos DB data plane client using `DefaultAzureCredential`
2. Reads `.../data/HotelsData_toCosmosDB_Vector_byRegion.json`
3. Bulk-upserts documents into both containers
4. Uses the Azure OpenAI client to generate a query embedding
5. Executes **three separate** parameterized `VectorDistance()` queries with different distance functions:
   - **Cosine:** Measures angle between vectors (values: 0 to 2)
   - **DotProduct:** Inner product of vectors (values: any real number)
   - **Euclidean:** Straight-line distance between vectors (values: 0 to √6144)
6. Scopes each vector query to one region by passing the partition key through `CosmosQueryRequestOptions.setPartitionKey`
7. Prints the top 5 matching hotels for each distance function, showing how rankings differ
8. Deletes both sample containers during cleanup

## Review the Java project structure

```text
nosql-create-index-java/
├── .env.example
├── output/
│   └── sample-output.txt
├── pom.xml
├── README.md
└── src/main/java/com/azure/cosmos/createindex/
    ├── App.java
    ├── Config.java
    ├── ControlPlane.java
    └── DataPlane.java
```

### ControlPlane.java

`ControlPlane.java` uses the ARM SDK (azure-resourcemanager-cosmos 2.49.0) to delete and recreate containers with vector indexes in an existing database. This demonstrates **Goal 1** (control plane).

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

### Goal 1: Create containers using ARM SDK (azure-resourcemanager-cosmos 2.49.0)

The control-plane phase uses the ARM SDK with `DefaultAzureCredential` to recreate containers with vector policies in an existing database:

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

// The database is assumed to already exist.

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
        .withOptions(new CreateUpdateOptions()));
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
List<Map<String, Object>> documents = readDocuments(config);
List<CosmosItemOperation> operations = new ArrayList<>(documents.size());
for (Map<String, Object> document : documents) {
    Object region = document.get("Region");
    operations.add(CosmosBulkOperations.getUpsertItemOperation(
        document,
        new PartitionKeyBuilder().add(String.valueOf(region)).build()));
}
container.executeBulkOperations(operations);

// Generate query embedding using Azure OpenAI
EmbeddingsOptions embeddingOptions = new EmbeddingsOptions(Arrays.asList(queryText));
List<Float> queryEmbedding = openaiClient.getEmbeddings(EMBEDDING_DEPLOYMENT, embeddingOptions)
    .getData()
    .get(0)
    .getEmbedding();

// Query with each distance function
String[] distanceFunctions = {"Cosine", "DotProduct", "Euclidean"};
for (String distanceFunc : distanceFunctions) {
    String query = String.format(
        "SELECT TOP @topK c.HotelId, c.HotelName, c.Description, " +
        "VectorDistance(c.embedding, @embedding, false, {'distanceFunction': '%s'}) AS SimilarityScore " +
        "FROM c " +
        "ORDER BY VectorDistance(c.embedding, @embedding, false, {'distanceFunction': '%s'})",
        distanceFunc,
        distanceFunc);

    SqlQuerySpec querySpec = new SqlQuerySpec(query)
        .withParameters(Arrays.asList(
            new SqlParameter("@topK", 5),
            new SqlParameter("@embedding", queryEmbedding)));

    CosmosQueryRequestOptions options = new CosmosQueryRequestOptions();
    options.setPartitionKey(new PartitionKeyBuilder().add("Northeast").build());

    for (var page : container.queryItems(querySpec, options, Map.class).iterableByPage()) {
        for (Object item : page.getResults()) {
            Map<String, Object> result = (Map<String, Object>) item;
            System.out.printf("  %s (score: %.4f)%n", result.get("HotelName"), result.get("SimilarityScore"));
        }
    }
}
```

Scope the vector query to a single partition by passing the partition key through the SDK's query options. Cosmos DB routes the request to the one physical partition that owns that region, so a `WHERE c.Region = ...` filter is unnecessary. This keeps the SQL focused on `ORDER BY VectorDistance(...)` for ranking and is the recommended, most efficient pattern for single-partition vector search.

## Expected output

The sample prints embedding validation, ingestion status, query results for each container, and cleanup status. A representative output file is included in `output/sample-output.txt`.

## Authentication and permissions

All Azure clients use `DefaultAzureCredential`. For local runs, sign in with `az login` or `azd auth login`. Hosted execution can use managed identity. The selected identity needs management-plane permission to create and delete the two configured containers, Cosmos DB data-plane access to insert and query documents, and the Cognitive Services OpenAI User role. Keys and connection strings aren't supported.

## Validate and clean generated artifacts

From the repository root, validate this sample with the shared validator:

```powershell
pwsh -NoProfile -File .github\skills\sample-validate-nosql-create-index\scripts\validate-create-index-samples.ps1 -Language Java
```

Preview and then remove generated local artifacts:

```powershell
pwsh -NoProfile -File .github\scripts\clean-all-create-index.ps1 -Language Java -WhatIf
pwsh -NoProfile -File .github\scripts\clean-all-create-index.ps1 -Language Java
```

## Next steps

- Learn more about [Azure Cosmos DB for NoSQL vector search](/azure/cosmos-db/nosql/vector-search).
- Review the full sample repo for other languages and scenarios.
- If you haven't provisioned the shared infrastructure yet, run `azd up` from the repo root before rerunning the Java sample.

> [!WARNING]
> The sample deletes `hotels_diskann` and `hotels_quantizedflat` before creation and during cleanup. Custom container names require `AZURE_COSMOSDB_CREATE_INDEX_ALLOW_DESTRUCTIVE_OPERATIONS=true`.
