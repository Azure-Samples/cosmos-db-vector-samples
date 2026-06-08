---
title: Quickstart: Create and query vector indexes in Azure Cosmos DB for NoSQL using TypeScript
description: In this quickstart, create an Azure Cosmos DB for NoSQL container with a vector index, load pre-vectorized data, and run a VectorDistance query by using TypeScript.
author: diberry
ms.author: diberry
ms.date: 06/08/2026
ms.service: azure-cosmos-db
ms.subservice: nosql
ms.topic: quickstart
ms.custom: msecd-doc-authoring-1013
#customer intent: As a JavaScript or TypeScript developer, I want to create and query vector indexes in Azure Cosmos DB for NoSQL so that I can validate an end-to-end vector search workflow with Microsoft Entra ID authentication.
---

# Quickstart: Create and query vector indexes in Azure Cosmos DB for NoSQL using TypeScript

In this quickstart, you create an Azure Cosmos DB for NoSQL container with a vector index by using the Azure Resource Manager SDK for JavaScript. Then you use the Azure Cosmos DB SDK and an Azure OpenAI client to verify embedding dimensions, load pre-vectorized hotel data, and run a `VectorDistance()` similarity query. The sample uses `DefaultAzureCredential` throughout, so you don't need API keys.

## Prerequisites

- An Azure subscription. If you don't have one, create a [free account](https://azure.microsoft.com/free/).
- [Node.js 20 or later](https://nodejs.org/download/)
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) installed and signed in
- [Git](https://git-scm.com/downloads)

## Clone the repository

Clone the sample repository and change to the TypeScript sample directory.

```bash
git clone https://github.com/Azure-Samples/cosmos-db-vector-samples.git
cd cosmos-db-vector-samples/nosql-create-index-typescript
```

## Overview: What you'll build

This sample is split into three layers.

| Layer | File or tool | What it does |
|---|---|---|
| Azure CLI setup | `scripts/create-resources.sh` | Creates the resource group, Azure OpenAI resource, Azure Cosmos DB account, database, and `.env` file. |
| Control plane | `src/control-plane.ts` | Uses `@azure/arm-cosmosdb` to create the container with a vector index and create data-plane RBAC. |
| Data plane | `src/data-plane.ts` | Uses `@azure/cosmos` and the `openai` package to verify dimensions, bulk insert documents, and run a `VectorDistance()` query. |

The sample supports `diskANN` and `quantizedFlat`. `DiskANN` is graph-based, and `QuantizedFlat` uses vector quantization techniques. Use `hotels_diskann` for `diskANN` and `hotels_quantizedflat` for `quantizedFlat`. If you need to compare with `Flat`, use it only for test or very small scenarios. For production workloads, use `DiskANN` or `QuantizedFlat`.

## Run the Azure CLI setup script

Run the setup script to create the Azure resources that the TypeScript sample uses.

```bash
chmod +x scripts/create-resources.sh
./scripts/create-resources.sh my-vector-rg eastus2
```

The script writes a `.env` file for the sample. By default, it sets `VECTOR_INDEX_TYPE="diskANN"` and `AZURE_COSMOSDB_CONTAINER_NAME="hotels_diskann"`.

To use `quantizedFlat`, update the `.env` file before you run the sample:

```dotenv
VECTOR_INDEX_TYPE="quantizedFlat"
AZURE_COSMOSDB_CONTAINER_NAME="hotels_quantizedflat"
```

## Install dependencies

Install the npm packages for the sample.

```bash
npm install
```

This command installs `@azure/arm-cosmosdb`, `@azure/cosmos`, `@azure/identity`, and `openai`.

## Run the sample

Run the sample.

```bash
npm start
```

The sample compiles TypeScript, runs `dist/index.js`, creates the container and RBAC, loads the shared data file at `../data/HotelsData_toCosmosDB_Vector.json`, and runs a vector similarity query.

## Understand the output

When the sample runs, the console shows five steps.

1. **Create container with vector index**: `src/control-plane.ts` creates the container and sets `vectorIndexes` and `vectorEmbeddingPolicy`. The index type is `diskANN` or `quantizedFlat`, and the container definition is immutable after creation.
1. **Create data-plane RBAC access**: `src/control-plane.ts` creates a SQL role definition and assigns it to your current identity.
1. **Verify embedding dimensions**: `src/data-plane.ts` uses the Azure OpenAI client to generate a test embedding and confirms that the returned dimension count matches `EMBEDDING_DIMENSIONS`.
1. **Insert documents**: `src/data-plane.ts` loads pre-vectorized hotel documents and inserts them with `executeBulkOperations()`.
1. **Run vector similarity query**: `src/data-plane.ts` generates a query embedding and runs a SQL query that orders results by `VectorDistance()`.

## Explore the code

The sample is organized into three main files.

- **`src/index.ts`** loads configuration from environment variables, validates the required settings, creates a shared `DefaultAzureCredential`, and calls the control-plane and data-plane functions in order.
- **`src/control-plane.ts`** creates the Azure Cosmos DB management client, creates the container with a vector index, and creates the SQL role definition and assignment for data-plane access.
- **`src/data-plane.ts`** creates the Azure Cosmos DB client with the account endpoint and `DefaultAzureCredential`, creates the Azure OpenAI client, checks embedding dimensions, bulk inserts documents, and runs the vector query.

The vector query validates the embedding field name before it injects that field into the SQL string. The query uses string interpolation for the field name because Azure Cosmos DB for NoSQL doesn't support parameter placeholders for field names in `VectorDistance()`.

## Clean up resources

Delete the resource group when you're done.

```azurecli
az group delete --name my-vector-rg --yes --no-wait
```

## Next steps

- Learn more about vector search in Azure Cosmos DB for NoSQL at [/azure/cosmos-db/gen-ai/vector-search](/azure/cosmos-db/gen-ai/vector-search).
- Review Azure Cosmos DB for NoSQL RBAC guidance at [/azure/cosmos-db/how-to-setup-rbac](/azure/cosmos-db/how-to-setup-rbac).
- Browse the Azure Cosmos DB JavaScript SDK overview at [/javascript/api/overview/azure/cosmos-readme](/javascript/api/overview/azure/cosmos-readme).
