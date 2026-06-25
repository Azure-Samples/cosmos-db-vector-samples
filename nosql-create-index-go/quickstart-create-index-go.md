---
title: "Quickstart: Create and query vector indexes in Azure Cosmos DB for NoSQL using Go"
description: Create vector indexes in Azure Cosmos DB for NoSQL using Go and the ARM SDK. Load pre-vectorized hotel documents and compare vector distance functions (Cosine, DotProduct, Euclidean).
author: diberry
ms.author: diberry
ms.service: azure-cosmos-db
ms.topic: quickstart
ms.date: 2026-06-22
---

# Quickstart: Create and query vector indexes in Azure Cosmos DB for NoSQL using Go

In this quickstart, you run the Go create-index sample for Azure Cosmos DB for NoSQL to demonstrate two key goals:

- **Goal 1 (Control Plane):** Use the ARM SDK (armcosmos/v3) to create the `HotelsCreateIndex` database and two vector-indexed containers: `hotels_diskann_go` (approximate search) and `hotels_quantizedflat_go` (exact search).
- **Goal 2 (Distance Functions):** Compare how the same query embedding produces different scores and rankings when using different vector distance functions: Cosine, DotProduct, and Euclidean.

## Prerequisites

- An Azure subscription. [Create a free account](https://azure.microsoft.com/free/).
- [Azure CLI](/cli/azure/install-azure-cli) installed and signed in (`az login`).
- [Go 1.23 or later](https://go.dev/dl/) installed.
- An Azure Cosmos DB for NoSQL account with vector search enabled.
- Microsoft Entra ID roles for your identity:
  - **Cosmos DB Built-in Data Contributor** on the Azure Cosmos DB account
  - **Cognitive Services OpenAI User** on the Azure OpenAI resource
- An Azure OpenAI resource with a `text-embedding-3-small` deployment.

> [!IMPORTANT]
> **Two Phases:**
>
> 1. **Control Plane (Goal 1):** The sample uses the ARM SDK (armcosmos/v3) with `DefaultAzureCredential` to create:
>    - Database: `HotelsCreateIndex`
>    - Containers: `hotels_diskann_go` (DiskANN index) and `hotels_quantizedflat_go` (QuantizedFlat index)
>    - Partition key path: `/Region` (valid values: `Northeast`, `Midwest`, `South`, `West`)
>    - Vector field path: `/embedding` (1536 dimensions, float32)
>
> 2. **Data Plane (Goal 2):** After containers are created, the sample:
>    - Loads pre-vectorized hotel documents
>    - Inserts them concurrently using Region-based batches
>    - Generates a query embedding with Azure OpenAI
>    - Runs `VectorDistance()` queries with three distance functions: **Cosine**, **DotProduct**, and **Euclidean**
>    - Displays rankings for each distance function to show how results differ

## Clone the repository

```bash
git clone https://github.com/Azure-Samples/cosmos-db-vector-samples.git
cd cosmos-db-vector-samples/nosql-create-index-go
```

## Set up the data directory

The sample requires `HotelsData_toCosmosDB_Vector_byRegion.json` to be in a local `data/` subdirectory:

```bash
# Create the data directory if it doesn't exist
mkdir -p ./data

# Copy the data file from the shared location
cp ../HotelsData_toCosmosDB_Vector_byRegion.json ./data/
```

The sample expects the data file at: `./data/HotelsData_toCosmosDB_Vector_byRegion.json`

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
DATA_FILE_WITH_VECTORS_AND_REGIONS=./data/HotelsData_toCosmosDB_Vector_byRegion.json
```

Set `VECTOR_ALGORITHM` to `diskann`, `quantizedflat`, or leave it empty to run against both containers. When `AZURE_COSMOSDB_CONTAINER_NAME` and `VECTOR_ALGORITHM` are both empty, the sample iterates over both known containers (`hotels_diskann_go` and `hotels_quantizedflat_go`).

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

The sample demonstrates both goals in sequence:

**Goal 1 - Control Plane (create containers with vector indexes):**
1. Authenticates with `DefaultAzureCredential`
2. Creates a management client for Azure Resource Manager
3. Creates the `HotelsCreateIndex` database (if needed)
4. Creates the `hotels_diskann_go` container with DiskANN vector index on `/embedding`
5. Creates the `hotels_quantizedflat_go` container with QuantizedFlat vector index on `/embedding`

**Goal 2 - Data Plane (load and query with distance functions):**
1. Loads configuration from environment variables
2. Creates an Azure Cosmos DB data plane client
3. Reads `data/HotelsData_toCosmosDB_Vector_byRegion.json` and prepares documents
4. Generates a query embedding by calling the Azure OpenAI REST API
5. For each target container:
   - Inserts documents concurrently (max 10 goroutines) using `CreateItem`
   - Runs **three separate** `VectorDistance()` SQL queries with different distance functions:
     - **Cosine:** Measures angle between vectors (values: 0 to 2)
     - **DotProduct:** Inner product of vectors (values: any real number)
     - **Euclidean:** Straight-line distance between vectors (values: 0 to √6144)
   - Prints the top 5 matching hotels for each distance function, showing how rankings differ

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

### Goal 1: Create containers using ARM SDK (armcosmos/v3)

The control-plane phase uses the ARM SDK to create containers with vector policies. Authentication is handled by `DefaultAzureCredential`:

```go
credential, err := azidentity.NewDefaultAzureCredential(nil)
if err != nil {
    log.Fatalf("failed to create DefaultAzureCredential: %v", err)
}

client, err := armcosmos.NewSQLResourcesClient(subscriptionID, cred, nil)
if err != nil {
    log.Fatalf("failed to client: %v", err)
}

// Create container with vector index
containerPoller, err := client.BeginCreateUpdateSQLContainer(ctx, resourceGroup, accountName, databaseName, containerName,
    armcosmos.SQLContainerCreateUpdateParameters{
        Location: ptr(location),
        Properties: &armcosmos.SQLContainerCreateUpdateProperties{
            Resource: &armcosmos.SQLContainerResource{
                ID: ptr(containerName),
                PartitionKey: &armcosmos.ContainerPartitionKey{
                    Paths: []*string{ptr("/Region")},
                    Kind:  ptr(armcosmos.PartitionKindHash),
                },
                VectorEmbeddingPolicy: &armcosmos.VectorEmbeddingPolicy{
                    VectorEmbeddings: []*armcosmos.VectorEmbedding{
                        {
                            Path:             ptr("/embedding"),
                            DataType:         ptr(armcosmos.VectorDataTypeFloat32),
                            Dimensions:       ptr(int32(1536)),
                            DistanceFunction: ptr(armcosmos.DistanceFunctionCosine),
                        },
                    },
                },
                IndexingPolicy: &armcosmos.IndexingPolicy{
                    Automatic:    ptr(true),
                    IndexingMode: ptr(armcosmos.IndexingModeConsistent),
                    VectorIndexes: []*armcosmos.VectorIndex{
                        {Path: ptr("/embedding"), Type: ptr(armcosmos.VectorIndexTypeQuantizedFlat)},
                    },
                },
            },
            Options: &armcosmos.CreateUpdateOptions{
                Throughput: ptr(int32(400)),
            },
        },
    }, nil)
```

### Goal 2: Load configuration and generate embeddings

Configuration is loaded from environment variables using `godotenv`:

```go
cfg, err := LoadConfig()
if err != nil {
    log.Fatalf("configuration error: %v", err)
}
```

Go uses the Azure OpenAI REST API directly for embedding generation (no SDK dependency):

```go
// Acquire bearer token for Azure OpenAI
token, err := credential.GetToken(ctx, policy.TokenRequestOptions{
    Scopes: []string{"https://cognitiveservices.azure.com/.default"},
})

// POST to Azure OpenAI embeddings endpoint
request.Header.Set("Authorization", "Bearer "+token.Token)
resp, err := http.DefaultClient.Do(request)
```

### Insert documents concurrently

The sample fans out document inserts across up to 10 goroutines using a semaphore channel. HTTP 409 Conflict responses (duplicate IDs) are treated as safe-to-skip:

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

### Run vector similarity queries with different distance functions

After inserting documents, the sample generates a query embedding and executes **three separate** SQL queries with different distance functions. Each query passes the embedding as a parameterized value.

The vector query is scoped to a single partition by passing the partition key to `NewQueryItemsPager`. Azure Cosmos DB routes the request to the one physical partition that owns that region, so a `WHERE c.Region = ...` filter is unnecessary. This keeps the SQL focused on `ORDER BY VectorDistance(...)` for ranking and is the recommended, most efficient pattern for single-partition vector search.

```go
// Query with Cosine distance
queryText := fmt.Sprintf(`SELECT TOP 5
    c.HotelId, c.HotelName, c.Description,
    VectorDistance(c.embedding, @embedding, false, {'distanceFunction': 'Cosine'}) AS score
FROM c
ORDER BY VectorDistance(c.embedding, @embedding, false, {'distanceFunction': 'Cosine'})`)

options := azcosmos.QueryOptions{
    QueryParameters: []azcosmos.QueryParameter{{
        Name:  "@embedding",
        Value: json.RawMessage(embeddingJSON),
    }},
}

partitionKey := azcosmos.NewPartitionKey().AppendString(partitionKeyFieldValue)
pager := container.NewQueryItemsPager(queryText, partitionKey, &options)

// Repeat with 'DotProduct' and 'Euclidean' distance functions to compare rankings
```

## Example output

```output
Azure Cosmos DB vector index sample (Go)
database=Hotels primaryContainer=hotels_diskann_go vectorAlgorithm=diskann dataFile=.../data/HotelsData_toCosmosDB_Vector_byRegion.json
embeddingDeployment=text-embedding-3-small dimensions=1536 partitionKey=hotels

=== hotels_diskann_go ===
inserted=50 skipped=0 failed=0 total=50 writeRU=123.45
1. HotelId=12 | HotelName=Ocean Breeze Suites | score=0.0834 | Description=Modern waterfront hotel...
queryRU=3.21

=== hotels_quantizedflat_go ===
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
