# Quickstart: Create Azure Cosmos DB vector indexes with the ARM SDK and TypeScript

Create an Azure Cosmos DB for NoSQL container with a **vector index** using the Azure Resource Manager SDK (`@azure/arm-cosmosdb`). Then validate the configuration by generating embeddings with Azure OpenAI, inserting documents, and running a `VectorDistance()` similarity query.

This quickstart uses three layers:

| Layer | Tool | What it does |
|---|---|---|
| **Azure CLI script** | `scripts/create-resources.sh` | Creates the resource group, Azure OpenAI resource, Cosmos DB account, and database |
| **Control plane** | `src/control-plane.ts` (`@azure/arm-cosmosdb`) | Creates the container with vector index and RBAC |
| **Data plane** | `src/data-plane.ts` (`@azure/cosmos` + `openai`) | Inserts documents and runs vector queries |

All authentication uses Microsoft Entra ID via `DefaultAzureCredential` — no API keys or connection strings.


> [!IMPORTANT]
> **Vector indexing policy must be configured at container creation time and cannot be modified after.** The infrastructure provisioned by `azd up` handles this automatically.
## Prerequisites

To complete this quickstart, you need:

- An Azure account with an active subscription — [create one for free](https://azure.microsoft.com/free/)
- [Node.js LTS](https://nodejs.org/)
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) installed and logged in (`az login`)
- [Git](https://git-scm.com/downloads)

## Clone the repository

Get the sample code from GitHub and move into the correct directory:

```bash
git clone https://github.com/Azure-Samples/cosmos-db-vector-samples.git
cd cosmos-db-vector-samples/nosql-create-index-typescript
```

## Overview: What you'll build

The setup script and TypeScript code split responsibilities across three layers:

```
scripts/create-resources.sh (Azure CLI)
────────────────────────────────
1. Resource group
2. Contributor role (control plane)
3. Azure OpenAI account
4. Embedding model deployment
5. OpenAI User role (data plane)
6. Cosmos DB account
7. Cosmos DB database
8. Data Contributor role (full mode)
9. Write .env
```

```
src/index.ts (orchestrator)        src/control-plane.ts          src/data-plane.ts
───────────────────────────        ──────────────────────        ─────────────────
Loads config from .env             1. Container + vector index   3. Verify embedding dimensions
Validates required env vars        2. RBAC role + assignment     4. Insert documents (bulk)
Creates credential                                               5. Vector similarity query
Calls control-plane, then
  data-plane functions
```

## Run the Azure CLI setup script

The setup script creates the Azure resource group, Azure OpenAI resource, Cosmos DB account, and database, then writes a `.env` file with all configuration values needed by `src/index.ts`.


```bash
chmod +x scripts/create-resources.sh

./scripts/create-resources.sh my-vector-rg eastus2
```

### What the setup script does

The following table summarizes the operations the script performs. Steps 1–7 run in both modes. Step 8 runs only in `full` mode.

| Step | Operation | Plane | Mode | CLI command |
|---|---|---|---|---|
| 1 | Create resource group | — | Both | `az group create` |
| 2 | Assign Contributor role to your identity | Control | Both | `az role assignment create --role "Contributor"` |
| 3 | Create Azure OpenAI account | Control | Both | `az cognitiveservices account create` |
| 4 | Deploy embedding model | Control | Both | `az cognitiveservices account deployment create` |
| 5 | Assign Cognitive Services OpenAI User role | Data | Both | `az role assignment create --role "Cognitive Services OpenAI User"` |
| 6 | Create Cosmos DB account | Control | Both | `az cosmosdb create` |
| 7 | Create Cosmos DB database | Control | Both | `az cosmosdb sql database create` |
| 8 | Assign Cosmos DB Built-in Data Contributor role | Data | Full only | `az cosmosdb sql role assignment create` |

The **Contributor** role (step 2) gives your signed-in identity control-plane access to create resources within the resource group — including the container that `src/index.ts` creates via the ARM SDK.

The **Cosmos DB Built-in Data Contributor** role (step 8 in `full` mode) grants data-plane access to read and write documents in the Cosmos DB account. In `control` mode, data-plane roles are expected to be assigned separately (for example, by `azd` or a Bicep deployment).

After completion, the script writes a `.env` file with all values the TypeScript code needs.

## Install dependencies

Install the required npm packages:

```bash
npm install
```

This installs:

| Package | Purpose |
|---|---|
| `@azure/arm-cosmosdb` | ARM SDK — control plane operations (create container, RBAC) |
| `@azure/cosmos` | Data plane SDK — read/write documents and run queries |
| `@azure/identity` | `DefaultAzureCredential` for Microsoft Entra ID authentication |
| `openai` | Azure OpenAI client for generating embeddings |

## Run the sample

Run the TypeScript code to create the container with a vector index, assign RBAC, insert documents, and run a vector query:

```bash
npm start
```

The script runs five steps. Steps 1–2 use the ARM SDK (control plane) to create the container and RBAC. Steps 3–5 use the data plane SDK to validate the configuration.

## Walk through the code

The TypeScript code is split into three files:

| File | Purpose |
|---|---|
| `src/index.ts` | Orchestrator — loads config from `.env`, creates shared credential, calls control-plane then data-plane functions |
| `src/control-plane.ts` | ARM SDK operations (`@azure/arm-cosmosdb`) — creates container with vector index and RBAC roles |
| `src/data-plane.ts` | Data plane operations (`@azure/cosmos` + `openai`) — inserts documents and runs vector queries |

### Authentication

The orchestrator (`src/index.ts`) creates a single `DefaultAzureCredential` and passes it to factory functions in each module — no API keys needed:

```typescript
// src/index.ts — orchestrator
import { DefaultAzureCredential } from "@azure/identity";
import { createArmClient, createContainer, createRbacAccess } from "./control-plane.js";
import { createCosmosClient, createOpenAIClient } from "./data-plane.js";

const credential = new DefaultAzureCredential();

// Control plane — ARM SDK
const armClient = createArmClient(credential, config.azure.subscriptionId);

// Data plane — Cosmos SDK + Azure OpenAI
const cosmosClient = createCosmosClient(credential, config.cosmos.endpoint);
const openaiClient = createOpenAIClient(credential, config);
```

Each module creates its client internally:

```typescript
// src/control-plane.ts
export function createArmClient(credential: TokenCredential, subscriptionId: string) {
  return new CosmosDBManagementClient(credential, subscriptionId);
}
```

```typescript
// src/data-plane.ts
export function createCosmosClient(credential: TokenCredential, endpoint: string) {
  return new CosmosClient({ endpoint, aadCredentials: credential });
}

export function createOpenAIClient(credential: TokenCredential, config) {
  const tokenProvider = getBearerTokenProvider(
    credential,
    "https://cognitiveservices.azure.com/.default"
  );
  return new AzureOpenAI({
    azureADTokenProvider: tokenProvider,
    endpoint: config.openai.endpoint,
    apiVersion: config.openai.embeddingApiVersion,
  });
}
```

### Step 1: Create the container with a vector index (control-plane.ts)

This is the critical step. The container's `vectorEmbeddingPolicy` and `vectorIndexes` are **immutable after creation** — they cannot be changed afterward, regardless of whether the container was created via ARM SDK, Bicep, Portal, or CLI.

### [DiskANN](#tab/tab-diskann)

Set the following in your `.env` file:

```dotenv
VECTOR_INDEX_TYPE="diskANN"
AZURE_COSMOSDB_CONTAINER_NAME="hotels_diskann"
```

```typescript
async function createContainer() {
  const embeddingPath = "/DescriptionVector";

  await armClient.sqlResources.beginCreateUpdateSqlContainerAndWait(
    resourceGroup,
    accountName,
    "Hotels",
    "hotels_diskann",
    {
      resource: {
        id: "hotels_diskann",
        partitionKey: {
          paths: ["/HotelId"],
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
              type: "diskANN",
            },
          ],
        },
        vectorEmbeddingPolicy: {
          vectorEmbeddings: [
            {
              path: embeddingPath,
              dataType: "float32",
              dimensions: 1536,
              distanceFunction: "cosine",
            },
          ],
        },
      },
      location: "eastus2",
    }
  );
}
```

Configuration decisions:

| Setting | Value | Why |
|---|---|---|
| `type` | `diskANN` | Graph-based index, optimized for low latency and efficient RU consumption at scale |
| `dimensions` | `1536` | Must match the output of `text-embedding-3-small` |
| `distanceFunction` | `cosine` | Standard for text similarity |
| `dataType` | `float32` | Full-precision embeddings |
| `path` | `/DescriptionVector` | Field in each document that stores the embedding vector |

### [Quantized flat](#tab/tab-quantizedflat)

Set the following in your `.env` file:

```dotenv
VECTOR_INDEX_TYPE="quantizedFlat"
AZURE_COSMOSDB_CONTAINER_NAME="hotels_quantizedflat"
```

```typescript
async function createContainer() {
  const embeddingPath = "/DescriptionVector";

  await armClient.sqlResources.beginCreateUpdateSqlContainerAndWait(
    resourceGroup,
    accountName,
    "Hotels",
    "hotels_quantizedflat",
    {
      resource: {
        id: "hotels_quantizedflat",
        partitionKey: {
          paths: ["/HotelId"],
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
              type: "quantizedFlat",
            },
          ],
        },
        vectorEmbeddingPolicy: {
          vectorEmbeddings: [
            {
              path: embeddingPath,
              dataType: "float32",
              dimensions: 1536,
              distanceFunction: "cosine",
            },
          ],
        },
      },
      location: "eastus2",
    }
  );
}
```

Configuration decisions:

| Setting | Value | Why |
|---|---|---|
| `type` | `quantizedFlat` | Vector quantization, good balance of recall and performance at moderate scale |
| `dimensions` | `1536` | Must match the output of `text-embedding-3-small` |
| `distanceFunction` | `cosine` | Standard for text similarity |
| `dataType` | `float32` | Full-precision embeddings |
| `path` | `/DescriptionVector` | Field in each document that stores the embedding vector |

---

> **Important:** Vector indexes are immutable. If you need to change the index type, dimensions, or distance function, you must create a new container and migrate data. See [What if you need to change your index?](#what-if-you-need-to-change-your-index)

### Step 2: Create data-plane RBAC (control-plane.ts)

The ARM SDK also creates the Cosmos DB SQL role definition and assignment. This grants your identity data-plane access to read/write documents — separate from the control-plane Contributor role.

**Role definition:**

```typescript
const ROLE_DEFINITION_GUID = "e4e1a8b7-0a7e-4c6c-8f1d-000000000001";

await armClient.sqlResources.beginCreateUpdateSqlRoleDefinitionAndWait(
  ROLE_DEFINITION_GUID,
  resourceGroup,
  accountName,
  {
    roleName: "Write to Azure Cosmos DB for NoSQL data plane",
    type: "CustomRole",
    assignableScopes: [accountResourceId],
    permissions: [
      {
        dataActions: [
          "Microsoft.DocumentDB/databaseAccounts/readMetadata",
          "Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/items/*",
          "Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/*",
        ],
      },
    ],
  }
);
```

**Role assignment:**

```typescript
const ROLE_ASSIGNMENT_GUID = "e4e1a8b7-0a7e-4c6c-8f1d-000000000002";

await armClient.sqlResources.beginCreateUpdateSqlRoleAssignmentAndWait(
  ROLE_ASSIGNMENT_GUID,
  resourceGroup,
  accountName,
  {
    roleDefinitionId: `${accountResourceId}/sqlRoleDefinitions/${ROLE_DEFINITION_GUID}`,
    scope: accountResourceId,
    principalId: userPrincipalId,
  }
);
```

The deterministic GUIDs make this operation idempotent — running the script again updates rather than duplicates the role definition and assignment.

These data-plane permissions allow:

| Action | Allowed |
|---|---|
| Read/write documents | Yes |
| Read container metadata | Yes |
| Create or delete databases/containers | No |
| Modify indexing policies | No |

> **Note:** After creating the RBAC assignment, the code waits 15 seconds for propagation before attempting data-plane operations.

### Step 3: Verify embedding dimensions (data-plane.ts)

Before inserting data, confirm the embedding model produces vectors that match the container's configured `dimensions: 1536`:

```typescript
async function verifyEmbeddingDimensions(openaiClient, config) {
  const embedding = await generateEmbedding(
    openaiClient,
    config.openai.embeddingDeployment,
    "dimension check"
  );
  const actual = embedding.length;

  if (actual !== config.expectedDimensions) {
    throw new Error(
      `Dimension mismatch: model produces ${actual} but container expects ${config.expectedDimensions}`
    );
  }
}
```

A mismatch here means the container was created with the wrong `dimensions` value. Since this is immutable, you must recreate the container with the correct value.

### Step 4: Insert documents from data file (data-plane.ts)

The sample loads pre-vectorized hotel data from `data/HotelsData_toCosmosDB_Vector.json` and inserts all documents using the Cosmos DB bulk execution API:

```typescript
async function insertDocuments(container, config) {
  // Load pre-vectorized hotel data from JSON file
  const filePath = resolve(__dirname, "..", config.dataFile);
  const fileContent = await readFile(filePath, "utf-8");
  const data = JSON.parse(fileContent);

  // Skip if container already has documents
  const { resources: countResult } = await container.items
    .query("SELECT VALUE COUNT(1) FROM c")
    .fetchAll();
  if (countResult[0] > 0) return;

  // Build bulk operations — SDK handles batching and throttling
  const operations = data.map((item) => ({
    operationType: BulkOperationType.Create,
    resourceBody: { id: item.HotelId, ...item },
    partitionKey: [item.HotelId],
  }));

  const response = await container.items.executeBulkOperations(operations);
}
```

Key points about this approach:

- **Pre-vectorized data** — the JSON file already contains `DescriptionVector` embeddings, so no Azure OpenAI calls are needed during insert.
- **Bulk execution** — `executeBulkOperations()` handles batching, parallelization across partitions, and automatic retry/throttling internally.
- **Idempotent** — if the container already has documents, the insert is skipped.
- **409 conflicts** — individual document conflicts (already exists) are treated as success.

### Step 5: Run a vector similarity query (data-plane.ts)

Use `VectorDistance()` to find documents similar to a natural language query:

```typescript
async function vectorQuery(container, openaiClient, config) {
  const queryText = "hotel near the ocean";
  const queryEmbedding = await generateEmbedding(
    openaiClient,
    config.openai.embeddingDeployment,
    queryText
  );

  const embeddingField = config.embeddingField;

  // Validate field name — Cosmos DB SQL does not support parameter
  // placeholders for field names, so the field is string-interpolated.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(embeddingField)) {
    throw new Error(`Invalid embedding field name: ${embeddingField}`);
  }

  const { resources, requestCharge } = await container.items
    .query({
      query: `SELECT TOP 3 c.id, c.Description,
                VectorDistance(c.${embeddingField}, @embedding) AS similarity
              FROM c
              ORDER BY VectorDistance(c.${embeddingField}, @embedding)`,
      parameters: [{ name: "@embedding", value: queryEmbedding }],
    })
    .fetchAll();

  resources.forEach((r, i) => {
    console.log(`${i + 1}. ${r.Description} (similarity: ${r.similarity.toFixed(4)})`);
  });
}
```

> **Note:** The embedding field name (`DescriptionVector`) is injected via string interpolation because Cosmos DB SQL query syntax does not support parameter placeholders for field names. The `@embedding` value is safely parameterized. Always validate field names against a strict pattern when the value comes from configuration.

## Expected output

When you run `npm start`, the console output resembles the following:

> **Tip:** The non-zero similarity scores in Step 5 confirm the vector search pipeline is working end-to-end — the vector index was created with the correct dimensions, embeddings are stored in the documents, and `VectorDistance()` is computing actual cosine distances. If the vector configuration were incorrect, the query would either fail with an error or return `null` similarity scores.

### [DiskANN](#tab/tab-diskann)

```
======================================================================
Azure Cosmos DB — Create Container with Vector Index via ARM SDK
======================================================================

=== Step 1: Create Container with Vector Index ===
  Container:         hotels_diskann
  Dimensions:        1536
  Distance function: cosine
  Created in 4.7s
  Vector index is IMMUTABLE — cannot be changed after creation

=== Step 2: Create Data-Plane RBAC Access ===
  Creating role definition...
  Role definition created
  Assigning role to current user...
  Role assigned to principal: 00000000-0000-0000-0000-000000000000

  Waiting 15 s for RBAC propagation...

=== Step 3: Verify Embedding Dimensions ===
  Model:    text-embedding-3-small
  Actual:   1536
  Expected: 1536
  Dimensions match

=== Step 4: Insert Documents ===
  Data file: /path/to/data/HotelsData_toCosmosDB_Vector.json
  Loaded 50 documents (embeddings already included)
  Inserting 50 items using executeBulkOperations...
  Bulk insert completed in 3.21s
  Inserted: 50/50 | Failed: 0 | RU: 542.30

=== Step 5: Vector Similarity Query ===
  Query:   "hotel near the ocean"
  Latency: 42ms | RU: 3.12 | Results: 3
    1. Luxury hotel with ocean views and a private beach (similarity: 0.8234)
    2. Budget-friendly downtown location near public transit (similarity: 0.6012)
    3. Mountain resort with ski-in/ski-out access (similarity: 0.5891)

======================================================================
Complete — container, vector index, and RBAC created
======================================================================
```

### [Quantized flat](#tab/tab-quantizedflat)

```
======================================================================
Azure Cosmos DB — Create Container with Vector Index via ARM SDK
======================================================================

=== Step 1: Create Container with Vector Index ===
  Container:         hotels_quantizedflat
  Dimensions:        1536
  Distance function: cosine
  Created in 4.7s
  Vector index is IMMUTABLE — cannot be changed after creation

=== Step 2: Create Data-Plane RBAC Access ===
  Creating role definition...
  Role definition created
  Assigning role to current user...
  Role assigned to principal: 00000000-0000-0000-0000-000000000000

  Waiting 15 s for RBAC propagation...

=== Step 3: Verify Embedding Dimensions ===
  Model:    text-embedding-3-small
  Actual:   1536
  Expected: 1536
  Dimensions match

=== Step 4: Insert Documents ===
  Data file: /path/to/data/HotelsData_toCosmosDB_Vector.json
  Loaded 50 documents (embeddings already included)
  Inserting 50 items using executeBulkOperations...
  Bulk insert completed in 3.21s
  Inserted: 50/50 | Failed: 0 | RU: 542.30

=== Step 5: Vector Similarity Query ===
  Query:   "hotel near the ocean"
  Latency: 42ms | RU: 3.12 | Results: 3
    1. Luxury hotel with ocean views and a private beach (similarity: 0.8234)
    2. Budget-friendly downtown location near public transit (similarity: 0.6012)
    3. Mountain resort with ski-in/ski-out access (similarity: 0.5891)

======================================================================
Complete — container, vector index, and RBAC created
======================================================================
```

---

## Verify the vector index is working

After running `npm start`, use these checks to confirm the vector index was created correctly, the query used it, and the results are genuinely from vector search.

### 1. Confirm the vector index exists on the container

Use Azure CLI to inspect the container's indexing policy and vector embedding policy:

```bash
az cosmosdb sql container show \
  --account-name $AZURE_COSMOSDB_ACCOUNT_NAME \
  --resource-group $AZURE_RESOURCE_GROUP \
  --database-name Hotels \
  --name hotels_diskann \
  --query "{vectorIndexes: resource.indexingPolicy.vectorIndexes, vectorEmbeddingPolicy: resource.vectorEmbeddingPolicy}" \
  --output json
```

The output should show the `vectorIndexes` array with your path and index type, and a `vectorEmbeddingPolicy` with matching dimensions, data type, and distance function. If either is `null` or empty, the container was not created with vector support.

You can also verify in the Azure Portal: navigate to your Cosmos DB account → **Data Explorer** → select your database and container → **Settings** → **Indexing Policy** to see the `vectorIndexes` and `vectorEmbeddingPolicy` configuration.

### 2. Confirm the query used the vector index

Two signals confirm the vector index was actually used:

- **The query succeeded** — `ORDER BY VectorDistance()` requires a vector index. Without one, Cosmos DB returns an error like `"The order by item requires a corresponding vector index."` If you see results, the index was used.
- **Low RU charge** — a vector index query against 50 documents typically costs 2–5 RU. A brute-force scan (flat index) on the same data would cost significantly more. The `RU` value in Step 5 output reflects this.

### 3. Confirm results are from vector search, not a regular query

Vector search results have characteristics that a regular SQL query cannot produce:

| Signal | Vector search (Step 5 output) | Regular SQL query |
|---|---|---|
| **Similarity scores** | Non-zero, varying values (e.g., 0.8234, 0.6012, 0.5891) | No similarity score column |
| **Result ordering** | Ranked by semantic relevance to the query text | Arbitrary or alphabetical order |
| **Top result** | Semantically related to "hotel near the ocean" (ocean views, beach) | Unrelated to the query text |

To see the difference, run a regular query without `VectorDistance()`:

```sql
SELECT TOP 3 c.id, c.Description FROM c
```

The regular query returns documents in arbitrary order with no relevance to "hotel near the ocean." The vector query returns documents ranked by meaning — the top result describes ocean views and a beach, even though the query text doesn't appear verbatim in the document.

> **Important:** If all similarity scores are `0` or `null`, the documents likely don't have the embedding field (`DescriptionVector`) populated. If the scores are all identical, the embeddings may be constant or corrupted. Both indicate a problem with the data, not the index.

## Index type comparison

This sample uses **diskANN** or **quantizedFlat**. Here's how the available index types compare:

| Index Type | Best For | Technique | Recall |
|---|---|---|---|
| **DiskANN** | Production, > 10K vectors | Graph-based search | High (tunable) |
| **QuantizedFlat** | General use, moderate scale | Vector quantization | High |

> **Important:** QuantizedFlat uses vector quantization techniques. DiskANN is graph-based. These are distinct approaches.

To use a different index type, change `VECTOR_INDEX_TYPE` and `AZURE_COSMOSDB_CONTAINER_NAME` in your `.env` file (see [Step 1](#step-1-create-the-container-with-a-vector-index-control-planets) tabs), then run `npm start` again. You must use a new container name since the index type on an existing container is immutable.

## What if you need to change your index?

Vector indexes are **immutable after container creation**. If you need to change the index type, dimensions, or distance function:

1. **Update `.env`** — set `VECTOR_INDEX_TYPE` to the desired algorithm and `AZURE_COSMOSDB_CONTAINER_NAME` to a new container name
2. **Run `npm start`** — creates the new container (the account and database already exist and are idempotent)
3. **Migrate data** — copy documents from the old container to the new container
4. **Update your application** — point to the new container name
5. **Delete the old container** — clean up via Azure Portal or Azure CLI

> **Tip:** It's much cheaper to recreate an empty test container than to migrate production data. Test with representative data volumes before committing to an index type.

## Control plane vs. data plane

This quickstart uses both planes:

| Operation | Plane | Tool | Role required |
|---|---|---|---|
| Create account | Control | `scripts/create-resources.sh` (Azure CLI) | Contributor (on resource group) |
| Create database | Control | `scripts/create-resources.sh` (Azure CLI) | Contributor |
| Create container + vector index | Control | `src/control-plane.ts` (`@azure/arm-cosmosdb`) | Contributor |
| Create RBAC role definition | Control | `src/control-plane.ts` (`@azure/arm-cosmosdb`) | Contributor |
| Create RBAC role assignment | Control | `src/control-plane.ts` (`@azure/arm-cosmosdb`) | Contributor |
| Read/write documents | Data | `src/data-plane.ts` (`@azure/cosmos`) | Custom data-plane role |
| Run vector queries | Data | `src/data-plane.ts` (`@azure/cosmos`) | Custom data-plane role |

The **Contributor** role (assigned by `scripts/create-resources.sh`) grants control-plane access to create and manage resources. The **custom SQL role** (created by `src/control-plane.ts` step 2) grants data-plane access to read and write documents.

## Environment variables

All values are written to `.env` by `scripts/create-resources.sh`:

| Variable | Description |
|---|---|
| `AZURE_TOKEN_CREDENTIALS` | Tells `DefaultAzureCredential` to use the Azure CLI token directly instead of searching the full credential chain |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID |
| `AZURE_RESOURCE_GROUP` | Resource group name |
| `AZURE_LOCATION` | Azure region (default: `eastus2`) |
| `AZURE_USER_PRINCIPAL_ID` | Your Microsoft Entra ID object ID |
| `AZURE_COSMOSDB_ACCOUNT_NAME` | Cosmos DB account name |
| `AZURE_COSMOSDB_ENDPOINT` | Cosmos DB document endpoint URL |
| `AZURE_COSMOSDB_DATABASENAME` | Database name (default: `Hotels`) |
| `VECTOR_INDEX_TYPE` | Vector index algorithm: `diskANN` or `quantizedFlat` (default: `diskANN`) |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI endpoint URL |
| `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | Embedding model deployment name |
| `AZURE_OPENAI_EMBEDDING_API_VERSION` | Embedding API version |
| `EMBEDDED_FIELD` | Document field for embedding vectors |
| `EMBEDDING_DIMENSIONS` | Expected embedding dimensions |
| `DATA_FILE_WITH_VECTORS` | Path to pre-vectorized data file (default: `../data/HotelsData_toCosmosDB_Vector.json`) |

The container name depends on the index type:

### [DiskANN](#tab/tab-diskann)

| Variable | Value |
|---|---|
| `AZURE_COSMOSDB_CONTAINER_NAME` | `hotels_diskann` |

### [Quantized flat](#tab/tab-quantizedflat)

| Variable | Value |
|---|---|
| `AZURE_COSMOSDB_CONTAINER_NAME` | `hotels_quantizedflat` |

---

## Key takeaways

The following table summarizes the core concepts demonstrated in this quickstart:

| Concept | Detail |
|---|---|
| Vector indexes are immutable | Defined at container creation via the ARM SDK `vectorEmbeddingPolicy` and `vectorIndexes`, cannot be changed afterward |
| ARM SDK for container creation | `src/control-plane.ts` uses `@azure/arm-cosmosdb` to create the container with vector index and RBAC |
| Data plane for documents | `src/data-plane.ts` uses `@azure/cosmos` to read/write documents and run `VectorDistance()` queries |
| Entra ID everywhere | `DefaultAzureCredential` authenticates to all three services — no keys or connection strings |
| Dimension match is critical | Embedding model output must equal the container's `vectorEmbeddingPolicy.dimensions` |
| DiskANN for production | Graph-based, optimized for low latency and efficient RU consumption at scale |
| QuantizedFlat for general use | Vector quantization, good balance of recall and performance |

## Clean up resources

To avoid unnecessary costs, delete the resource group and purge the Azure OpenAI resource when you're done. The cleanup script reads resource names from your `.env` file:

```bash
chmod +x scripts/delete-resources.sh
./scripts/delete-resources.sh
```

The script performs two steps:

1. **Deletes the resource group** — removes all Azure resources (Cosmos DB, OpenAI, etc.)
2. **Purges the Azure OpenAI resource** — Cognitive Services resources enter a **soft-deleted** state for 48 days after deletion. The name remains reserved and counts against subscription quotas until purged. The script waits for the resource group deletion to complete, then runs `az cognitiveservices account purge`.

## Next steps

Explore these resources to learn more about vector search and the ARM SDK:

- [Azure Cosmos DB vector search](https://learn.microsoft.com/azure/cosmos-db/gen-ai/vector-search) — Understanding DiskANN and vector search
- [Vector indexing policies](https://learn.microsoft.com/azure/cosmos-db/index-policy) — Detailed index configuration reference
- [@azure/arm-cosmosdb SDK reference](https://www.npmjs.com/package/@azure/arm-cosmosdb) — ARM SDK documentation
- [Configure RBAC with Microsoft Entra ID](https://learn.microsoft.com/azure/cosmos-db/how-to-setup-rbac) — Setting up identity-based access
- [Quickstart: Vector store with Azure Cosmos DB for NoSQL](https://learn.microsoft.com/azure/cosmos-db/quickstart-vector-store-nodejs) — End-to-end guide with data-plane container creation
