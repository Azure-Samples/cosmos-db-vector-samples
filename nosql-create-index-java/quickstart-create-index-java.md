---
title: Quickstart: Create and query vector indexes in Azure Cosmos DB for NoSQL using Java
description: Use Java and the Azure SDK to load pre-vectorized hotel data into existing Azure Cosmos DB for NoSQL vector containers and run similarity queries with Azure OpenAI embeddings.
author: diberry
ms.author: diberry
ms.service: azure-cosmos-db
ms.topic: quickstart
ms.date: 2026-06-08
---

# Quickstart: Create and query vector indexes in Azure Cosmos DB for NoSQL using Java

In this quickstart, you use the Java sample in `Azure-Samples/cosmos-db-vector-samples` to load pre-vectorized hotel documents into existing Azure Cosmos DB for NoSQL containers and run vector similarity queries. The sample uses `DefaultAzureCredential` for Azure Cosmos DB and the Azure OpenAI client, so you don't need API keys.

The sample is data-plane only. It assumes `azd up` already created the database, the `hotels_diskann` container, and the `hotels_quantizedflat` container with vector policies and indexes.

Find the sample code on GitHub: `nosql-create-index-java/` in `Azure-Samples/cosmos-db-vector-samples`.

## Prerequisites

- An Azure subscription. If you don't have one, create a [free account](https://azure.microsoft.com/free/).
- An Azure Cosmos DB for NoSQL account provisioned by the sample repo's Bicep templates:
  - Vector search enabled
  - Serverless enabled
  - `Hotels` database created
  - `hotels_diskann` and `hotels_quantizedflat` containers created with `/HotelId` as the partition key path
- Microsoft Entra ID role assignments for your identity:
  - **Cosmos DB Built-in Data Contributor**
  - **Cognitive Services OpenAI User**
- An Azure OpenAI resource with a `text-embedding-3-small` deployment.
- [Java 17 LTS](https://learn.microsoft.com/java/openjdk/download)
- [Apache Maven 3.9](https://maven.apache.org/download.cgi) or later
- [!INCLUDE [Azure CLI](~/reusable-content/azure-cli/azure-cli-prepare-your-environment-no-header.md)]

## Clone the repository

```bash
git clone https://github.com/Azure-Samples/cosmos-db-vector-samples.git
cd cosmos-db-vector-samples/nosql-create-index-java
```

## Understand what the sample does

Azure Cosmos DB for NoSQL follows an infra-first pattern for vector indexes:

| Layer | Tool | Responsibility |
|---|---|---|
| Provisioning | `azd up` + Bicep | Creates the Azure Cosmos DB account, database, containers, vector policies, and RBAC |
| Runtime | Java sample | Loads documents, generates a query embedding, and runs `VectorDistance()` queries |

The Java code does **not** create containers or indexes. Vector indexes for Azure Cosmos DB for NoSQL are provisioned when the containers are created.

## Configure environment variables

1. Copy the template file.

   ```powershell
   Copy-Item sample.env .env
   ```

1. Update `.env` with your Azure resource values.

   ```dotenv
   AZURE_COSMOSDB_ENDPOINT="https://<your-account>.documents.azure.com:443/"
   AZURE_COSMOSDB_DATABASENAME="Hotels"
   AZURE_COSMOSDB_CONTAINER_NAME=""
   AZURE_OPENAI_EMBEDDING_ENDPOINT="https://<your-openai-resource>.openai.azure.com/"
   AZURE_OPENAI_EMBEDDING_DEPLOYMENT="text-embedding-3-small"
   AZURE_OPENAI_EMBEDDING_API_VERSION="2024-08-01-preview"
   VECTOR_ALGORITHM=""
   DATA_FILE_WITH_VECTORS="..\\data\\HotelsData_toCosmosDB_Vector.json"
   ```

Leave `AZURE_COSMOSDB_CONTAINER_NAME` and `VECTOR_ALGORITHM` empty to run both containers. Set `VECTOR_ALGORITHM` to `diskann` or `quantizedflat` if you want to target one algorithm.

## Build and run the sample

Compile the sample:

```powershell
mvn compile
```

Run it:

```powershell
mvn exec:java
```

The sample performs these steps:

1. Loads configuration from `.env` and validates required values.
1. Creates one `DefaultAzureCredential` and passes it directly to `CosmosClient`.
1. Reads `..\data\HotelsData_toCosmosDB_Vector.json`.
1. Bulk-upserts documents into `hotels_diskann` and `hotels_quantizedflat`.
1. Uses the Azure OpenAI client to generate a query embedding.
1. Executes a parameterized `VectorDistance()` query and prints the top matches.

## Review the Java project structure

```text
nosql-create-index-java/
├── .env.example
├── output/
│   └── sample-output.txt
├── pom.xml
├── README.md
├── sample.env
└── src/main/java/com/azure/cosmos/createindex/
    ├── App.java
    ├── Config.java
    └── DataPlane.java
```

### App.java

`App.java` orchestrates the sample. It loads configuration, creates the shared credential, verifies embedding dimensions, ingests the hotel dataset, and runs vector queries for each target container.

### Config.java

`Config.java` loads environment variables from the shell or `.env`, resolves the shared dataset path, and maps `VECTOR_ALGORITHM` values to the existing container names.

### DataPlane.java

`DataPlane.java` contains the Azure Cosmos DB and Azure OpenAI client factories plus the data-plane operations:

- bulk upsert using `executeBulkOperations()`
- embedding generation with `EmbeddingsOptions`
- field-name validation before interpolating the embedding field into `VectorDistance()`
- parameterized SQL queries for the embedding vector and `TOP` value

## Expected output

The sample prints embedding validation, ingestion status, and query results for each container. A representative output file is included in `output/sample-output.txt`.

## Next steps

- Learn more about [Azure Cosmos DB for NoSQL vector search](/azure/cosmos-db/nosql/vector-search).
- Review the full sample repo for other languages and scenarios.
- If you haven't provisioned the shared infrastructure yet, run `azd up` from the repo root before rerunning the Java sample.
