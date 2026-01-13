# Quickstart: Vector search with Node.js in Azure Cosmos DB for NoSQL

Use vector search in Azure Cosmos DB with the Node.js client library. Store and query vector data efficiently.

This quickstart uses a sample hotel dataset in a JSON file with vectors from the **text-embedding-3-small** model. The dataset includes hotel names, locations, descriptions, and vector embeddings.

Find the sample code with resource provisioning on [GitHub](https://github.com/Azure-Samples/cosmos-db-vector-samples).

## Prerequisites

- An Azure subscription
  - If you don't have an Azure subscription, create a [free account](https://azure.microsoft.com/pricing/purchase-options/azure-account?cid=msft_learn)

- An existing Cosmos DB resource
  - If you don't have a resource, create a [new resource](https://docs.azure.cn/en-us/cosmos-db/nosql/quickstart-portal)
  - [Role Based Access Control (RBAC) enabled]()
  - [Firewall configured to allow access to your client IP address]()

- [Azure OpenAI resource](/azure/ai-foundry/openai)
  - [Role Based Access Control (RBAC) enabled](/azure/developer/ai/keyless-connections)
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
    npm install @azure/identity @azure/cosmos openai uuid 
    npm install @types/node @types/uuid --save-dev
    ```

    * **@azure/identity** - Azure authentication library for passwordless (managed identity) connections
    * **@azure/cosmos** - Azure Cosmos DB client library for database operations
    * **openai** - OpenAI SDK for generating embeddings with Azure OpenAI
    * **uuid** && **@types/uuid** - Generate unique identifiers for documents with types
    * **@types/node** (dev) - TypeScript type definitions for Node.js APIs


1. Create a `.env` file in your project root for the environment variables:

    ```bash
    # Azure Subscription and Resource Group
    AZURE_SUBSCRIPTION_ID="YOUR_SUBSCRIPTION_ID"
    AZURE_TENANT_ID="YOUR_TENANT_ID"
    AZURE_RESOURCE_GROUP="YOUR_RESOURCE_GROUP_NAME"
    AZURE_ENV_NAME="YOUR_ENVIRONMENT_NAME"
    AZURE_LOCATION="YOUR_AZURE_LOCATION"

    # Azure Cosmos DB
    AZURE_COSMOSDB_ENDPOINT="YOUR_COSMOS_DB_ENDPOINT"
    AZURE_COSMOSDB_DATABASENAME="Hotels"
    COSMOS_ENDPOINT="YOUR_COSMOS_DB_ENDPOINT"

    # Azure OpenAI Service
    AZURE_OPENAI_SERVICE="YOUR_AZURE_OPENAI_SERVICE_NAME"
    AZURE_OPENAI_ENDPOINT="YOUR_AZURE_OPENAI_ENDPOINT"

    # Azure OpenAI - Embedding Model
    AZURE_OPENAI_EMBEDDING_ENDPOINT="YOUR_AZURE_OPENAI_ENDPOINT"
    AZURE_OPENAI_EMBEDDING_MODEL="text-embedding-3-small"
    AZURE_OPENAI_EMBEDDING_DEPLOYMENT="text-embedding-3-small"
    AZURE_OPENAI_EMBEDDING_API_VERSION="2024-08-01-preview"

    # Data Files
    DATA_FILE_WITH_VECTORS="../data/HotelsData_toCosmosDB_Vector.json"
    DATA_FILE_WITHOUT_VECTORS="../data/HotelsData_toCosmosDB.JSON"

    # Embedding Configuration
    FIELD_TO_EMBED="Description"
    EMBEDDED_FIELD="DescriptionVector"
    EMBEDDING_DIMENSIONS=1536
    EMBEDDING_BATCH_SIZE=16

    # Processing Configuration
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

## Create npm scripts

Edit the `package.json` file and add these scripts:

TABs for flat, quantizedflat, diskann (ALGO)

Use these scripts to compile TypeScript files and run the IVF index implementation.

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

This main module provides these features:

- Includes utility functions
- Creates a configuration object for environment variables
- Creates clients for Azure OpenAI and Cosmos DB
- Connects to Cosmos DB, creates a database and collection, inserts data, and creates standard indexes
- Creates a vector index using flat, quantizedFlat, or DiskANN
- Creates an embedding for a sample query text using the OpenAI client. You can change the query at the top of the file
- Runs a vector search using the embedding and prints the results

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

```output
TBD
```

## View and manage data in Visual Studio Code


1. Select the [Cosmos DB extension](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-cosmosdb) in Visual Studio Code to connect to your Azure Cosmos DB account.
1. View the data and indexes in the Hotels database.

    IMAGE of extension with data loaded

## Clean up resources

Delete the resource group, Cosmos DB account, and Azure OpenAI resource when you don't need them to avoid extra costs.

## Related content

* [Azure Cosmos DB vector search overview]()
* [Vector indexing policies]()
* [Azure OpenAI embeddings]()
* [Sample code on GitHub](https://github.com/Azure-Samples/cosmos-db-vector-samples)
