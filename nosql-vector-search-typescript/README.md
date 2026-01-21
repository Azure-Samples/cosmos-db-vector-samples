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
              Matches + scores
```

## ✨ Features

This project demonstrates:

✅ **Embedding Generation** - Generate vector embeddings using Azure OpenAI  
✅ **Vector Storage** - Store embeddings in JSON documents in Cosmos DB  
✅ **Vector Indexing** - Multiple indexing algorithms (DiskANN and QuantizedFlat are recommended)  
✅ **Similarity Search** - Query with `VectorDistance` for nearest neighbors  
✅ **Managed Identity** - Passwordless authentication with Azure AD  
✅ **Distance Metrics** - Support for Cosine, Euclidean (L2), and DotProduct  
✅ **Score Interpretation** - Understand and interpret similarity scores  

## 📋 Prerequisites

Before you begin, ensure you have:

- **Azure Subscription** - [Create a free account](https://azure.microsoft.com/free/)
- **Node.js** - Version 18.x or higher ([Download](https://nodejs.org/))
- **TypeScript** - Installed globally (`npm install -g typescript`)
- **Azure Cosmos DB Account** - NoSQL API account ([Create via Portal](https://learn.microsoft.com/azure/cosmos-db/quickstart-template-bicep))
- **Azure OpenAI Service** - With `text-embedding-ada-002` model deployed ([Setup Guide](https://learn.microsoft.com/azure/ai-services/openai/how-to/create-resource))
- **Azure CLI** - For authentication ([Install Guide](https://learn.microsoft.com/cli/azure/install-azure-cli))

## 🚀 Getting Started

### Option A: Automated Provisioning (Recommended)

Use the provided Azure CLI script to automatically create all required resources with proper RBAC roles:

```bash
# Set your Azure AD user principal
export USER_PRINCIPAL="your-email@domain.com"

# Run the provisioning script
./provision-azure-resources.sh
```

The script will:
- Create a resource group
- Create a user-assigned managed identity
- Create an Azure Cosmos DB account (NoSQL API) with database and container
- Create an Azure OpenAI account with text-embedding-ada-002 model deployed
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

### Option B: Manual Setup

#### 1. Clone the Repository

```bash
git clone https://github.com/Azure-Samples/cosmos-db-vector-samples.git
cd cosmos-db-vector-samples/nosql-vector-search-typescript
```

#### 2. Install Dependencies

```bash
npm install
```

#### 3. Configure Environment Variables

Create a `.env` file from the example:

```bash
cp .env.example .env
```

Edit `.env` with your Azure resource information:

```env
# Azure OpenAI Configuration
AZURE_OPENAI_EMBEDDING_MODEL=text-embedding-ada-002
AZURE_OPENAI_EMBEDDING_API_VERSION=2023-05-15
AZURE_OPENAI_EMBEDDING_ENDPOINT=https://<your-resource>.openai.azure.com

# Cosmos DB Configuration
COSMOS_ENDPOINT=https://<your-account>.documents.azure.com:443/

# Data Configuration
DATA_FILE_WITHOUT_VECTORS=../data/HotelsData_toCosmosDB.JSON
DATA_FILE_WITH_VECTORS=../data/HotelsData_toCosmosDB_Vector.json
FIELD_TO_EMBED=Description
EMBEDDED_FIELD=text_embedding_ada_002
EMBEDDING_DIMENSIONS=1536
LOAD_SIZE_BATCH=50
```

#### 4. Set Up Azure Resources and RBAC

**Create Cosmos DB Account:**

```bash
# Create Cosmos DB account
az cosmosdb create \
    --name <your-cosmos-account> \
    --resource-group <your-rg> \
    --location eastus \
    --kind GlobalDocumentDB
```

**Assign Cosmos DB RBAC Roles:**

Cosmos DB has custom RBAC roles for data plane access:

```bash
# Get your user object ID
USER_ID=$(az ad user show --id your-email@domain.com --query id -o tsv)

# Get Cosmos DB resource ID
COSMOS_ID=$(az cosmosdb show --name <your-cosmos-account> --resource-group <your-rg> --query id -o tsv)

# Assign data plane access (Cosmos DB Built-in Data Contributor)
az cosmosdb sql role assignment create \
    --account-name <your-cosmos-account> \
    --resource-group <your-rg> \
    --role-definition-id "00000000-0000-0000-0000-000000000002" \
    --principal-id $USER_ID \
    --scope $COSMOS_ID

# Assign control plane access (DocumentDB Account Contributor)
az role assignment create \
    --assignee $USER_ID \
    --role "DocumentDB Account Contributor" \
    --scope $COSMOS_ID
```

**Create Azure OpenAI and Assign Roles:**

```bash
# Create Azure OpenAI account
az cognitiveservices account create \
    --name <your-openai-account> \
    --resource-group <your-rg> \
    --kind OpenAI \
    --sku S0 \
    --location eastus

# Get OpenAI resource ID
OPENAI_ID=$(az cognitiveservices account show --name <your-openai-account> --resource-group <your-rg> --query id -o tsv)

# Assign OpenAI User role
az role assignment create \
    --assignee $USER_ID \
    --role "Cognitive Services OpenAI User" \
    --scope $OPENAI_ID

# Deploy embedding model
az cognitiveservices account deployment create \
    --name <your-openai-account> \
    --resource-group <your-rg> \
    --deployment-name text-embedding-ada-002 \
    --model-name text-embedding-ada-002 \
    --model-version "2" \
    --model-format OpenAI \
    --sku-name "Standard" \
    --sku-capacity 10
```

#### 5. Authenticate with Azure

The samples use **managed identity** for passwordless authentication:

```bash
az login
```

#### 6. Generate Embeddings (Optional)

If you need to generate embeddings for your data:

```bash
npm run build
npm run start:embed
```

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
- 📊 Say high recall, not ~100%.
- 📐 Supports up to 4096 dimensions
- ⚖️ Best balance of speed, accuracy, and cost
- ✅ **Recommended for most use cases**

### 3. **Flat** (Not Recommended for General Use)

**⚠️ Important:** Flat index should **NOT** be used in general. We strongly recommend using **QuantizedFlat or DiskANN** instead.

**Only use Flat for:** Testing purposes, very small datasets (hundreds of vectors), and small dimensional vectors (<100 dimensions)

**Why you should avoid Flat:** It has severe performance limitations, poor scalability, and is restricted to only 505 dimensions, making it unsuitable for most modern embedding models and production scenarios.

```typescript
vectorIndexes: [
    { path: "/vector", type: VectorIndexType.Flat }
]
```

**Characteristics:**
- ✅ 100% recall (exact k-NN search using brute-force)
- 🐌 Very slow for any significant dataset size
- ⚠️ Severe performance degradation as data grows
- 📏 Limited to only 505 dimensions
- 🧪 Only suitable for testing or tiny datasets
- ❌ **Not recommended for production use**

**Why avoid Flat?**
- Poor scalability and query performance
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

### 1. **Cosine Similarity** (Recommended)

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

// Create container
const { database } = await client.databases.createIfNotExists({ id: "Hotels" });
await database.containers.createIfNotExists({
    id: "hotels",
    vectorEmbeddingPolicy: vectorEmbeddingPolicy,
    indexingPolicy: indexingPolicy,
    partitionKey: { paths: ['/HotelId'] }
});
```

### Inserting Documents with Vectors

```typescript
// Generate embedding using Azure OpenAI
const embedding = await aiClient.embeddings.create({
    model: "text-embedding-ada-002",
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
// Generate embedding for search query
const queryEmbedding = await aiClient.embeddings.create({
    model: "text-embedding-ada-002",
    input: ["find a hotel by a lake"]
});

// Perform vector similarity search
const { resources } = await container.items.query({
    query: `SELECT TOP 5 c.HotelName, c.Description, c.Rating, 
            VectorDistance(c.vector, @embedding) AS SimilarityScore 
            FROM c 
            ORDER BY VectorDistance(c.vector, @embedding)`,
    parameters: [
        { name: "@embedding", value: queryEmbedding.data[0].embedding }
    ]
}).fetchAll();

// Display results
resources.forEach(item => {
    console.log(`${item.HotelName} - Score: ${item.SimilarityScore.toFixed(4)}`);
});
```

## 🏃 Running the Samples

Build the TypeScript code:

```bash
npm run build
```

### Generate Embeddings

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

Demonstrates exact vector search with Flat index. **Note:** This is provided for testing purposes only and is not recommended for production use. Use QuantizedFlat or DiskANN instead.

### All-in-One Demo

```bash
npm run start:index-and-query
```

Complete demo: creates index, inserts data, and performs search.

### Enterprise-Grade Insert

```bash
npm run start:insert-at-scale
```

Demonstrates resilient, production-ready document insertion with retry logic.

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

## 🤝 Contributing

This project welcomes contributions and suggestions. See [CONTRIBUTING.md](../CONTRIBUTING.md) for details.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE.md](../LICENSE.md) file for details.