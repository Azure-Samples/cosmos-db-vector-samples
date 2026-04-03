# Azure Cosmos DB NoSQL Vector Search with Java

> **Note:** This sample uses `azure-ai-openai 1.0.0-beta.16` (preview). This dependency may have breaking changes in future releases.

Java sample demonstrating Azure Cosmos DB NoSQL as a vector store, using the `com.azure:azure-cosmos` SDK with passwordless authentication.

## Features

- **Passwordless authentication** — `DefaultAzureCredential` for both Cosmos DB and Azure OpenAI
- **Bulk insert** — efficient document loading via the Cosmos DB bulk API
- **Vector similarity search** — SQL queries with `VectorDistance()` function
- **Algorithm selection** — DiskANN and QuantizedFlat via `VECTOR_ALGORITHM` environment variable
- **Injection safety** — field name validation before query interpolation

## Prerequisites

- **Java 21** or later (`java --version`)
- **Maven 3.8+** (`mvn --version`)
- **Azure CLI** with an active login (`az login`)
- An Azure subscription with:
  - **Azure Cosmos DB for NoSQL** account with a `Hotels` database and vector-indexed containers (`hotels_diskann`, `hotels_quantizedflat`) using a **MultiHash** partition key on `/HotelId`
  - **Azure OpenAI** deployment of `text-embedding-3-small` (or equivalent embedding model)

## Getting Started

### 1. Configure environment variables

If you provisioned resources with Azure Developer CLI (`azd`), generate your `.env` file from the deployed environment:

```bash
azd env get-values > .env
```

Otherwise, copy the template and fill in your Azure resource values manually:

```bash
cp sample.env .env
```

Then load the variables into your shell:

```bash
set -a && source .env && set +a
```

### 2. Build the project

```bash
mvn compile
```

### 3. Run the sample

```bash
# DiskANN (default)
mvn exec:java

# QuantizedFlat
export VECTOR_ALGORITHM=quantizedflat
mvn exec:java
```

## Vector Search Algorithms

| Algorithm | Container | Best For |
|---|---|---|
| **DiskANN** | `hotels_diskann` | Large datasets, high recall with low latency |
| **QuantizedFlat** | `hotels_quantizedflat` | Smaller datasets, simpler indexing |

## Distance Functions

Set `VECTOR_DISTANCE_FUNCTION` to one of: `cosine` (default), `euclidean`, `dotproduct`.

## Project Structure

```
nosql-vector-search-java/
├── pom.xml                          # Maven configuration
├── sample.env                       # Environment variable template
├── README.md                        # This file
└── src/main/java/com/example/cosmos/vectorsearch/
    ├── VectorSearch.java            # Main entry point
    └── Utils.java                   # Auth, bulk insert, validation, formatting
```

## Code Overview

### VectorSearch.java (main entry point)

1. Reads configuration from environment variables
2. Creates Cosmos DB and OpenAI clients with `DefaultAzureCredential`
3. Loads hotel data from the shared JSON file
4. Bulk-inserts documents (skips if container already populated)
5. Generates an embedding for the sample query
6. Executes a `VectorDistance()` SQL query and prints the top 5 results

### Utils.java (shared utilities)

- `createOpenAIClient()` / `createCosmosClient()` — passwordless client factories
- `readJsonFile()` — loads the hotel dataset from disk
- `insertData()` — bulk insert with RU tracking and duplicate detection
- `validateFieldName()` — prevents NoSQL injection in query construction
- `printSearchResults()` — formatted output of search results and RU cost

## Resources

- [Azure Cosmos DB vector search](https://learn.microsoft.com/azure/cosmos-db/nosql/vector-search)
- [Azure Cosmos DB Java SDK](https://github.com/Azure/azure-sdk-for-java/tree/main/sdk/cosmos/azure-cosmos)
- [DefaultAzureCredential](https://learn.microsoft.com/java/api/com.azure.identity.defaultazurecredential)
- [Azure OpenAI Java SDK](https://github.com/Azure/azure-sdk-for-java/tree/main/sdk/openai/azure-ai-openai)
