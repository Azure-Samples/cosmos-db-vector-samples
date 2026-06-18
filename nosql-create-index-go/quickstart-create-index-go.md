---
title: "Quickstart: Create and query vector indexes in Azure Cosmos DB for NoSQL using Go"
description: Use Go and Azure SDK libraries to load pre-vectorized hotel documents into existing Azure Cosmos DB for NoSQL vector containers and query them with VectorDistance.
author: diberry
ms.author: diberry
ms.service: azure-cosmos-db
ms.topic: quickstart
ms.date: 2026-06-09
---

# Quickstart: Create and query vector indexes in Azure Cosmos DB for NoSQL using Go

This sample loads pre-vectorized hotel documents into existing Azure Cosmos DB for NoSQL containers and queries them using `VectorDistance`. It uses data-plane operations only and assumes the database, containers, and Azure OpenAI resource were already created by `azd up` or a shared Bicep deployment.

The full source code is available on GitHub: [cosmos-db-vector-samples/nosql-create-index-go](https://github.com/Azure-Samples/cosmos-db-vector-samples/tree/main/nosql-create-index-go).

## Prerequisites

- An Azure subscription. [Create a free account](https://azure.microsoft.com/free/).
- [Azure CLI](/cli/azure/install-azure-cli) installed and signed in (`az login`).
- [Go 1.23 or later](https://go.dev/dl/) installed.
- An Azure Cosmos DB for NoSQL account with vector search enabled.
- Existing resources created by `azd up` or the shared Bicep deployment:
  - Database: `HotelsCreateIndex`
  - Containers: `hotels_diskann` and `hotels_quantizedflat`
  - Partition key path: `/PartitionKey`
  - Vector field path: `/DescriptionVector`
- Microsoft Entra ID role assignments:
  - **Cosmos DB Built-in Data Contributor** on the Azure Cosmos DB account
  - **Cognitive Services OpenAI User** on the Azure OpenAI resource
- An Azure OpenAI resource with a `text-embedding-3-small` deployment.

> [!NOTE]
> **RBAC roles:** Data-plane RBAC role definitions and assignments are created by `azd up` via Bicep templates. You can also create them programmatically using the management SDK — see [`SqlResources.BeginCreateUpdateSqlRoleDefinitionAsync`](https://learn.microsoft.com/dotnet/api/azure.resourcemanager.cosmosdb.sqlresources.begincreateupdate-sqlroledefinitionasync) (.NET) or [`SqlResources.BeginCreateUpdateSqlRoleDefinition`](https://pkg.go.dev/github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/cosmosdb/armcosmosdb#SqlResourcesClient.BeginCreateUpdateSqlRoleDefinition) (Go).

> [!IMPORTANT]
> This sample targets the **`HotelsCreateIndex`** database with partition key `/PartitionKey` (value: `"hotels"`). It is **not** the `Hotels` database that uses `/HotelId` as the partition key. The Go sample uses concurrent individual inserts where every document shares the same partition key value.

## Clone the repository

```bash
git clone https://github.com/Azure-Samples/cosmos-db-vector-samples.git
cd cosmos-db-vector-samples/nosql-create-index-go
```

## Configure environment variables

Configure environment variables.

**If you deployed with `azd up`:**

```bash
azd env get-values > .env
```

**Otherwise**, copy the template and fill in values from the Azure portal:

```bash
cp .env.example .env
```

The `.env.example` file contains the following variables:

```dotenv
AZURE_COSMOSDB_ENDPOINT=https://YOUR-COSMOS-ACCOUNT.documents.azure.com:443/
AZURE_COSMOSDB_DATABASENAME=HotelsCreateIndex
AZURE_COSMOSDB_CONTAINER_NAME=
AZURE_OPENAI_EMBEDDING_ENDPOINT=https://YOUR-AOAI-RESOURCE.openai.azure.com/
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=text-embedding-3-small
VECTOR_ALGORITHM=
DATA_FILE_WITH_VECTORS=data/HotelsData_toCosmosDB_Vector.json
```

Set `VECTOR_ALGORITHM` to `diskann`, `quantizedflat`, or leave it empty to run against both containers. When `AZURE_COSMOSDB_CONTAINER_NAME` and `VECTOR_ALGORITHM` are both empty, the sample iterates over both known containers (`hotels_diskann` and `hotels_quantizedflat`).

## Install dependencies and run

Download Go module dependencies:

```bash
go mod download
```

Run the sample:

```bash
go run .
```

## The sample performs these steps

1. Loads configuration from environment variables.
1. Validates required environment variables and container names.
1. Authenticates with `DefaultAzureCredential`.
1. Creates an Azure Cosmos DB client and accesses the existing database.
1. Reads `data/HotelsData_toCosmosDB_Vector.json` and prepares documents (adds `id` from `HotelId`, sets `PartitionKey` to `"hotels"`).
1. Generates a query embedding by calling the Azure OpenAI REST API with a bearer token.
1. For each target container:
   - Inserts documents concurrently (max 10 goroutines) using `CreateItem`.
   - Skips documents that already exist (HTTP 409 Conflict).
   - Fails if any insert returns an unexpected error.
   - Runs a `VectorDistance()` SQL query with a parameterized embedding.
   - Prints the top 5 matching hotels.

## Understand the project structure

```text
nosql-create-index-go/
├── .env.example
├── README.md
├── go.mod
├── go.sum
├── config.go
├── config_test.go
├── dataplane.go
├── main.go
├── output/
│   └── sample-output.txt
└── tests/
    └── config_test.go
```

| File | Purpose |
|------|---------|
| `config.go` | Loads and validates environment variables. |
| `dataplane.go` | Implements document ingestion, embedding generation, and vector queries. |
| `main.go` | Entry point; orchestrates configuration, ingestion, and queries. |
| `go.mod` | Module definition; declares `azidentity` and `azcosmos` dependencies. |

## Key implementation details

### Load configuration and validate

The sample uses `godotenv` to populate environment variables from `.env` and then validates that all required values are present before connecting to any Azure service.

```go
cfg, err := LoadConfig()
if err != nil {
    log.Fatalf("configuration error: %v", err)
}
```

### Connect with Microsoft Entra ID

Authentication uses `DefaultAzureCredential`, which transparently supports the Azure CLI, environment variables, managed identity, and other credential sources without code changes.

```go
credential, err := azidentity.NewDefaultAzureCredential(nil)
if err != nil {
    log.Fatalf("failed to create DefaultAzureCredential: %v", err)
}

cosmosClient, err := azcosmos.NewClient(cfg.CosmosEndpoint, credential, nil)
if err != nil {
    log.Fatalf("failed to create Azure Cosmos DB client: %v", err)
}
```

### Insert documents concurrently

To maximize throughput the sample fans out document inserts across up to 10 goroutines using a semaphore channel. HTTP 409 Conflict responses are treated as safe-to-skip so the sample is idempotent.

```go
partitionKey := azcosmos.NewPartitionKey().AppendString(partitionKeyFieldValue)
semaphore := make(chan struct{}, maxInsertConcurrency)

for _, document := range documents {
    wg.Add(1)
    go func() {
        defer wg.Done()
        semaphore <- struct{}{}
        defer func() { <-semaphore }()

        body, _ := json.Marshal(document)
        response, err := container.CreateItem(ctx, partitionKey, body, nil)
        // Handle 409 Conflict as skip, other errors as failure
    }()
}
```

### Generate embedding via Azure OpenAI REST API

The sample acquires a bearer token from `DefaultAzureCredential` and calls the Azure OpenAI embeddings endpoint directly over HTTP, avoiding a dependency on the OpenAI SDK.

```go
token, err := credential.GetToken(ctx, policy.TokenRequestOptions{
    Scopes: []string{"https://cognitiveservices.azure.com/.default"},
})

// POST to /openai/deployments/{deployment}/embeddings?api-version=...
request.Header.Set("Authorization", "Bearer "+token.Token)
```

### Run the vector similarity query

The query uses `VectorDistance()` to rank documents by similarity to the generated embedding. The embedding is passed as a parameterized value to avoid string interpolation of large arrays.

```go
queryText := fmt.Sprintf(`SELECT TOP 5
    c.HotelId, c.HotelName, c.Description,
    VectorDistance(c.%s, @embedding) AS score
FROM c
ORDER BY VectorDistance(c.%s, @embedding)`, embeddingField, embeddingField)

options := azcosmos.QueryOptions{
    QueryParameters: []azcosmos.QueryParameter{{
        Name:  "@embedding",
        Value: json.RawMessage(embeddingJSON),
    }},
}

partitionKey := azcosmos.NewPartitionKey().AppendString(partitionKeyFieldValue)
pager := container.NewQueryItemsPager(queryText, partitionKey, &options)
```

## Example output

```output
Azure Cosmos DB vector index sample (Go)
database=Hotels primaryContainer=hotels_diskann vectorAlgorithm=diskann dataFile=.../data/HotelsData_toCosmosDB_Vector.json
embeddingDeployment=text-embedding-3-small dimensions=1536 partitionKey=hotels

=== hotels_diskann ===
inserted=50 skipped=0 failed=0 total=50 writeRU=123.45
1. HotelId=12 | HotelName=Ocean Breeze Suites | score=0.0834 | Description=Modern waterfront hotel...
queryRU=3.21

=== hotels_quantizedflat ===
inserted=50 skipped=0 failed=0 total=50 writeRU=121.88
1. HotelId=12 | HotelName=Ocean Breeze Suites | score=0.0834 | Description=Modern waterfront hotel...
queryRU=3.47
```

A full recorded run is saved in `output/sample-output.txt`.

## Troubleshooting

| Issue | Resolution |
|-------|-----------|
| `configuration error: missing required environment variables` | Verify `.env` exists and all required variables are set. Run `cp .env.example .env` and fill in the values. |
| `failed to create Azure Cosmos DB client` / 403 Forbidden | Confirm your identity has the **Cosmos DB Built-in Data Contributor** role. RBAC propagation can take several minutes after assignment. |
| `failed to insert N documents` | One or more concurrent inserts failed. Check container throughput settings and confirm each document is under 2 MB. |
| `embedding dimensions mismatch: got X, expected 1536` | The deployment returns a different vector size than expected. Verify you're using `text-embedding-3-small` without dimension truncation. |
| `get Azure OpenAI bearer token: ... 401` | Confirm your identity has the **Cognitive Services OpenAI User** role on the Azure OpenAI resource. |

## Next steps

- Review a recorded run in `output/sample-output.txt`.
- Set `VECTOR_ALGORITHM=diskann` or `VECTOR_ALGORITHM=quantizedflat` to focus on a single container.
- Learn more about [Azure Cosmos DB vector search](/azure/cosmos-db/nosql/vector-search).
