# Quickstart: Create Azure Cosmos DB vector indexes with the ARM SDK and TypeScript

Create two Azure Cosmos DB for NoSQL containers with **vector indexes** using the Azure Resource Manager SDK (`@azure/arm-cosmosdb`) in an existing database. Then validate the configuration by generating embeddings with Azure OpenAI, inserting documents into both containers, running `VectorDistance()` similarity queries, and cleaning up the sample containers.

This quickstart uses three layers:

| Layer | Tool | What it does |
|---|---|---|
| **Azure CLI script** | `scripts/create-resources.sh` | Creates the resource group, Azure OpenAI resource, Cosmos DB account, and database |
| **Control plane** | `src/control-plane.ts` (`@azure/arm-cosmosdb`) | Deletes existing sample containers, creates both containers with vector indexes, and cleans them up |
| **Data plane** | `src/data-plane.ts` (`@azure/cosmos` + `openai`) | Inserts documents and runs vector queries |

All authentication uses Microsoft Entra ID via `DefaultAzureCredential` — no API keys or connection strings.

## Prerequisites

To complete this quickstart, you need:

- An Azure account with an active subscription — [create one for free](https://azure.microsoft.com/free/)
- [Node.js LTS](https://nodejs.org/)
- [Azure CLI](/cli/azure/install-azure-cli) installed and logged in (`az login`)
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
src/config.ts                      src/control-plane.ts          src/data-plane.ts
───────────────────────────        ──────────────────────        ─────────────────
Loads config from .env             1. Containers + vector index  3. Verify embedding dimensions
Validates required env vars        2. Sample container cleanup  4. Insert documents (bulk)
Resolves ./data file path                                        5. Vector similarity queries

src/index.ts orchestrates the flow. The data file lives in ./data/.
Creates credential
Calls control-plane, then
  data-plane functions
```

## Run the Azure CLI setup script

The setup script creates the Azure resource group, Azure OpenAI resource, Cosmos DB account, and database, then writes a `.env` file with all configuration values needed by `src/index.ts`.

**Option A — If you deployed with `azd up`:**

```powershell
npm run create-env
```

**Option B — Otherwise**, use the standalone setup script:

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

## Set up environment variables

**⚠️ Important:** Environment variables MUST be loaded in your current session BEFORE running the sample. They are not passed via the `azd` command—they are read by `src/config.ts` at runtime.

| Action | PowerShell | Bash |
|--------|-----------|------|
| Load from `.env` file | `Get-Content .env \| ForEach-Object { if ($_ -match "^([^=]+)=(.*)$") { [Environment]::SetEnvironmentVariable($matches[1], $matches[2]) } }` | `export $(grep -v "^#" .env \| xargs)` |
| Set single variable | `[Environment]::SetEnvironmentVariable("AZURE_COSMOSDB_ENDPOINT", "https://your-account.documents.azure.com:443/")` | `export AZURE_COSMOSDB_ENDPOINT="https://your-account.documents.azure.com:443/"` |

**Required environment variables:**
- `AZURE_COSMOSDB_ENDPOINT` — Cosmos DB endpoint URL
- `AZURE_COSMOSDB_DATABASENAME` — Database name (e.g., "HotelsCreateIndex")
- `AZURE_SUBSCRIPTION_ID` — Your Azure subscription ID
- `AZURE_RESOURCE_GROUP` — Your Azure resource group name
- `AZURE_COSMOSDB_ACCOUNT_NAME` — Your Cosmos DB account name
- `AZURE_OPENAI_ENDPOINT` — Azure OpenAI endpoint URL
- `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` — Deployment name (e.g., "text-embedding-3-small")

**Optional environment variables:**
- `VECTOR_ALGORITHM` — "diskann" or "quantizedflat"; leave empty to run **both** containers
- `AZURE_COSMOSDB_CREATE_INDEX_DISKANN_CONTAINER_NAME` — Custom diskANN container name (default: "hotels_diskann")
- `AZURE_COSMOSDB_CREATE_INDEX_QUANTIZEDFLAT_CONTAINER_NAME` — Custom quantizedFlat container name (default: "hotels_quantizedflat")

## Install dependencies

Install the required npm packages:

```bash
npm install
```

This installs:

| Package | Purpose |
|---|---|
| `@azure/arm-cosmosdb` | ARM SDK — control plane operations (create and delete sample containers) |
| `@azure/cosmos` | Data plane SDK — read/write documents and run queries |
| `@azure/identity` | `DefaultAzureCredential` for Microsoft Entra ID authentication |
| `openai` | Azure OpenAI client for generating embeddings |

## Run the sample

Run the package script. It compiles TypeScript and loads `.env`:

```bash
npm start
```

The script creates, loads, queries, and cleans up both sample containers. Control-plane code uses the ARM SDK to create and delete the containers in an existing database. Data-plane code validates embeddings, inserts documents, and runs vector queries.

## Walk through the code

The TypeScript code is split into four main files:

| File | Purpose |
|---|---|
| `src/config.ts` | Loads environment variables and resolves the data file path |
| `src/index.ts` | Orchestrator — loads config from `.env`, creates shared credential, calls control-plane then data-plane functions |
| `src/control-plane.ts` | ARM SDK operations (`@azure/arm-cosmosdb`) — deletes existing sample containers, creates both containers with vector indexes, and cleans them up |
| `src/data-plane.ts` | Data plane operations (`@azure/cosmos` + `openai`) — inserts documents and runs vector queries |
| `data/` | Local folder for `HotelsData_toCosmosDB_Vector_byRegion.json` |

### Authentication

The orchestrator (`src/index.ts`) creates a single `DefaultAzureCredential` and passes it to factory functions in each module — no API keys needed:

```typescript
// src/index.ts — orchestrator
import { DefaultAzureCredential } from "@azure/identity";
import { createArmClient, createContainer, cleanupSampleContainers } from "./control-plane.js";
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

### Step 1: Create both containers with vector indexes (control-plane.ts)

This is the critical step. The sample always creates both `hotels_diskann_ts` and `hotels_quantizedflat_ts` in the existing database. The container's `vectorEmbeddingPolicy` and `vectorIndexes` are **immutable after creation** — they cannot be changed afterward, regardless of whether the container was created via ARM SDK, Bicep, Portal, or CLI.

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

Configuration decisions:

| Setting | Value | Why |
|---|---|---|
| `type` | `diskANN` and `quantizedFlat` | The sample compares a graph-based index with an index that uses vector quantization techniques |
| `partitionKey` | `/Region`, `MultiHash`, version `2` | Matches the code's regional partition-key routing |
| `dimensions` | `1536` | Must match the output of `text-embedding-3-small` |
| `distanceFunction` | `cosine` | Standard for text similarity |
| `dataType` | `float32` | Full-precision embeddings |
| `path` | `/embedding` | Field in each document that stores the embedding vector |

> **Important:** Vector indexes are immutable. If you need to change the index type, dimensions, or distance function, delete and recreate the sample containers or create new containers and migrate data. RBAC role definitions and assignments are handled by deployment, not by `src/control-plane.ts`.

### Step 2: Verify embedding dimensions (data-plane.ts)

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

### Step 3: Insert documents from data file (data-plane.ts)

The sample loads pre-vectorized hotel data from `./data/HotelsData_toCosmosDB_Vector_byRegion.json` by default and inserts all documents into both containers using the Cosmos DB bulk execution API:

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
    partitionKey: [item.Region],
  }));

  const response = await container.items.executeBulkOperations(operations);
}
```

Key points about this approach:

- **Pre-vectorized data** — the JSON file already contains `embedding` embeddings, so no Azure OpenAI calls are needed during insert.
- **Bulk execution** — `executeBulkOperations()` handles batching, parallelization across partitions, and automatic retry/throttling internally.
- **Idempotent** — if the container already has documents, the insert is skipped.
- **409 conflicts** — individual document conflicts (already exists) are treated as success.

### Step 4: Run vector similarity queries (data-plane.ts)

Use `VectorDistance()` to find documents similar to a natural language query. `src/index.ts` runs this function for both sample containers:

```typescript
async function vectorQuery(container, containerName, openaiClient, config) {
  const queryText = "hotel near the ocean";
  const response = await openaiClient.embeddings.create({
    model: config.openai.embeddingDeployment,
    input: [queryText],
  });
  const queryEmbedding = response.data[0].embedding;

  const embeddingField = config.embeddingField;

  // Validate field name — Cosmos DB SQL does not support parameter
  // placeholders for field names, so the field is string-interpolated.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(embeddingField)) {
    throw new Error(`Invalid embedding field name: ${embeddingField}`);
  }

  const distanceFunctions = [
    { name: "Cosine", orderDirection: "DESC" },
    { name: "DotProduct", orderDirection: "DESC" },
    { name: "Euclidean", orderDirection: "ASC" },
  ];

  for (const distFunc of distanceFunctions) {
    const distanceFunction = distFunc.name;
    const { resources, requestCharge } = await container.items
      .query({
        query: `SELECT TOP 5 c.HotelId, c.HotelName, c.Description,
                  VectorDistance(c.${embeddingField}, @embedding, false, {'distanceFunction': '${distanceFunction}'}) AS SimilarityScore
                FROM c
                ORDER BY VectorDistance(c.${embeddingField}, @embedding, false, {'distanceFunction': '${distanceFunction}'})`,
        parameters: [{ name: "@embedding", value: queryEmbedding }],
      }, { partitionKey: config.partitionKeyValue })
      .fetchAll();

    // src/index.ts prints the top 1 and top 2 rows in a consolidated table.
    console.log(`  ✓ ${containerName} queried (${requestCharge.toFixed(2)} RUs)`);
  }
}
```

> **Note:** The embedding field name (`embedding`) is injected via string interpolation because Cosmos DB SQL query syntax does not support parameter placeholders for field names. The `@embedding` value is safely parameterized. Always validate field names against a strict pattern when the value comes from configuration.

## Expected output

When you run `npm start`, the console output shows both containers being created, loaded, queried, and cleaned up. The final results are consolidated across metrics and containers:

```
================================================================================
CONSOLIDATED RESULTS — Vector Query with All Metrics & Index Types
================================================================================

| Container          | Metric     | Top 1 Result               | Score  | Top 2 Result               | Score  | Diff   |
|--------------------|------------|----------------------------|--------|----------------------------|--------|--------|
| hotels_diskann_ts  | Cosine     | City Center Summer Wind Re | 0.4025 | Red Tide Hotel             | 0.4000 | 0.0025 |
| hotels_diskann_ts  | DotProduct | City Center Summer Wind Re | 0.4025 | Red Tide Hotel             | 0.4001 | 0.0025 |
| hotels_diskann_ts  | Euclidean  | City Center Summer Wind Re | 1.0933 | Red Tide Hotel             | 1.0956 | 0.0023 |
| hotels_quantizedflat_ts | Cosine     | City Center Summer Wind Re | 0.4025 | Red Tide Hotel             | 0.4000 | 0.0025 |
| hotels_quantizedflat_ts | DotProduct | City Center Summer Wind Re | 0.4027 | Red Tide Hotel             | 0.4001 | 0.0025 |
| hotels_quantizedflat_ts | Euclidean  | City Center Summer Wind Re | 1.0934 | Red Tide Hotel             | 1.0957 | 0.0023 |

=== Cleanup: Remove Sample Containers ===
  ✓ Deleted container: hotels_diskann_ts
  ✓ Deleted container: hotels_quantizedflat_ts

Complete
```

> **Tip:** The non-zero similarity scores confirm the vector search pipeline is working end-to-end — the vector indexes were created with the correct dimensions, embeddings are stored in the documents, and `VectorDistance()` is computing actual distances or similarity scores. If the vector configuration were incorrect, the query would either fail with an error or return `null` similarity scores.

## Verify the vector index is working

During the run, before the cleanup step deletes the sample containers, use these checks to confirm the vector indexes were created correctly, the queries used them, and the results are genuinely from vector search. After cleanup, `container show` returns not found by design.

### 1. Confirm the vector indexes exist on the containers

Use Azure CLI to inspect each container's indexing policy and vector embedding policy:

```bash
az cosmosdb sql container show \
  --account-name $AZURE_COSMOSDB_ACCOUNT_NAME \
  --resource-group $AZURE_RESOURCE_GROUP \
  --database-name $AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME \
  --name hotels_diskann_ts \
  --query "{vectorIndexes: resource.indexingPolicy.vectorIndexes, vectorEmbeddingPolicy: resource.vectorEmbeddingPolicy}" \
  --output json
```

The output should show the `vectorIndexes` array with your path and index type, and a `vectorEmbeddingPolicy` with matching dimensions, data type, and distance function. Repeat the check for `hotels_quantizedflat_ts`. If either is `null` or empty, the container was not created with vector support.

You can also verify in the Azure Portal: navigate to your Cosmos DB account → **Data Explorer** → select your database and container → **Settings** → **Indexing Policy** to see the `vectorIndexes` and `vectorEmbeddingPolicy` configuration.

### 2. Confirm the query used the vector index

Two signals confirm the vector index was actually used:

- **The query succeeded** — `ORDER BY VectorDistance()` requires a vector index. Without one, Cosmos DB returns an error like `"The order by item requires a corresponding vector index."` If you see results, the index was used.
- **Low RU charge** — a vector index query against 50 documents typically costs 2–5 RU. A brute-force scan (flat index) on the same data would cost significantly more. The query output includes the RU value for each metric/container.

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

> **Important:** If all similarity scores are `0` or `null`, the documents likely don't have the embedding field (`embedding`) populated. If the scores are all identical, the embeddings may be constant or corrupted. Both indicate a problem with the data, not the index.

## Index type comparison

This sample uses both **diskANN** and **quantizedFlat**. Here's how the available index types compare:

| Index Type | Best For | Technique | Recall |
|---|---|---|---|
| **DiskANN** | Production, > 10K vectors | Graph-based search | High (tunable) |
| **QuantizedFlat** | General use, moderate scale | Vector quantization | High |

> **Important:** QuantizedFlat uses vector quantization techniques. DiskANN is graph-based. These are distinct approaches.

The current code creates both supported index types in every run.

## What if you need to change your index?

Vector indexes are **immutable after container creation**. If you need to change the index type, dimensions, or distance function:

1. **Update code or infrastructure intentionally** — choose the desired algorithm and container name
2. **Run `npm start`** — deletes and recreates the sample containers in the existing database
3. **Migrate data** — copy documents if you are changing a non-sample container
4. **Update your application** — point to the new container name
5. **Delete old containers** — clean up via Azure Portal or Azure CLI

> **Tip:** It's much cheaper to recreate an empty test container than to migrate production data. Test with representative data volumes before committing to an index type.

## Control plane vs. data plane

This quickstart uses both planes:

| Operation | Plane | Tool | Role required |
|---|---|---|---|
| Create account | Control | `scripts/create-resources.sh` (Azure CLI) | Contributor (on resource group) |
| Create database | Control | `scripts/create-resources.sh` (Azure CLI) | Contributor |
| Create container + vector index | Control | `src/control-plane.ts` (`@azure/arm-cosmosdb`) | Contributor |
| Read/write documents | Data | `src/data-plane.ts` (`@azure/cosmos`) | Custom data-plane role |
| Run vector queries | Data | `src/data-plane.ts` (`@azure/cosmos`) | Custom data-plane role |

The **Contributor** role (assigned by deployment or `scripts/create-resources.sh`) grants control-plane access to create and manage resources. Data-plane RBAC is also assigned by deployment or setup tooling; `src/control-plane.ts` does not create SQL role definitions or assignments.

## Environment variables

The code reads these values from `.env`:

| Variable | Description |
|---|---|
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID for ARM SDK operations |
| `AZURE_RESOURCE_GROUP` | Resource group that contains the Cosmos DB account |
| `AZURE_LOCATION` | Azure region (default: `eastus2`) |
| `AZURE_COSMOSDB_ACCOUNT_NAME` | Cosmos DB account name |
| `AZURE_COSMOSDB_ENDPOINT` | Cosmos DB document endpoint URL |
| `AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME` | Existing database name (default: `HotelsCreateIndex`) |
| `AZURE_COSMOSDB_CONTAINER_NAME` | Loaded for compatibility, but this sample uses the fixed containers `hotels_diskann_ts` and `hotels_quantizedflat_ts` |
| `VECTOR_INDEX_TYPE` | Loaded for compatibility, but this sample creates both `diskANN` and `quantizedFlat` containers |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI endpoint URL |
| `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | Embedding model deployment name |
| `AZURE_OPENAI_EMBEDDING_API_VERSION` | Embedding API version (default: `2024-08-01-preview`) |
| `AZURE_COSMOSDB_CREATE_INDEX_EMBEDDED_FIELD` | Document field for embedding vectors (default: `embedding`) |
| `EMBEDDING_DIMENSIONS` | Expected embedding dimensions (default: `1536`) |
| `DATA_FILE_WITH_VECTORS_AND_REGIONS` | Path to pre-vectorized data file |
| `DATA_FILE_WITH_VECTORS` | Fallback path to pre-vectorized data file |
| `PARTITION_KEY_VALUE` | Region partition key value for queries (default: `Northeast`) |

If neither data file variable is set, the code uses `./data/HotelsData_toCosmosDB_Vector_byRegion.json`, resolved from the compiled `dist` folder as the sample directory's `data/` subdirectory.

## Key takeaways

The following table summarizes the core concepts demonstrated in this quickstart:

| Concept | Detail |
|---|---|
| Vector indexes are immutable | Defined at container creation via the ARM SDK `vectorEmbeddingPolicy` and `vectorIndexes`, cannot be changed afterward |
| ARM SDK for container creation | `src/control-plane.ts` uses `@azure/arm-cosmosdb` to create and delete both sample containers with vector indexes |
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

- [Azure Cosmos DB vector search](/azure/cosmos-db/gen-ai/vector-search) — Understanding DiskANN and vector search
- [Vector indexing policies](/azure/cosmos-db/index-policy) — Detailed index configuration reference
- [@azure/arm-cosmosdb SDK reference](https://www.npmjs.com/package/@azure/arm-cosmosdb) — ARM SDK documentation
- [Configure RBAC with Microsoft Entra ID](/azure/cosmos-db/how-to-setup-rbac) — Setting up identity-based access
- [Quickstart: Vector store with Azure Cosmos DB for NoSQL](/azure/cosmos-db/quickstart-vector-store-nodejs) — End-to-end guide with data-plane container creation
