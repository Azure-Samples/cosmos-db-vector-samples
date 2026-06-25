---
title: Quickstart: Create and query vector indexes in Azure Cosmos DB for NoSQL using TypeScript
description: Create vector indexes in Azure Cosmos DB for NoSQL using TypeScript and the ARM SDK. Load pre-vectorized hotel documents and compare vector distance functions (Cosine, DotProduct, Euclidean).
author: diberry
ms.author: diberry
ms.date: 2026-06-22
ms.service: azure-cosmos-db
ms.subservice: nosql
ms.topic: quickstart
ms.custom: msecd-doc-authoring-1013
#customer intent: As a JavaScript or TypeScript developer, I want to create and query vector indexes in Azure Cosmos DB for NoSQL so that I can validate an end-to-end vector search workflow with Microsoft Entra ID authentication.
---

# Quickstart: Create and query vector indexes in Azure Cosmos DB for NoSQL using TypeScript

In this quickstart, you run the TypeScript create-index sample for Azure Cosmos DB for NoSQL to demonstrate two key goals:

- **Goal 1 (Control Plane):** Use the ARM SDK to create the `HotelsCreateIndex` database and two vector-indexed containers: `hotels_diskann_ts` (approximate search) and `hotels_quantizedflat_ts` (exact search).
- **Goal 2 (Distance Functions):** Compare how the same query embedding produces different scores and rankings when using different vector distance functions: Cosine, DotProduct, and Euclidean.

## Prerequisites

- An Azure subscription. If you don't have one, create a [free account](https://azure.microsoft.com/free/).
- [Node.js 20 or later](https://nodejs.org/download/)
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) installed and signed in
- [Git](https://git-scm.com/downloads)

## Clone the repository

Clone the sample repository and change to the TypeScript sample directory.

```bash
git clone https://github.com/Azure-Samples/cosmos-db-vector-samples.git
cd cosmos-db-vector-samples/nosql-create-index-typescript
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

## Overview: What you'll build

This sample is split into three layers.

| Layer | File or tool | What it does |
|---|---|---|
| Azure CLI setup | `scripts/create-resources.sh` | Creates the resource group, Azure OpenAI resource, Azure Cosmos DB account, database, and `.env` file. |
| Control plane | `src/control-plane.ts` | Uses `@azure/arm-cosmosdb` to create the container with a vector index. RBAC roles are created by `azd up` (Bicep templates). |
| Data plane | `src/data-plane.ts` | Uses `@azure/cosmos` and the `openai` package to verify dimensions, bulk insert documents, and run a `VectorDistance()` query. |

> [!NOTE]
> Unlike the other language samples in this repository (which are data-plane only), this TypeScript sample includes a **control-plane** step that creates the container with its vector index via the Azure Resource Manager SDK. This approach demonstrates the full end-to-end lifecycle in a single sample.
>
> **RBAC roles:** Data-plane RBAC role definitions and assignments are created by `azd up` via Bicep templates. You can also create them programmatically using the management SDK — see [`SqlResources.BeginCreateUpdateSqlRoleDefinitionAsync`](https://learn.microsoft.com/dotnet/api/azure.resourcemanager.cosmosdb.sqlresources.begincreateupdate-sqlroledefinitionasync) (.NET) or [`SqlResources.beginCreateUpdateSqlRoleDefinition`](https://learn.microsoft.com/en-us/javascript/api/@azure/arm-cosmosdb/sqlresources?view=azure-node-latest#@azure-arm-cosmosdb-sqlresources-begincreateupdate-sqlroledefinition) (JavaScript/TypeScript).

The sample supports `diskANN` and `quantizedFlat`. `DiskANN` is graph-based, and `QuantizedFlat` uses vector quantization techniques. Use `hotels_diskann_ts` for `diskANN` and `hotels_quantizedflat_ts` for `quantizedFlat`. If you need to compare with `Flat`, use it only for test or very small scenarios. For production workloads, use `DiskANN` or `QuantizedFlat`.

## Create Azure resources

Create the Azure resources that the TypeScript sample uses.

**Option 1: Use the setup script**

```bash
chmod +x scripts/create-resources.sh
./scripts/create-resources.sh my-vector-rg eastus2
```

**Option 2: If you deployed with `azd up`**

```bash
azd env get-values > .env
```

The `.env` file contains the sample configuration. By default, it sets `VECTOR_INDEX_TYPE="diskANN"` and `AZURE_COSMOSDB_CONTAINER_NAME="hotels_diskann_ts"`. If you used the `create-resources.sh` script, the `.env` file is automatically created.

To use `quantizedFlat`, set these environment variables before you run the sample:

```bash
VECTOR_INDEX_TYPE="quantizedFlat"
AZURE_COSMOSDB_CONTAINER_NAME="hotels_quantizedflat_ts"
```

## Install dependencies

Install the npm packages for the sample.

```bash
npm install
```

This command installs `@azure/arm-cosmosdb`, `@azure/cosmos`, `@azure/identity`, and `openai`.

## Run the sample

Run the sample.

```bash
npm start
```

**What the sample does:**

The sample demonstrates both goals in sequence:

**Goal 1 - Control Plane (create containers with vector indexes):**
1. Compiles TypeScript source code
2. Authenticates with `DefaultAzureCredential`
3. Creates the `HotelsCreateIndex` database (if needed)
4. Creates the `hotels_diskann_ts` container with DiskANN vector index on `/embedding`
5. Creates the `hotels_quantizedflat_ts` container with QuantizedFlat vector index on `/embedding`
6. Creates RBAC role definitions and assigns data-plane access to your identity

**Goal 2 - Data Plane (load and query with distance functions):**
1. Verifies embedding dimensions from Azure OpenAI match the container definition (1536 dimensions)
2. Loads pre-vectorized hotel documents from `../data/HotelsData_toCosmosDB_Vector_byRegion.json`
3. Bulk-inserts documents into both containers
4. Generates a query embedding with the Azure OpenAI client
5. Runs **three separate `VectorDistance()` queries** with different distance functions. Each query is scoped to one region by passing the partition key through the SDK's query options:
   - **Cosine:** Measures angle between vectors (values: 0 to 2)
   - **DotProduct:** Inner product of vectors (values: any real number)
   - **Euclidean:** Straight-line distance between vectors (values: 0 to √6144)
6. Displays the top 5 matching hotels for each distance function, showing how rankings differ

## Understand the output

When the sample runs, you see results from both goals:

1. **Create container with vector index**: `src/control-plane.ts` creates the containers and sets `vectorIndexes` and `vectorEmbeddingPolicy`. The index type is `diskANN` or `quantizedFlat`, and the container definition is immutable after creation.
2. **Create data-plane RBAC access**: `src/control-plane.ts` creates a SQL role definition and assigns it to your current identity.
3. **Verify embedding dimensions**: `src/data-plane.ts` uses the Azure OpenAI client to generate a test embedding and confirms that the returned dimension count matches `EMBEDDING_DIMENSIONS`.
4. **Insert documents**: `src/data-plane.ts` loads pre-vectorized hotel documents and inserts them with `executeBulkOperations()` into both containers.
5. **Run vector similarity queries**: `src/data-plane.ts` generates a query embedding and runs **three separate** SQL queries that order results by `VectorDistance()` using different distance functions. The sample scopes each query to a single partition by passing the region value through the SDK's query options.

## Explore the code

The sample is organized into four main files.

- **`src/config.ts`** loads and validates environment variables, resolves the data file path, and exports the typed configuration object.
- **`src/index.ts`** creates a shared `DefaultAzureCredential` and calls the control-plane and data-plane functions in order.
- **`src/control-plane.ts`** creates the Azure Cosmos DB management client, creates the container with a vector index, and creates the SQL role definition and assignment for data-plane access.
- **`src/data-plane.ts`** creates the Azure Cosmos DB client with the account endpoint and `DefaultAzureCredential`, creates the Azure OpenAI client, checks embedding dimensions, bulk inserts documents, and runs the vector query.

### Goal 1: Create containers using ARM SDK

The control-plane module creates an ARM client and builds containers with vector policies:

```typescript
export async function createContainer(
  armClient: CosmosDBManagementClient,
  config: SampleConfig
) {
  const indexTypes = [
    { type: "diskANN", containerName: "hotels_diskann_ts" },
    { type: "quantizedFlat", containerName: "hotels_quantizedflat_ts" },
  ];

  const embeddingPath = `/${config.embeddingField}`;

  for (const indexConfig of indexTypes) {
    console.log(`\n=== Creating ${indexConfig.containerName} with ${indexConfig.type} ===`);

    await armClient.sqlResources.beginCreateUpdateSqlContainerAndWait(
      config.azure.resourceGroup!,
      config.cosmos.accountName!,
      config.cosmos.databaseName,
      indexConfig.containerName,
      {
        location: config.azure.location,
        resource: {
          id: indexConfig.containerName,
          partitionKey: { paths: ["/Region"], kind: "Hash" },
          vectorEmbeddingPolicy: {
            vectorEmbeddings: [
              {
                path: embeddingPath,
                dataType: "float32",
                dimensions: config.expectedDimensions,
                distanceFunction: "cosine",
              },
            ],
          },
          indexingPolicy: {
            indexingMode: "Consistent",
            automatic: true,
            includedPaths: [{ path: "/*" }],
            excludedPaths: [{ path: `/"_etag"/?` }],
            vectorIndexes: [{ path: embeddingPath, type: indexConfig.type }],
          },
        },
        options: { throughput: 400 },
      }
    );

    console.log(`  ✓ Container created with vector index`);
  }
}
```

### Goal 2: Run vector distance queries with all three distance functions

After bulk-inserting documents, the sample generates a query embedding and executes **three separate** SQL queries using different distance functions:

```typescript
// Generate embedding from query text
const embeddingResponse = await openaiClient.getEmbeddings(
  config.cosmos.embeddingDeployment,
  [queryText]
);
const queryEmbedding = embeddingResponse.data[0].embedding;

// Query with each distance function
const distanceFunctions = ["Cosine", "DotProduct", "Euclidean"];

for (const distanceFunc of distanceFunctions) {
  console.log(`\n=== Query Results using ${distanceFunc} ===`);

  const querySpec = {
    query: `SELECT TOP 5 c.HotelId, c.HotelName, c.Description,
      VectorDistance(c.${config.embeddingField}, @embedding, false,
        {'distanceFunction': '${distanceFunc}'}) AS similarityScore
      FROM c
      ORDER BY VectorDistance(c.${config.embeddingField}, @embedding, false,
        {'distanceFunction': '${distanceFunc}'})`,
    parameters: [
      { name: "@embedding", value: queryEmbedding },
    ],
  };

  const { resources } = await container.items
    .query(querySpec, {
      partitionKey: "Northeast",
    })
    .fetchAll();

  resources.forEach((doc, i) => {
    console.log(
      `${i + 1}. ${doc.HotelName} (score: ${doc.similarityScore.toFixed(4)})`
    );
  });
}
```

Scope the vector query to a single partition by passing the partition key through the SDK's query options. Azure Cosmos DB routes the request to the one physical partition that owns that region, so a `WHERE c.Region = ...` filter is unnecessary. This keeps the SQL focused on `ORDER BY VectorDistance(...)` for ranking and is the recommended, most efficient pattern for single-partition vector search.

The vector query validates the embedding field name before it injects that field into the SQL string. The query uses string interpolation for the field name because Azure Cosmos DB for NoSQL doesn't support parameter placeholders for field names in `VectorDistance()`.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `DefaultAzureCredential` authentication error | Not signed in to Azure CLI | Run `az login` before running the sample. |
| 403 Forbidden on container creation | Identity lacks control-plane access to the resource group | Re-run `azd up` or assign **Contributor** role on the resource group. |
| 403 on document insert/query | Missing data-plane RBAC | The control-plane step creates a SQL role assignment. Verify it completed successfully. RBAC can take up to 5 minutes to propagate. |
| Embedding dimensions mismatch | Deployment model doesn't match expected dimensions | Verify `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` points to a `text-embedding-3-small` deployment (1536 dimensions). |
| Container already exists error | Re-running after a previous successful run | Delete the container in the Azure portal or change the container name in `.env`. |

## Clean up resources

Delete the resource group when you're done.

```azurecli
az group delete --name my-vector-rg --yes --no-wait
```

## Next steps

- Learn more about vector search in Azure Cosmos DB for NoSQL at [/azure/cosmos-db/gen-ai/vector-search](/azure/cosmos-db/gen-ai/vector-search).
- Review Azure Cosmos DB for NoSQL RBAC guidance at [/azure/cosmos-db/how-to-setup-rbac](/azure/cosmos-db/how-to-setup-rbac).
- Browse the Azure Cosmos DB JavaScript SDK overview at [/javascript/api/overview/azure/cosmos-readme](/javascript/api/overview/azure/cosmos-readme).
