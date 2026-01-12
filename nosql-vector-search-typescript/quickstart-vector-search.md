---
title: "Quickstart: Vector search with Node.js in Azure Cosmos DB for NoSQL"
description: Learn how to generate embeddings with Azure OpenAI, store vectors in Azure Cosmos DB, and query with VectorDistance for nearest neighbors using TypeScript.
author: diberry
ms.author: diberry
ms.service: cosmos-db
ms.subservice: nosql
ms.topic: quickstart
ms.date: 2026-01-12
ms.custom: devx-track-typescript, devx-track-js
---

# Quickstart: Vector search with Node.js in Azure Cosmos DB for NoSQL

[!INCLUDE[NoSQL](../includes/appliesto-nosql.md)]

This quickstart shows you how to use Azure Cosmos DB for NoSQL as a vector store for AI-powered semantic search applications. You'll learn how to:

> [!div class="checklist"]
> * Generate embeddings with Azure OpenAI
> * Store vector embeddings in JSON documents
> * Query with `VectorDistance` for nearest neighbors
> * Interpret similarity scores

## Prerequisites

* An Azure subscription - [create one for free](https://azure.microsoft.com/free/)
* [Node.js LTS](https://nodejs.org/) (version 18.x or higher)
* [Azure CLI](/cli/azure/install-azure-cli) for authentication
* Azure Cosmos DB for NoSQL account - [create via portal](../quickstart-portal.md)
* Azure OpenAI resource with `text-embedding-ada-002` model deployed - [setup guide](/azure/ai-services/openai/how-to/create-resource)

## Set up your environment

1. Clone the sample repository:

    ```bash
    git clone https://github.com/Azure-Samples/cosmos-db-vector-samples.git
    cd cosmos-db-vector-samples/nosql-vector-search-typescript
    ```

1. Install dependencies:

    ```bash
    npm install
    ```

1. Create a `.env` file from the example:

    ```bash
    cp .env.example .env
    ```

1. Update `.env` with your Azure resource information:

    ```env
    AZURE_OPENAI_EMBEDDING_MODEL=text-embedding-ada-002
    AZURE_OPENAI_EMBEDDING_API_VERSION=2023-05-15
    AZURE_OPENAI_EMBEDDING_ENDPOINT=https://<your-resource>.openai.azure.com
    
    COSMOS_ENDPOINT=https://<your-account>.documents.azure.com:443/
    
    DATA_FILE_WITH_VECTORS=../data/HotelsData_toCosmosDB_Vector.json
    EMBEDDED_FIELD=text_embedding_ada_002
    EMBEDDING_DIMENSIONS=1536
    ```

1. Authenticate with Azure for passwordless connections:

    ```bash
    az login
    ```

## Store embeddings in Cosmos DB

Vector embeddings are stored as arrays within your JSON documents. Here's the document schema:

```json
{
  "HotelId": "1",
  "HotelName": "Stay-Kay City Hotel",
  "Description": "This classic hotel is fully-refurbished...",
  "Rating": 3.6,
  "text_embedding_ada_002": [0.021, -0.045, 0.123, ..., 0.089]
}
```

### Create a container with vector indexing

Configure your Cosmos DB container to support vector search:

```typescript
import { CosmosClient, VectorEmbeddingPolicy, VectorEmbeddingDataType, 
         VectorEmbeddingDistanceFunction, IndexingPolicy, VectorIndexType } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';

// Create client with managed identity
const credential = new DefaultAzureCredential();
const client = new CosmosClient({ 
    endpoint: process.env.COSMOS_ENDPOINT!,
    aadCredentials: credential
});

const { database } = await client.databases.createIfNotExists({ id: "Hotels" });

// Define vector embedding policy
const vectorEmbeddingPolicy: VectorEmbeddingPolicy = {
    vectorEmbeddings: [{
        path: "/text_embedding_ada_002",
        dataType: VectorEmbeddingDataType.Float32,
        dimensions: 1536,
        distanceFunction: VectorEmbeddingDistanceFunction.Cosine,
    }]
};

// Define indexing policy with DiskANN vector index
const indexingPolicy: IndexingPolicy = {
    vectorIndexes: [
        { path: "/text_embedding_ada_002", type: VectorIndexType.DiskANN }
    ],
    includedPaths: [{ path: "/*" }],
    excludedPaths: [{ path: "/text_embedding_ada_002/*" }]
};

// Create container
await database.containers.createIfNotExists({
    id: "hotels",
    vectorEmbeddingPolicy: vectorEmbeddingPolicy,
    indexingPolicy: indexingPolicy,
    partitionKey: { paths: ['/HotelId'] }
});
```

### Generate and insert documents with embeddings

Use Azure OpenAI to generate embeddings and insert documents:

```typescript
import { AzureOpenAI } from "openai";
import { getBearerTokenProvider } from "@azure/identity";

// Create Azure OpenAI client
const credential = new DefaultAzureCredential();
const azureADTokenProvider = getBearerTokenProvider(
    credential, 
    "https://cognitiveservices.azure.com/.default"
);

const aiClient = new AzureOpenAI({
    apiVersion: process.env.AZURE_OPENAI_EMBEDDING_API_VERSION!,
    endpoint: process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT!,
    deployment: process.env.AZURE_OPENAI_EMBEDDING_MODEL!,
    azureADTokenProvider
});

// Generate embedding
const embedding = await aiClient.embeddings.create({
    model: "text-embedding-ada-002",
    input: ["This classic hotel is fully-refurbished..."]
});

// Insert document with vector
const container = database.container("hotels");
const hotel = {
    HotelId: "1",
    HotelName: "Stay-Kay City Hotel",
    Description: "This classic hotel is fully-refurbished...",
    Rating: 3.6,
    text_embedding_ada_002: embedding.data[0].embedding
};

await container.items.create(hotel);
```

## Run your first vector similarity search

Perform a vector search using the `VectorDistance` function:

```typescript
// Generate embedding for search query
const queryEmbedding = await aiClient.embeddings.create({
    model: "text-embedding-ada-002",
    input: ["find a hotel by a lake"]
});

// Perform vector similarity search
// Note: In production, use validateFieldName() from utils.ts to prevent NoSQL injection
import { validateFieldName } from './utils.js';
const embeddedField = validateFieldName(process.env.EMBEDDED_FIELD!);

const { resources } = await container.items.query({
    query: `SELECT TOP 5 c.HotelName, c.Description, c.Rating, 
            VectorDistance(c.${embeddedField}, @embedding) AS SimilarityScore 
            FROM c 
            ORDER BY VectorDistance(c.${embeddedField}, @embedding)`,
    parameters: [
        { name: "@embedding", value: queryEmbedding.data[0].embedding }
    ]
}).fetchAll();

// Display results
resources.forEach(item => {
    console.log(`${item.HotelName} - Score: ${item.SimilarityScore.toFixed(4)}`);
});
```

## What does a vector query return?

A vector search query returns documents ordered by similarity to your search query. Each result includes:

* **Selected fields** - Any document fields specified in the SELECT clause
* **SimilarityScore** - The computed cosine similarity score
* **Ordered results** - Documents sorted from most to least similar

### Example results

```console
Lakeside Resort Hotel - Score: 0.9234
Mountain View Lodge - Score: 0.8876
Harbor Inn - Score: 0.8543
```

### Interpret similarity scores

For **cosine similarity** (range 0.0 to 1.0):

| Score Range | Interpretation | Use Case |
|------------|----------------|----------|
| 0.95 - 1.0 | Nearly identical | Duplicate detection |
| 0.90 - 0.94 | Very similar | Highly relevant results |
| 0.80 - 0.89 | Similar | Relevant recommendations |
| 0.70 - 0.79 | Somewhat similar | Broader matches |
| < 0.70 | Different | May not be relevant |

## Distance metrics explained

Azure Cosmos DB supports three distance functions:

### Cosine similarity (recommended)

Measures the angle between vectors, independent of magnitude.

```typescript
distanceFunction: VectorEmbeddingDistanceFunction.Cosine
```

**Best for:** Text embeddings and semantic search  
**Score range:** 0.0 to 1.0 (higher = more similar)

### Euclidean distance (L2)

Measures straight-line distance in n-dimensional space.

```typescript
distanceFunction: VectorEmbeddingDistanceFunction.Euclidean
```

**Best for:** When magnitude matters, image embeddings  
**Score range:** 0.0 to ∞ (lower = more similar)

### Dot product

Measures the projection of one vector onto another.

```typescript
distanceFunction: VectorEmbeddingDistanceFunction.DotProduct
```

**Best for:** Normalized vectors, recommendation systems  
**Score range:** -∞ to +∞ (higher = more similar)

## Vector index types

Choose the right index for your dataset size:

### DiskANN (recommended for production)

Best for large-scale applications (50,000+ vectors).

```typescript
vectorIndexes: [{ path: "/text_embedding_ada_002", type: VectorIndexType.DiskANN }]
```

* **Accuracy:** High (approximate)
* **Performance:** Very fast
* **Scale:** Billions of vectors
* **Use case:** Enterprise AI applications, RAG patterns

### Flat (exact search)

Best for small datasets requiring perfect accuracy.

```typescript
vectorIndexes: [{ path: "/text_embedding_ada_002", type: VectorIndexType.Flat }]
```

* **Accuracy:** 100% (exact k-NN)
* **Performance:** Slower for large datasets
* **Scale:** Small to medium
* **Use case:** Development, testing

### QuantizedFlat (balanced)

Best for medium to large datasets.

```typescript
vectorIndexes: [{ path: "/text_embedding_ada_002", type: VectorIndexType.QuantizedFlat }]
```

* **Accuracy:** ~100%
* **Performance:** Fast
* **Scale:** Large datasets
* **Use case:** Production with balanced needs

## Run the complete sample

Build and run the sample application:

```bash
npm run build
npm run start:diskann
```

Expected output:

```console
========================================
DiskANN Vector Index Demo
========================================

Database 'Hotels' ready.
Container 'hotels-diskann' created with DiskANN index.

Loading hotel data with embeddings...
Loaded 50 hotels from file.

Inserting documents...
✓ Inserted 50 documents successfully.

Query: "find a modern hotel with great city views and luxury amenities"
Generating embedding for query...
✓ Query embedding generated.

Performing vector similarity search with DiskANN...
✓ Search completed.

========================================
Top 5 Results (DiskANN Index)
========================================

1. City View Grand Hotel
   Similarity Score: 0.9156
   Rating: 4.8/5.0
   Description: Modern luxury hotel featuring panoramic city views...

2. Urban Heights Hotel
   Similarity Score: 0.8923
   Rating: 4.6/5.0
   Description: Contemporary hotel with stunning metropolitan views...
```

## Clean up resources

When you're done with the sample, you can delete the container:

```typescript
await database.container("hotels-diskann").delete();
```

To delete the entire database:

```typescript
await database.delete();
```

## Next steps

> [!div class="nextstepaction"]
> [Learn more about vector search in Cosmos DB](../vector-search.md)

> [!div class="nextstepaction"]
> [Explore DiskANN for enterprise scale](../gen-ai/sharded-diskann.md)

> [!div class="nextstepaction"]
> [Build RAG applications with Cosmos DB](/azure/cosmos-db/gen-ai/rag)

## Related content

* [Azure Cosmos DB vector search overview](../vector-search.md)
* [Vector indexing policies](../nosql/vector-search.md)
* [Azure OpenAI embeddings](/azure/ai-services/openai/how-to/embeddings)
* [Sample code on GitHub](https://github.com/Azure-Samples/cosmos-db-vector-samples)
