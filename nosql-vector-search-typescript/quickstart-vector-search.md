# Quickstart: Vector search with Node.js in Azure Cosmos DB for NoSQL

Use vector search in Azure Cosmos DB with the Node.js client library. Store and query vector data efficiently.

This quickstart uses a sample hotel dataset in a JSON file with vectors from the **text-embedding-3-small** model. The dataset includes hotel names, locations, descriptions, and vector embeddings.

Find the sample code with resource provisioning on [GitHub](https://github.com/Azure-Samples/cosmos-db-vector-samples).

## Prerequisites

- An Azure subscription
  - If you don't have an Azure subscription, create a [free account](https://azure.microsoft.com/pricing/purchase-options/azure-account?cid=msft_learn)

- An existing Cosmos DB resource
  - If you don't have a resource, create a [new resource](https://docs.azure.cn/en-us/cosmos-db/nosql/quickstart-portal)
  - Role Based Access Control (RBAC) roles assigned:
    - **Cosmos DB Built-in Data Contributor** (data plane) - Role ID: `00000000-0000-0000-0000-000000000002`
    - **DocumentDB Account Contributor** (control plane)
  - [Firewall configured to allow access to your client IP address]()

- [Azure OpenAI resource](/azure/ai-foundry/openai/how-to/create-resource?view=foundry-classic&pivots=cli#create-a-resource)
  - Custom domain configured
  - Role Based Access Control (RBAC) role assigned:
    - **Cognitive Services OpenAI User**
  - `text-embedding-3-small` model deployed

- [Visual Studio Code](https://code.visualstudio.com/download)
  - [Cosmos DB extension](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-cosmosdb)

- [Node.js LTS](https://nodejs.org/download/)
- [TypeScript](https://www.typescriptlang.org/download): Install TypeScript globally:

    ```bash
    npm install -g typescript
    ```

## Create a Node.js project

1. Create a new directory for your project and open it in Visual Studio Code:

    ```bash
    mkdir vector-search-quickstart
    code vector-search-quickstart
    ```

1. In the terminal, initialize a Node.js project:

    ```bash
    npm init -y
    npm pkg set type="module"
    ```

1. Install the required packages:

    ```bash
    npm install @azure/identity @azure/cosmos openai
    npm install @types/node --save-dev
    ```

    * **@azure/identity** - Azure authentication library for passwordless (managed identity) connections
    * **@azure/cosmos** - Azure Cosmos DB client library for database operations
    * **openai** - OpenAI SDK for generating embeddings with Azure OpenAI
    * **@types/node** (dev) - TypeScript type definitions for Node.js APIs


1. Create a `.env` file in your project root for the environment variables:

    ```bash
    # Identity for local developer authentication with Azure CLI
    AZURE_TOKEN_CREDENTIALS=AzureCliCredential

    # Azure OpenAI Embedding Settings
    AZURE_OPENAI_EMBEDDING_MODEL=text-embedding-3-small
    AZURE_OPENAI_EMBEDDING_API_VERSION=2023-05-15
    AZURE_OPENAI_EMBEDDING_ENDPOINT=
    EMBEDDING_SIZE_BATCH=16

    # Cosmos DB configuration
    COSMOS_ENDPOINT=

    # Data file
    DATA_FILE_WITH_VECTORS=../data/HotelsData_toCosmosDB_Vector.json
    FIELD_TO_EMBED=Description
    EMBEDDED_FIELD=DescriptionVector
    EMBEDDING_DIMENSIONS=1536
    LOAD_SIZE_BATCH=50
    ```

1. Add a `tsconfig.json` file to configure TypeScript:

    ```bash
    {
        "compilerOptions": {
            "target": "ES2020",
            "module": "NodeNext",
            "moduleResolution": "nodenext",
            "declaration": true,
            "outDir": "./dist",
            "strict": true,
            "esModuleInterop": true,
            "skipLibCheck": true,
            "noImplicitAny": false,
            "forceConsistentCasingInFileNames": true,
            "sourceMap": true,
            "resolveJsonModule": true,
        },
        "include": [
            "src/**/*"
        ],
        "exclude": [
            "node_modules",
            "dist"
        ]
    }
    ```

1. Copy the `HotelsData_toCosmosDB_Vector.json` [raw data file with vectors](https://raw.githubusercontent.com/Azure-Samples/cosmos-db-vector-samples/refs/heads/main/data/HotelsData_toCosmosDB_Vector.json) to your project root.

## Understand the document schema

Before building the application, understand how vectors are stored in Cosmos DB documents. Each hotel document contains:

- **Standard fields**: `HotelId`, `HotelName`, `Description`, `Category`, etc.
- **Vector field**: `DescriptionVector` - an array of 1536 floating-point numbers representing the semantic meaning of the hotel description

Here's a simplified example of a hotel document structure:

```json
{
  "HotelId": "1",
  "HotelName": "Stay-Kay City Hotel",
  "Description": "This classic hotel is fully-refurbished...",
  "Rating": 3.6,
  "DescriptionVector": [
    -0.04886505,
    -0.02030743,
    0.01763356,
    ...
    // 1536 dimensions total
  ]
}
```

**Key points about storing embeddings:**

- **Vector arrays** are stored as standard JSON arrays in your documents
- **Vector policy** defines the path (`/DescriptionVector`), data type (`float32`), dimensions (1536), and distance function (cosine)
- **Indexing policy** creates a vector index on the vector field for efficient similarity search
- The vector field should be **excluded from standard indexing** to optimize insertion performance

For more information on vector policies and indexing, see [Vector search in Azure Cosmos DB for NoSQL](https://learn.microsoft.com/en-us/azure/cosmos-db/vector-search).

## Create npm scripts

Edit the `package.json` file and add these scripts:

TABs for flat, quantizedflat, diskann (ALGO) - order is diskann, quantizedflat, flat with not about flat as for prototyping only

Use these scripts to compile TypeScript files and run the Flat index implementation.

```json
"scripts": { 
    "build": "tsc",
    "start:ALGO": "node --env-file .env dist/ALGO.js"
}
```

## Create code files for vector search 

TABs for flat, quantizedflat, diskann (ALGO)

Create a `src` directory for your TypeScript files. Add two files: `ALGO.ts` and `utils.ts` for the ALGO index implementation:

```bash
mkdir src    
touch src/ALGO.ts
touch src/utils.ts
```

## Create code for vector search

TABs for flat, quantizedflat, diskann (ALGO)

Paste the following code into the `ALGO.ts` file.

[!INSERT FILE]

This main module demonstrates the complete vector search workflow:

### 1. Generate embeddings with Azure OpenAI

The code creates embeddings for query text:

```typescript
const createEmbeddedForQueryResponse = await aiClient.embeddings.create({
    model: config.deployment,
    input: [config.query]
});
```

This converts text like "quintessential lodging near running trails" into a 1536-dimension vector that captures its semantic meaning. For more details on generating embeddings, see [Azure OpenAI embeddings documentation](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/embeddings).

### 2. Store vectors in Cosmos DB

Documents with vector arrays are inserted using the `insertData` utility function:

```typescript
const insertSummary = await insertData(config, container, data.slice(0, config.batchSize));
```

This inserts hotel documents including their pre-generated `DescriptionVector` arrays into the container.

### 3. Run vector similarity search

The code performs a vector search using the `VectorDistance` function:

```typescript
const { resources, requestCharge } = await container.items
    .query({
        query: `SELECT TOP 5 c.HotelName, c.Description, c.Rating, VectorDistance(c.${safeEmbeddedField}, @embedding) AS SimilarityScore FROM c ORDER BY VectorDistance(c.${safeEmbeddedField}, @embedding)`,
        parameters: [
            { name: "@embedding", value: createEmbeddedForQueryResponse.data[0].embedding }
        ]
    })
    .fetchAll();
```

**What this query returns:**

- Top 5 most similar hotels based on vector distance
- Hotel properties: `HotelName`, `Description`, `Rating`
- `SimilarityScore`: A numeric value indicating how similar each hotel is to your query
- Results ordered from most similar to least similar

For more information on the `VectorDistance` function, see [VectorDistance documentation](https://learn.microsoft.com/en-us/cosmos-db/query/vectordistance).

## Create utility functions

Paste the following code into `utils.ts`:

[!INSERT FILE]

This utility module provides these features:

- `JsonData`: Type definition for JSON data structure (Record<string, any>)
- `getClients`: Creates and returns clients for Azure OpenAI and Cosmos DB using API keys
- `getClientsPasswordless`: Creates and returns clients for Azure OpenAI and Cosmos DB using DefaultAzureCredential for passwordless authentication (requires RBAC enabled on both resources)
- `readFileReturnJson`: Reads a JSON file and returns its contents as an array of `JsonData` objects
- `writeFileJson`: Writes an array of `JsonData` objects to a JSON file
- `insertData`: Inserts data in batches into a Cosmos DB container with error handling
- `validateFieldName`: Validates field names to prevent NoSQL injection attacks in query construction
- `printSearchResults`: Prints vector search results including insert summary, hotel names with similarity scores, and request charge in RUs

## Authenticate with Azure CLI

Sign in to Azure CLI before you run the application so it can access Azure resources securely.

```bash
az login
```

The code uses your local developer authentication to access Azure Cosmos DB and Azure OpenAI with the `getClientsPasswordless` function from `utils.ts`. When you set `AZURE_TOKEN_CREDENTIALS=AzureCliCredential`, this setting tells the function to use Azure CLI credentials for authentication _deterministically_. The function relies on [DefaultAzureCredential](/javascript/api/@azure/identity/defaultazurecredential) from **@azure/identity** to find your Azure credentials in the environment. Learn more about how to [Authenticate JavaScript apps to Azure services using the Azure Identity library](/azure/developer/javascript/sdk/authentication/overview).

## Build and run the application

Build the TypeScript files, then run the application:

TABs for flat, quantizedflat, diskann (ALGO)

```bash
npm run build
npm run start:ALGO
```

The app logging and output show:

- Collection creation and data insertion status
- Vector index creation 
- Search results with hotel names and similarity scores

TBD add [output](./output/ALGO.txt) - all 3 outputs are in repo

## Understand distance metrics and similarity scores

### Distance metrics

Azure Cosmos DB for NoSQL supports three distance functions for vector similarity:

| Distance Function | Score Range | Interpretation | Best For |
|------------------|-------------|----------------|----------|
| **Cosine** (default) | 0.0 to 1.0 | Higher scores (closer to 1.0) indicate greater similarity | General text similarity, Azure OpenAI embeddings (used in this quickstart) |
| **Euclidean** (L2) | 0.0 to ∞ | Lower = more similar | Spatial data, when magnitude matters |
| **Dot Product** | -∞ to +∞ | Higher = more similar | When vector magnitudes are normalized |

The distance function is set in the **vector embedding policy** when creating the container:

```typescript
const vectorEmbeddingPolicy: VectorEmbeddingPolicy = {
    vectorEmbeddings: [
        {
            path: "/DescriptionVector",
            dataType: VectorEmbeddingDataType.Float32,
            dimensions: 1536,
            distanceFunction: VectorEmbeddingDistanceFunction.Cosine, // Can be Cosine, Euclidean, or DotProduct
        }
    ],
};
```

### Interpreting similarity scores

In the example output using **cosine similarity**:

- **0.4991** (Royal Cottage Resort) - Highest similarity, best match for "lodging near running trails, eateries, retail"
- **0.4388** (Roach Motel) - Lower similarity, still relevant but less matching
- Scores closer to **1.0** indicate stronger semantic similarity
- Scores near **0** indicate little similarity
- Negative scores indicate dissimilarity (rare with well-formed embeddings)

**Important notes:**

- Absolute score values depend on your embedding model and data
- Focus on **relative ranking** rather than absolute thresholds
- Azure OpenAI embeddings work best with cosine similarity

For detailed information on distance functions, see [What are distance functions?](https://learn.microsoft.com/en-us/azure/cosmos-db/gen-ai/distance-functions)

## View and manage data in Visual Studio Code


1. Select the [Cosmos DB extension](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-cosmosdb) in Visual Studio Code to connect to your Azure Cosmos DB account.
1. View the data and indexes in the Hotels database.

    IMAGE of extension with data loaded

## Clean up resources

Delete the resource group, Cosmos DB account, and Azure OpenAI resource when you don't need them to avoid extra costs.

## Related content

- [Vector search in Azure Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/gen-ai/vector-search-overview)
- [Document Indexer for Azure Cosmos DB (preview)](https://learn.microsoft.com/en-us/azure/cosmos-db/gen-ai/document-indexer)
- [Vector embeddings in Azure Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/gen-ai/vector-embeddings)
- [Support for geospatial queries](https://learn.microsoft.com/en-us/azure/cosmos-db/gen-ai/geospatial-support)