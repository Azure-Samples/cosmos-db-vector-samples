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

# Quickstart: Create vector index in Azure Cosmos DB for NoSQL using TypeScript

In this quickstart, you run the TypeScript create-index sample for Azure Cosmos DB for NoSQL to demonstrate two key goals:

- **Goal 1 (Control Plane):** Use the ARM SDK to create two vector-indexed containers in the existing `HotelsCreateIndex` database: `hotels_diskann` (DiskANN) and `hotels_quantizedflat` (QuantizedFlat, which uses vector quantization techniques).
- **Goal 2 (Distance Functions):** Compare how the same query embedding produces different scores and rankings when using different vector distance functions: Cosine, DotProduct, and Euclidean.

## Prerequisites

- An Azure subscription. If you don't have one, create a [free account](https://azure.microsoft.com/free/).
- [Node.js LTS](https://nodejs.org/download/)
- [Azure CLI](/cli/azure/install-azure-cli) installed and signed in
- [Git](https://git-scm.com/downloads)
- To enable infrastructure provisioning for the create-index scenario, set `AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME=HotelsCreateIndex` before running `azd up`. The infrastructure creates the database selected by the deployment scenario. For the create-index scenario, it creates `HotelsCreateIndex`.

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
| Bicep deployment | `azd up` | Creates the resource group, Azure OpenAI resource, Azure Cosmos DB account, database, and role assignments. |
| Control plane | `src/control-plane.ts` | Uses `@azure/arm-cosmosdb` to delete any existing sample containers, then create both containers with vector indexes in an existing database. RBAC roles are created by deployment, not by this module. |
| Data plane | `src/data-plane.ts` | Uses `@azure/cosmos` and the `openai` package to verify dimensions, bulk insert documents, and run a `VectorDistance()` query. |

> [!NOTE]
> Unlike the other language samples in this repository (which are data-plane only), this TypeScript sample includes a **control-plane** step that creates both sample containers with vector indexes via the Azure Resource Manager SDK. The database must already exist. RBAC role definitions and assignments are handled by deployment, not by `src/control-plane.ts`.

The sample always creates, loads, queries, and cleans up both supported index types: `hotels_diskann` for `diskANN` and `hotels_quantizedflat` for `quantizedFlat`. `DiskANN` is graph-based, and `QuantizedFlat` uses vector quantization techniques. If you need to compare with `Flat`, use it only for test or very small scenarios. For production workloads, use `DiskANN` or `QuantizedFlat`.

## Create Azure resources

Create the Azure resources that the TypeScript sample uses.

From the repository root, configure and deploy the create-index scenario:

```powershell
azd env set AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME "HotelsCreateIndex"
azd up
```

From the sample directory, write the active `azd` values to `.env`:

```bash
npm run create-env
```

The `.env` file contains the sample configuration. The code reads these variables:

The `npm start` command uses Node.js `--env-file .env`, so `.env` is loaded
automatically. Process environment variables can override its values.

| Variable | Description |
|---|---|
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID for ARM SDK operations |
| `AZURE_RESOURCE_GROUP` | Resource group that contains the Cosmos DB account |
| `AZURE_LOCATION` | Azure region (default: `eastus2`) |
| `AZURE_COSMOSDB_ACCOUNT_NAME` | Cosmos DB account name |
| `AZURE_COSMOSDB_ENDPOINT` | Cosmos DB endpoint for data-plane operations |
| `AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME` | Existing database name (default: `HotelsCreateIndex`) |
| `AZURE_COSMOSDB_CONTAINER_NAME` | Optional container selection for ingestion and queries |
| `AZURE_COSMOSDB_CREATE_INDEX_DISKANN_CONTAINER_NAME` | DiskANN container name (default: `hotels_diskann`) |
| `AZURE_COSMOSDB_CREATE_INDEX_QUANTIZEDFLAT_CONTAINER_NAME` | QuantizedFlat container name (default: `hotels_quantizedflat`) |
| `AZURE_COSMOSDB_CREATE_INDEX_ALLOW_DESTRUCTIVE_OPERATIONS` | Set to `true` only to allow deletion of custom container names |
| `VECTOR_INDEX_TYPE` | Loaded for compatibility, but this sample creates both `diskANN` and `quantizedFlat` containers |
| `AZURE_OPENAI_EMBEDDING_ENDPOINT` | Azure OpenAI endpoint |
| `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | Azure OpenAI embedding deployment name |
| `AZURE_OPENAI_EMBEDDING_API_VERSION` | Embedding API version (default: `2024-08-01-preview`) |
| `AZURE_COSMOSDB_CREATE_INDEX_EMBEDDED_FIELD` | Document field for embeddings (default: `embedding`) |
| `EMBEDDING_DIMENSIONS` | Expected embedding dimensions (default: `1536`) |
| `DATA_FILE_WITH_VECTORS_AND_REGIONS` | Pre-vectorized region data file path |
| `PARTITION_KEY_VALUE` | Region partition key value for queries (default: `Northeast`) |

If `DATA_FILE_WITH_VECTORS_AND_REGIONS` is not set, the code uses `./data/HotelsData_toCosmosDB_Vector_byRegion.json`, resolved from the compiled `dist` folder as the sample directory's `data/` subdirectory.

## Install dependencies

Install the npm packages for the sample.

```bash
npm install
```

This command installs `@azure/arm-cosmosdb`, `@azure/cosmos`, `@azure/identity`, and `openai`.

> [!WARNING]
> The sample deletes `hotels_diskann` and `hotels_quantizedflat` before creation and during cleanup. Custom container names require `AZURE_COSMOSDB_CREATE_INDEX_ALLOW_DESTRUCTIVE_OPERATIONS=true`.

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
3. Uses the existing `HotelsCreateIndex` database
4. Deletes any existing `hotels_diskann` and `hotels_quantizedflat` sample containers
5. Creates the `hotels_diskann` container with DiskANN vector index on `/embedding`
6. Creates the `hotels_quantizedflat` container with QuantizedFlat vector index on `/embedding`

**Goal 2 - Data Plane (load and query with distance functions):**
1. Verifies embedding dimensions from Azure OpenAI match the container definition (1536 dimensions)
2. Loads pre-vectorized hotel documents from `./data/HotelsData_toCosmosDB_Vector_byRegion.json` by default
3. Bulk-inserts documents into both containers
4. Generates a query embedding with the Azure OpenAI client
5. Runs **three separate `VectorDistance()` queries** with different distance functions. Each query is scoped to one region by passing the partition key through the SDK's query options:
   - **Cosine:** Measures angle between vectors (values: 0 to 2)
   - **DotProduct:** Inner product of vectors (values: any real number)
   - **Euclidean:** Straight-line distance between vectors (values: 0 to √6144)
6. Displays a consolidated table with the top 1 and top 2 results for each distance function and container
7. Cleans up both sample containers

## Understand the output

When the sample runs, you see results from both goals:

1. **Create containers with vector indexes**: `src/control-plane.ts` deletes any existing sample containers, then creates both containers and sets `vectorIndexes` and `vectorEmbeddingPolicy`. The container definitions are immutable after creation.
2. **Verify embedding dimensions**: `src/data-plane.ts` uses the Azure OpenAI client to generate a test embedding and confirms that the returned dimension count matches `EMBEDDING_DIMENSIONS`.
3. **Insert documents**: `src/data-plane.ts` loads pre-vectorized hotel documents and inserts them with `executeBulkOperations()` into both containers.
4. **Run vector similarity queries**: `src/data-plane.ts` generates a query embedding and runs **three separate** SQL queries per container that order results by `VectorDistance()` using different distance functions. The sample scopes each query to a single partition by passing the region value through the SDK's query options.
5. **Display and clean up**: `src/index.ts` prints a consolidated table with the top 1 and top 2 results for each metric/container, then deletes both sample containers.

## Explore the code

The sample is organized into four main files.

- **`src/config.ts`** loads and validates environment variables, resolves the data file path, and exports the typed configuration object.
- **`src/index.ts`** creates a shared `DefaultAzureCredential` and calls the control-plane and data-plane functions in order.
- **`src/control-plane.ts`** creates the Azure Cosmos DB management client, deletes existing sample containers, creates both containers with vector indexes, and cleans them up at the end.
- **`src/data-plane.ts`** creates the Azure Cosmos DB client with the account endpoint and `DefaultAzureCredential`, creates the Azure OpenAI client, checks embedding dimensions, bulk inserts documents, and runs the vector query.

### Goal 1: Create containers using ARM SDK

The control-plane module creates an ARM client and builds containers with vector policies:

```typescript
export async function createContainer(
  armClient: CosmosDBManagementClient,
  config: SampleConfig
) {
  const indexTypes = [
    { type: "diskANN", containerName: "hotels_diskann" },
    { type: "quantizedFlat", containerName: "hotels_quantizedflat" },
  ];

  const embeddingPath = `/${config.embeddingField}`;

  for (const indexConfig of indexTypes) {
    await deleteContainerIfExists(armClient, config, indexConfig.containerName);

    await armClient.sqlResources.beginCreateUpdateSqlContainerAndWait(
      config.azure.resourceGroup!,
      config.cosmos.accountName!,
      config.cosmos.databaseName,
      indexConfig.containerName,
      {
        resource: {
          id: indexConfig.containerName,
          partitionKey: {
            paths: ["/Region"],
            kind: "MultiHash",
            version: 2,
          },
          indexingPolicy: {
            indexingMode: "consistent",
            automatic: true,
            includedPaths: [{ path: "/*" }],
            excludedPaths: [{ path: "/_etag/?" }],
            vectorIndexes: [
              {
                path: embeddingPath,
                type: indexConfig.type,
              },
            ],
          },
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
        },
        location: config.azure.location,
      }
    );
  }
}
```

### Goal 2: Run vector distance queries with all three distance functions

After bulk-inserting documents, the sample generates a query embedding and executes **three separate** SQL queries using different distance functions:

```typescript
// Generate embedding from query text
const response = await openaiClient.embeddings.create({
  model: config.openai.embeddingDeployment,
  input: [queryText],
});
const queryEmbedding = response.data[0].embedding;

// Query with each distance function
const distanceFunctions = [
  { name: "Cosine", orderDirection: "DESC" },
  { name: "DotProduct", orderDirection: "DESC" },
  { name: "Euclidean", orderDirection: "ASC" },
];

for (const distFunc of distanceFunctions) {
  const distanceFunction = distFunc.name;

  const querySpec = {
    query: `SELECT TOP 5 c.HotelId, c.HotelName, c.Description,
      VectorDistance(c.${config.embeddingField}, @embedding, false,
        {'distanceFunction': '${distanceFunction}'}) AS SimilarityScore
      FROM c
      ORDER BY VectorDistance(c.${config.embeddingField}, @embedding, false,
        {'distanceFunction': '${distanceFunction}'})`,
    parameters: [
      { name: "@embedding", value: queryEmbedding },
    ],
  };

  const { resources } = await container.items
    .query(querySpec, {
      partitionKey: config.partitionKeyValue,
    })
    .fetchAll();

  // src/index.ts adds the top 1 and top 2 rows to a consolidated table.
}
```

Scope the vector query to a single partition by passing the partition key through the SDK's query options. Azure Cosmos DB routes the request to the one physical partition that owns that region, so a `WHERE c.Region = ...` filter is unnecessary. This keeps the SQL focused on `ORDER BY VectorDistance(...)` for ranking and is the recommended, most efficient pattern for single-partition vector search.

The vector query validates the embedding field name before it injects that field into the SQL string. The query uses string interpolation for the field name because Azure Cosmos DB for NoSQL doesn't support parameter placeholders for field names in `VectorDistance()`.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `DefaultAzureCredential` authentication error | Not signed in to Azure CLI | Run `az login` before running the sample. |
| 403 Forbidden on container creation | Identity lacks control-plane access to the resource group | Re-run `azd up` or assign **Contributor** role on the resource group. |
| 403 on document insert/query | Missing data-plane RBAC | Verify deployment assigned data-plane access to your identity. RBAC can take up to 5 minutes to propagate. |
| Embedding dimensions mismatch | Deployment model doesn't match expected dimensions | Verify `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` points to a `text-embedding-3-small` deployment (1536 dimensions). |
| Container creation error | Identity lacks control-plane access, or the database doesn't exist | Verify the database name and control-plane permissions, then rerun the sample. |

## Clean up resources

Delete the resource group when you're done.

```azurecli
az group delete --name my-vector-rg --yes --no-wait
```

## Authentication and permissions

All Azure clients use `DefaultAzureCredential`. For local runs, sign in with `az login` or `azd auth login`. Hosted execution can use managed identity. The selected identity needs management-plane permission to create and delete the two configured containers, Cosmos DB data-plane access to insert and query documents, and the Cognitive Services OpenAI User role. Keys and connection strings aren't supported.

## Validate and clean generated artifacts

From the repository root, validate this sample with the shared validator:

```powershell
pwsh -NoProfile -File .github\skills\sample-validate-nosql-create-index\scripts\validate-create-index-samples.ps1 -Language TypeScript
```

Preview and then remove generated local artifacts:

```powershell
pwsh -NoProfile -File .github\scripts\clean-all-create-index.ps1 -Language TypeScript -WhatIf
pwsh -NoProfile -File .github\scripts\clean-all-create-index.ps1 -Language TypeScript
```

## Next steps

- Learn more about vector search in Azure Cosmos DB for NoSQL at [/azure/cosmos-db/gen-ai/vector-search](/azure/cosmos-db/gen-ai/vector-search).
- Review Azure Cosmos DB for NoSQL RBAC guidance at [/azure/cosmos-db/how-to-setup-rbac](/azure/cosmos-db/how-to-setup-rbac).
- Browse the Azure Cosmos DB JavaScript SDK overview at [/javascript/api/overview/azure/cosmos-readme](/javascript/api/overview/azure/cosmos-readme).
