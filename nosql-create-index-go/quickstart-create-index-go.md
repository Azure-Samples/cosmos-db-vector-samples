---
title: "Quickstart: Create and query vector indexes in Azure Cosmos DB for NoSQL using Go"
description: Create vector indexes in Azure Cosmos DB for NoSQL using Go and the ARM SDK. Load pre-vectorized hotel documents and compare vector distance functions (Cosine, DotProduct, Euclidean).
author: diberry
ms.author: diberry
ms.service: azure-cosmos-db
ms.topic: quickstart
ms.date: 2026-06-22
---

# Quickstart: Create vector index in Azure Cosmos DB for NoSQL using Go

In this quickstart, you run the Go create-index sample for Azure Cosmos DB for NoSQL to demonstrate two key goals:

- **Goal 1 (Control Plane):** Use the ARM SDK (armcosmos/v3) to create the `HotelsCreateIndex` database and two vector-indexed containers: `hotels_diskann_go` (DiskANN approximate search) and `hotels_quantizedflat_go` (QuantizedFlat uses vector quantization techniques).
- **Goal 2 (Distance Functions):** Compare how the same query embedding produces different scores and rankings when using different vector distance functions: Cosine, DotProduct, and Euclidean.

## Prerequisites

- An Azure subscription. [Create a free account](https://azure.microsoft.com/free/).
- [Azure CLI](/cli/azure/install-azure-cli) installed and signed in (`az login`).
- [Go 1.23 or later](https://go.dev/dl/) installed.
- An Azure Cosmos DB for NoSQL account with vector search enabled.
- Microsoft Entra ID roles for your identity:
  - Management-plane permission to create and delete SQL databases and containers in the Azure Cosmos DB account
  - **Cosmos DB Built-in Data Contributor** on the Azure Cosmos DB account
  - **Cognitive Services OpenAI User** on the Azure OpenAI resource
- An Azure OpenAI resource with a `text-embedding-3-small` deployment.
- To enable infrastructure provisioning for the create-index scenario, set `AZURE_COSMOSDB_CREATE_INDEX_DATABASE_NAME=HotelsCreateIndex` before running `azd up`. The infrastructure creates both the `Hotels` (vector search) and `HotelsCreateIndex` (create-index) databases.

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
>    - Inserts them sequentially using Region-based partition keys
>    - Generates a query embedding with Azure OpenAI
>    - Runs `VectorDistance()` queries with three distance functions: **Cosine**, **DotProduct**, and **Euclidean**
>    - Displays rankings for each distance function to show how results differ

## Clone the repository

```bash
git clone https://github.com/Azure-Samples/cosmos-db-vector-samples.git
cd cosmos-db-vector-samples/nosql-create-index-go
```

## Set up the data file

The sample requires `HotelsData_toCosmosDB_Vector_byRegion.json`. The repository includes the shared file at `../data/HotelsData_toCosmosDB_Vector_byRegion.json` relative to this sample directory, which matches the `DATA_FILE_WITH_VECTORS_AND_REGIONS` value shown in the environment-variable block.

The code resolves relative paths from the current working directory and the sample directory. If you use a different file location, set `DATA_FILE_WITH_VECTORS_AND_REGIONS` to that path before running the sample.

## Configure environment variables

Configure environment variables. The Go code calls `os.Getenv` directly and doesn't load `.env` files automatically. If you create a `.env` file from `azd` or `.env.example`, export or set the values in your shell before running `go run .`.

**If you deployed with `azd up`:**

```bash
azd env get-values > .env
```

**Otherwise**, copy the template and fill in values from the Azure portal:

```bash
cp .env.example .env
```

The code requires these environment variable names:

```dotenv
AZURE_COSMOSDB_ENDPOINT=https://YOUR-COSMOS-ACCOUNT.documents.azure.com:443/
AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME=HotelsCreateIndex
AZURE_COSMOSDB_CONTAINER_NAME=
AZURE_OPENAI_EMBEDDING_ENDPOINT=https://YOUR-AOAI-RESOURCE.openai.azure.com/
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=text-embedding-3-small
VECTOR_ALGORITHM=
AZURE_COSMOSDB_CREATE_INDEX_EMBEDDED_FIELD=embedding
DATA_FILE_WITH_VECTORS_AND_REGIONS=../data/HotelsData_toCosmosDB_Vector_byRegion.json
AZURE_SUBSCRIPTION_ID=YOUR-SUBSCRIPTION-ID
AZURE_RESOURCE_GROUP=YOUR-RESOURCE-GROUP
AZURE_COSMOSDB_ACCOUNT_NAME=YOUR-COSMOS-ACCOUNT-NAME
AZURE_LOCATION=YOUR-AZURE-REGION
```

Set `VECTOR_ALGORITHM` to `diskann`, `quantizedflat`, or leave it empty to run against both containers. When `AZURE_COSMOSDB_CONTAINER_NAME` and `VECTOR_ALGORITHM` are both empty, the sample iterates over both known containers (`hotels_diskann_go` and `hotels_quantizedflat_go`).

## Install dependencies and run

Download Go module dependencies:

```bash
go mod download
```

Export the variables and run the sample. The command `go run .` is valid because this directory contains `package main` and `main.go`.

```bash
export $(grep -v '^#' .env | xargs)
go run .
```

For PowerShell:

```powershell
Get-Content .env | Where-Object { $_ -match '^[^#].*=' } | ForEach-Object { $k,$v = $_ -split '=',2; [Environment]::SetEnvironmentVariable($k.Trim(), $v.Trim()) }
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
3. Reads the configured `DATA_FILE_WITH_VECTORS_AND_REGIONS` file and prepares documents
4. Generates a query embedding by calling the Azure OpenAI REST API
5. For each target container:
   - Inserts documents sequentially (`maxInsertConcurrency = 1`) using `CreateItem`
   - Runs **three separate** `VectorDistance()` SQL queries with different distance functions:
     - **Cosine:** Measures angle between vectors (values: 0 to 2)
     - **DotProduct:** Inner product of vectors (values: any real number)
     - **Euclidean:** Straight-line distance between vectors (values: 0 to √6144)
   - Prints the top 5 matching hotels for each distance function, showing how rankings differ

**Cleanup:**
1. Deletes both vector-indexed containers with the ARM SDK
2. Prints `Complete`

## Understand the project structure

```text
nosql-create-index-go/
├── .env.example
├── README.md
├── go.mod
├── go.sum
├── config.go
├── config_test.go
├── controlplane.go
├── dataplane.go
├── main.go
├── data/
│   └── HotelsData_toCosmosDB_Vector_byRegion.json
├── output/
│   └── sample-output.txt
└── tests/
    └── config_test.go
```

| File | Purpose |
|------|---------|
| `config.go` | Loads and validates environment variables. |
| `controlplane.go` | Creates the database and vector-indexed containers, verifies index settings, and deletes containers during cleanup. |
| `dataplane.go` | Implements document ingestion, embedding generation, and vector queries. |
| `main.go` | Entry point; orchestrates configuration, ingestion, and queries. |
| `go.mod` | Module definition; declares Azure identity, data plane, and ARM SDK dependencies. |

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

Configuration is loaded from process environment variables using `os.Getenv`:

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

### Insert documents sequentially

The sample inserts documents sequentially because `maxInsertConcurrency` is set to `1`. HTTP 409 Conflict responses (duplicate IDs) are treated as safe-to-skip:

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
✓ Region validation passed. Found regions: Midwest, Northeast, South, West
  Region 'Northeast': 10 documents
  Region 'Midwest': 10 documents
  Region 'South': 14 documents
  Region 'West': 16 documents
Using Azure OpenAI Embedding Deployment/Model: text-embedding-3-small
Reading JSON file from C:\project-dina-data-ai\repos\cosmos-db-vector-samples-2\nosql-create-index-go\data\HotelsData_toCosmosDB_Vector_byRegion.json
Loaded 50 documents

=== Phase 1: Create Database ===
  Database: HotelsCreateIndex
  ✓ Database created or already exists

=== Creating Container: hotels_diskann_go ===
  Index type:     diskANN
  Embedding path: /embedding
  Dimensions:     1536
  Distance func:  cosine (queried with all 3 metrics)
  Cleaning up existing container...
  Deleted existing container
  Creating container with vector index...
  ✓ Container created in 6.61s

=== Creating Container: hotels_quantizedflat_go ===
  Index type:     quantizedFlat
  Embedding path: /embedding
  Dimensions:     1536
  Distance func:  cosine (queried with all 3 metrics)
  Cleaning up existing container...
  Deleted existing container
  Creating container with vector index...
  ✓ Container created in 6.16s

✓ All containers created successfully
Processing in batches of 50...
  ✓ hotels_diskann_go: 50 inserted (5243.74 RUs)
  ✓ Verified: 10 documents in partition 'Northeast'
  ✓ hotels_quantizedflat_go: 50 inserted (2621.83 RUs)
  ✓ Verified: 10 documents in partition 'Northeast'

⏳ Waiting 5 seconds for index stabilization...

Query: "hotel near the ocean"
Embedding generated (1536 dimensions)

Running search (top 5 results for each distance function)...
  ✓ hotels_diskann_go queried (3.65 RUs)
  ✓ hotels_diskann_go queried (3.65 RUs)
  ✓ hotels_diskann_go queried (3.65 RUs)
  ✓ hotels_quantizedflat_go queried (3.65 RUs)
  ✓ hotels_quantizedflat_go queried (3.65 RUs)
  ✓ hotels_quantizedflat_go queried (3.65 RUs)

| Container            | Metric     | Top 1 Result               | Score  | Top 2 Result               | Score  | Diff   |
|----------------------|------------|----------------------------|--------|----------------------------|--------|--------|
| hotels_diskann_go    | Cosine     | City Center Summer Wind... | 0.4025 | Red Tide Hotel             | 0.4000 | 0.0025 |
| hotels_diskann_go    | DotProduct | City Center Summer Wind... | 0.4027 | Red Tide Hotel             | 0.4001 | 0.0025 |
| hotels_diskann_go    | Euclidean  | City Center Summer Wind... | 1.0934 | Red Tide Hotel             | 1.0957 | -0.0023 |
| hotels_quantizedf... | Cosine     | City Center Summer Wind... | 0.4025 | Red Tide Hotel             | 0.4000 | 0.0025 |
| hotels_quantizedf... | DotProduct | City Center Summer Wind... | 0.4027 | Red Tide Hotel             | 0.4001 | 0.0025 |
| hotels_quantizedf... | Euclidean  | City Center Summer Wind... | 1.0934 | Red Tide Hotel             | 1.0957 | -0.0023 |

=== Phase 4: Cleanup ===
  ✓ Deleted hotels_diskann_go
  ✓ Deleted hotels_quantizedflat_go

Complete
```

A full recorded run is saved in `output/sample-output.txt`.

## Troubleshooting

| Issue | Resolution |
|-------|-----------|
| `configuration error: missing required environment variables` | Verify all required variables are exported in your shell. The code doesn't auto-load `.env`; run `cp .env.example .env`, fill in the values, and export or set them before `go run .`. |
| `failed to create Azure Cosmos DB client` / 403 Forbidden | Confirm your identity has the **Cosmos DB Built-in Data Contributor** role. RBAC propagation can take several minutes after assignment. |
| `failed to insert N documents` | One or more concurrent inserts failed. Check container throughput settings and confirm each document is under 2 MB. |
| `embedding dimensions mismatch: got X, expected 1536` | The deployment returns a different vector size than expected. Verify you're using `text-embedding-3-small` without dimension truncation. |
| `get Azure OpenAI bearer token: ... 401` | Confirm your identity has the **Cognitive Services OpenAI User** role on the Azure OpenAI resource. |

## Next steps

- Review a recorded run in `output/sample-output.txt`.
- Set `VECTOR_ALGORITHM=diskann` or `VECTOR_ALGORITHM=quantizedflat` to focus on a single container.
- Learn more about [Azure Cosmos DB vector search](/azure/cosmos-db/nosql/vector-search).
