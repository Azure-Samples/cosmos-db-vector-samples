# Azure Cosmos DB NoSQL Vector Search with TypeScript

This project demonstrates how to use **Azure Cosmos DB for NoSQL** as a vector store for AI-powered semantic search applications. It shows how to generate embeddings with Azure OpenAI, store vectors in JSON documents, and query with `VectorDistance` for nearest neighbors.

## 📚 Table of Contents

- [Architecture Overview](#architecture-overview)
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Understanding Vector Search](#understanding-vector-search)
- [Vector Index Types](#vector-index-types)
- [Distance Metrics](#distance-metrics)
- [Code Examples](#code-examples)
- [Running the Samples](#running-the-samples)
- [Understanding Query Results](#understanding-query-results)
- [Resources](#resources)

## 🏗️ Architecture Overview

This application demonstrates the following workflow:

```
┌──────────┐      Request embeddings      ┌───────────────┐
│   App    │ ─────────────────────────────> │ Azure OpenAI  │
└──────────┘                                └───────────────┘
     │                                              │
     │ Request AAD token                       Return vector
     │                                              │
     ▼                                              ▼
┌──────────────┐  Role assignment    ┌─────────────────────┐
│   Managed    │ ◄──────────────────>│   Cosmos DB NoSQL   │
│   Identity   │                      │   (Vector Store)    │
└──────────────┘                      └─────────────────────┘
     │                                        ▲
     │ AAD token                              │
     └────────────────────────────────────────┘
              Upsert doc with vector
              VectorDistance top-k query



The script will:
- Create a resource group
- Create a user-assigned managed identity
- Create an Azure Cosmos DB account (NoSQL API) with database and container
- Create an Azure OpenAI account with text-embedding-3-small model deployed
- Assign proper RBAC roles for both control plane and data plane access:
  - **Cosmos DB**: Built-in Data Contributor (data plane) + DocumentDB Account Contributor (control plane)
  - **Azure OpenAI**: Cognitive Services OpenAI User
- Output environment configuration ready to copy to your `.env` file

**Customization Options:**

```bash
# Customize resource names and location
export USER_PRINCIPAL="your-email@domain.com"
export RESOURCE_PREFIX="my-vector-demo"
export LOCATION="eastus2"
./provision-azure-resources.sh
```

After the script completes, copy the environment configuration output to your `.env` file.

### Bulk Insert & RU accounting

This repo includes sample helpers that use the Cosmos DB SDK `executeBulkOperations()` API for high-throughput inserts. Key points from the samples:

- Use `executeBulkOperations()` — the modern SDK method for bulk operations. The SDK accepts an unbounded list of operations and internally handles batching, dispatch, and throttling through congestion control algorithms. The API is designed to handle a large number of operations efficiently.
- **Pre-batching is not required** — unless you have memory limitations with the input data, you do not need to manually batch operations before sending. Only batch if memory constraints exist.
- The helper provides an insert method to provide bulk operations.
- RU accounting: the repository provides a method to get BulkOperation RUs.

Notes:
- Bulk responses vary between SDK versions.
- Bulk operations are not transactional; use `TransactionalBatch` for atomicity within a single partition (max 100 ops).

This reads hotel data from `DATA_FILE_WITHOUT_VECTORS`, generates embeddings using Azure OpenAI, and saves the result to `DATA_FILE_WITH_VECTORS`.

## 🔍 Understanding Vector Search

### What are Vector Embeddings?

Vector embeddings are numerical representations of text, images, or other data in a high-dimensional space. Similar items have similar vector representations, allowing for semantic search rather than just keyword matching.

**Example:**
- Text: `"hotel by the lake"`
- Vector: `[0.021, -0.045, 0.123, ..., 0.089]` (1536 dimensions)

### How Does Vector Search Work?

1. **Generate embeddings** for your documents using an embedding model
2. **Store vectors** in Cosmos DB alongside your JSON documents
3. **Create vector indexes** for efficient similarity search
4. **Query** by generating an embedding for your search text
5. **Find similar items** using distance functions (e.g., cosine similarity)

### Storing Embeddings in Cosmos DB

Embeddings are stored as arrays within your JSON documents:

```json
{
  "HotelId": "1",
  "HotelName": "Stay-Kay City Hotel",
  "Description": "This classic hotel is fully-refurbished...",
  "Rating": 3.6,
  "vector": [0.021, -0.045, 0.123, ..., 0.089]
}
```

## 🎯 Vector Index Types

Cosmos DB for NoSQL supports three vector indexing algorithms. **For production workloads, we strongly recommend using QuantizedFlat or DiskANN** instead of Flat.

### 1. **DiskANN** (Recommended for Production at Scale)

```typescript
vectorIndexes: [
    { path: "/vector", type: VectorIndexType.DiskANN }
]
```

**Characteristics:**
- ⚡ Optimized for low latency, highly scalable workloads
- 📊 High recall with configurable trade-offs
- 💾 Efficient RU consumption at scale
- 📐 Supports up to 4096 dimensions
- 🎯 Ideal for RAG, semantic search, recommendations
- ✅ **Recommended for most production scenarios**

### 2. **QuantizedFlat** (Recommended for General Use)


```typescript
vectorIndexes: [
    { path: "/vector", type: VectorIndexType.QuantizedFlat }
]
```

**Characteristics:**
- 🚀 Faster brute-force search on quantized vectors
- 📊 High recall
- 📐 Supports up to 4096 dimensions
- ⚖️ Balance of speed, accuracy, and cost for smaller datasets
- ✅ **Recommended for most use cases**

### 3. **Flat** (Not Recommended for General Use)

**⚠️ Important:** Flat index should generally be avoided for most use cases. We strongly recommend using QuantizedFlat or DiskANN indexes instead.

**Only use Flat for:** Testing purposes, very small datasets (hundreds of vectors), and small dimensional vectors ( <505 dimensions )

```typescript
vectorIndexes: [
    { path: "/vector", type: VectorIndexType.Flat }
]
```

**Characteristics:**
- ✅ 100% recall (exact k-NN search using brute-force)
- 🐌 Very slow for any significant dataset size
- ⚠️ Scales linearly as the number of vectors increases.
- 📏 Limited to only 505 dimensions
- 🧪 Only suitable for testing or tiny datasets
- ❌ **Not recommended for production use**

**Why avoid Flat?**
- Scales linearly, not optimized for larger scales
- Dimension limitations prevent use with many modern embedding models
- QuantizedFlat provides nearly identical accuracy with far better performance
- No production benefits over QuantizedFlat or DiskANN

### Comparison Table

| Index Type      | Accuracy  | Performance | Scale                  | Dimensions | Use Case                                                                                  |
|----------------|-----------|-------------|------------------------|-----------|---------------------------------------------------------------------------------------------|
| **DiskANN**    | High      | Very Fast   | 50k+ vectors           | ≤ 4096     | Production, medium-to-large scale and when cost-efficiency/latency at scale are important |
| **QuantizedFlat** | ~100%  | Fast        | Up to 50k+ vectors     | ≤ 4096     | Production or when searches isolated to small number of vectors with partition key filter |
| **Flat**       | 100%      | Very Slow   | Thousands of vectors   | ≤ 505      | Dev/test on small dimensional vectors                                                      |

## 📏 Distance Metrics

Cosmos DB supports three distance functions for measuring vector similarity:

### 1. **Cosine Similarity** (Recommended for most models)

Measures the angle between vectors, independent of magnitude.

```typescript
distanceFunction: VectorEmbeddingDistanceFunction.Cosine
```

**Score Range:** 0.0 to 1.0 - Higher scores (closer to 1.0) indicate greater similarity, while lower scores indicate less similarity  
**Example:** `"hotel by lake"` vs `"lakeside accommodation"` → Score: 0.92

### 2. **Euclidean Distance (L2)**

Measures the straight-line distance between vectors in n-dimensional space.

```typescript
distanceFunction: VectorEmbeddingDistanceFunction.Euclidean
```

**Score Range:** 0.0 to ∞ (lower = more similar)  
**Example:** Two similar images → Distance: 1.23

### 3. **Dot Product**

Measures the projection of one vector onto another.

```typescript
distanceFunction: VectorEmbeddingDistanceFunction.DotProduct
```

**Score Range:** -∞ to +∞ (higher = more similar)  
**Example:** User preferences vs item features → Score: 0.87

## 💻 Code Examples

### Creating a Vector-Enabled Container

```typescript
import { CosmosClient, VectorEmbeddingPolicy, VectorEmbeddingDataType, 
         VectorEmbeddingDistanceFunction, IndexingPolicy, VectorIndexType } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';

// Create Cosmos DB client with managed identity
const credential = new DefaultAzureCredential();
const client = new CosmosClient({ 
    endpoint: process.env.COSMOS_ENDPOINT!,
    aadCredentials: credential
});

// Define vector embedding policy
const vectorEmbeddingPolicy: VectorEmbeddingPolicy = {
    vectorEmbeddings: [{
        path: "/vector",
        dataType: VectorEmbeddingDataType.Float32,
        dimensions: 1536,
        distanceFunction: VectorEmbeddingDistanceFunction.Cosine,
    }]
};

// Define indexing policy with vector index
const indexingPolicy: IndexingPolicy = {
    vectorIndexes: [
        { path: "/vector", type: VectorIndexType.DiskANN }
    ],
    includedPaths: [{ path: "/*" }],
    excludedPaths: [{ path: "/vector/*" }]
};

// IMPORTANT: Samples must NOT create or check resources. Assume the database
// and container were provisioned by the repo's provisioning script or by the
// user via the portal/CLI and that appropriate data-plane RBAC is configured.
// Do NOT call management-plane APIs such as `createIfNotExists()` in sample code.

// Get references to existing resources (data-plane only)
const database = client.database("Hotels");
const container = database.container("hotels");

// The following `vectorEmbeddingPolicy` and `indexingPolicy` are shown for
// documentation purposes only to illustrate the expected container settings.
// Do not attempt to create or modify these policies from sample code.
const vectorEmbeddingPolicy: VectorEmbeddingPolicy = {
    vectorEmbeddings: [{
        path: "/vector",
        dataType: VectorEmbeddingDataType.Float32,
        dimensions: 1536,
        distanceFunction: VectorEmbeddingDistanceFunction.Cosine,
    }]
};

const indexingPolicy: IndexingPolicy = {
    vectorIndexes: [
        { path: "/vector", type: VectorIndexType.DiskANN }
    ],
    includedPaths: [{ path: "/*" }],
    excludedPaths: [{ path: "/vector/*" }]
};
```

### Inserting Documents with Vectors

```typescript
// Generate embedding using Azure OpenAI
const embedding = await aiClient.embeddings.create({
    model: "text-embedding-3-small",
    input: ["This classic hotel is fully-refurbished..."]
});

// Insert document with vector
const hotel = {
    HotelId: "1",
    HotelName: "Stay-Kay City Hotel",
    Description: "This classic hotel is fully-refurbished...",
    Rating: 3.6,
    vector: embedding.data[0].embedding
};

await container.items.create(hotel);
```

### Querying with VectorDistance

```typescript
// Generate embedding for search query using the Azure OpenAI client
const queryEmbeddingResp = await aiClient.embeddings.create({
    model: process.env.AZURE_OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
    input: ["find a hotel by a lake"]
});

// If your samples allow the embedding field name to be configured (env/config),
// validate it before injecting into the SQL string to prevent SQL injection.
const embeddedField = process.env.EMBEDDED_FIELD ?? "vector";
if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(embeddedField)) {
    throw new Error(`Invalid embedded field name: ${embeddedField}`);
}

// Build query with embedded field injected via template literal (field name
// cannot be passed as a SQL parameter in Cosmos DB SQL syntax).
const querySpec = {
    query: `SELECT TOP 5 c.HotelName, c.Description, c.Rating, VectorDistance(c.${embeddedField}, @embedding) AS SimilarityScore FROM c ORDER BY VectorDistance(c.${embeddedField}, @embedding)`,
    parameters: [
        { name: "@embedding", value: queryEmbeddingResp.data[0].embedding }
    ]
};

const { resources } = await container.items.query(querySpec).fetchAll();
resources.forEach(item => {
    console.log(`${item.HotelName} - Score: ${item.SimilarityScore?.toFixed(4) ?? 'n/a'}`);
});
```

## Prerequisites

- Node.js 22
- [Azure Developer CLI (azd)](https://aka.ms/azd/install)
- [Azure CLI](https://docs.microsoft.com/cli/azure/install-azure-cli) (for login)

## 🏃 Running the Samples

Clone the Repository

```bash
git clone https://github.com/Azure-Samples/cosmos-db-vector-samples.git
cd cosmos-db-vector-samples/nosql-vector-search-typescript
```

Build the TypeScript code:

```bash
npm run build
```

### Optional - Generate Embeddings

This step is only needed if you choose a different embedding model or data. By default, the sample uses `text-embedding-3-small` and the provided hotel data, which already has embeddings generated. If you want to generate your own embeddings for the sample data, run:

```bash
npm run start:embed
```

Reads hotel data, generates embeddings via Azure OpenAI, and saves to file.

### Run DiskANN Demo (Recommended)

```bash
npm run start:diskann
```

Demonstrates vector search with DiskANN index - recommended for production at scale.

### Run QuantizedFlat Demo (Recommended)

```bash
npm run start:quantizedflat
```

Demonstrates balanced vector search with QuantizedFlat index - recommended for general use.

### Run Flat Index Demo (Testing Only)

```bash
npm run start:flat
```

Demonstrates exact vector search with Flat index. **Note:** This is provided for testing purposes only and is generally not recommended for production use due to performance at scale. Use QuantizedFlat or DiskANN instead.

## 📊 Understanding Query Results

### Sample Output

```
========================================
Top 5 Results (DiskANN Index)
========================================

1. Lakeside Resort Hotel
   Similarity Score: 0.9234
   Rating: 4.5/5.0
   Description: Beautiful lakeside hotel with stunning mountain views...

2. Mountain View Lodge
   Similarity Score: 0.8876
   Rating: 4.2/5.0
   Description: Cozy lodge overlooking pristine alpine lake...

3. Harbor Inn
   Similarity Score: 0.8543
   Rating: 4.0/5.0
   Description: Waterfront hotel with scenic harbor views...
```

### What Does a Query Return?

A vector search query returns:

1. **Selected Fields** - Any fields you specify in the SELECT clause
2. **SimilarityScore** - The computed distance/similarity score
3. **RequestCharge** - RU cost for the query
4. **Results** - Ordered by similarity (most similar first)

**Example Result Object:**
```json
{
  "HotelName": "Lakeside Resort Hotel",
  "Description": "Beautiful lakeside hotel...",
  "Rating": 4.5,
  "SimilarityScore": 0.9234
}
```

## 📖 Resources

### Official Documentation

- [Azure Cosmos DB Vector Search Overview](https://learn.microsoft.com/azure/cosmos-db/vector-search)
- [Vector Search for NoSQL API](https://learn.microsoft.com/azure/cosmos-db/nosql/vector-search)
- [Integrated Vector Store](https://learn.microsoft.com/azure/cosmos-db/vector-search)
- [DiskANN in Cosmos DB](https://learn.microsoft.com/azure/cosmos-db/gen-ai/sharded-diskann)

### Getting Started Guides

- [Cosmos DB Introduction](https://learn.microsoft.com/azure/cosmos-db/introduction)
- [Quickstart: Bicep Template](https://learn.microsoft.com/azure/cosmos-db/quickstart-template-bicep)
- [Azure OpenAI Embeddings](https://learn.microsoft.com/azure/ai-services/openai/how-to/embeddings)

### SDK References

- [@azure/cosmos npm package](https://www.npmjs.com/package/@azure/cosmos)
- [@azure/identity npm package](https://www.npmjs.com/package/@azure/identity)
- [openai npm package](https://www.npmjs.com/package/openai)

### Related Samples

- [MongoDB vCore Vector Search (TypeScript)](../mongo-vcore-vector-search-typescript/)
- [Cosmos DB Vector Samples (All Languages)](https://github.com/Azure-Samples/cosmos-db-vector-samples)

## 🚀 Using Azure Developer CLI (azd)

The Azure Developer CLI (`azd`) provides a streamlined way to provision and deploy Azure resources with a single command.

### Prerequisites

- [Azure Developer CLI (azd)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd) installed

### Provision with azd

1. **Authenticate with Azure:**

    ```bash
    azd auth login
    ```

2. **Provision all Azure resources:**

    ```bash
    azd up
    ```

    This command will:
    - Provision Azure Cosmos DB account with database and container
    - Provision Azure OpenAI account with embedding model deployed
    - Configure RBAC roles automatically
    - Set up all required Azure resources

3. **Generate your `.env` file:**

    ```bash
    azd env get-values > .env
    ```

    This exports all environment variables from the azd environment directly to your `.env` file, ready to use with the sample applications.

4. **Run the samples:**

    ```bash
    npm install
    npm run build
    npm run start:diskann
    ```

The `azd` workflow is the fastest way to get started, handling all infrastructure provisioning and configuration automatically.

## 🤝 Contributing

This project welcomes contributions and suggestions. See [CONTRIBUTING.md](../CONTRIBUTING.md) for details.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE.md](../LICENSE.md) file for details.