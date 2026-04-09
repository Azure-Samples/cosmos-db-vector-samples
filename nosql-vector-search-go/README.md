<!--
---
page_type: sample
name: "Cosmos DB NoSQL Vector Search for Go"
description: "This sample demonstrates vector search capabilities using Azure Cosmos DB NoSQL with Go. It includes two vector index algorithms: DiskANN and QuantizedFlat, with passwordless authentication."
urlFragment: nosql-vector-search-go
languages:
- go
products:
- azure-cosmos-db
---
-->
# Azure Cosmos DB NoSQL Vector Search (Go)

This sample demonstrates vector search using **Azure Cosmos DB NoSQL** (SQL API) with the Go SDK. It loads hotel data with pre-computed embeddings, inserts them into a Cosmos DB container, generates an embedding for a search query via Azure OpenAI, and retrieves the most similar hotels using the `VectorDistance()` SQL function.

## Features

- **Two algorithms:** DiskANN and QuantizedFlat (selectable via environment variable)
- **Passwordless auth:** Uses `DefaultAzureCredential` for both Cosmos DB and Azure OpenAI
- **SQL API:** Queries use the `VectorDistance()` function — not MongoDB `$search`
- **Parameterized queries** with field-name validation to prevent injection
- **Request-unit (RU) tracking** for inserts and queries

## Prerequisites

| Requirement | Version |
|---|---|
| **Go** | 1.22 or higher |
| **Azure CLI** | Latest (`az login` for DefaultAzureCredential) |
| **Azure subscription** | With Cosmos DB and OpenAI access |

### Azure Resources

1. **Azure Cosmos DB NoSQL account** with:
   - A database named `Hotels`
   - Containers: `hotels_diskann` and/or `hotels_quantizedflat` with partition key on `/HotelId` and a vector index configured
2. **Azure OpenAI resource** with an embedding model deployment (e.g., `text-embedding-3-small`)

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/Azure-Samples/cosmos-db-vector-samples.git
cd cosmos-db-vector-samples/nosql-vector-search-go
```

### 2. Install dependencies

```bash
go mod tidy
go mod download
```

### 3. Configure environment

If you provisioned resources with Azure Developer CLI (`azd`), generate your `.env` file from the deployed environment:

```bash
azd env get-values > .env
```

Otherwise, copy the template and fill in your Azure resource values manually:

```bash
cp sample.env .env
```

At minimum set:

| Variable | Description |
|---|---|
| `AZURE_COSMOSDB_ENDPOINT` | Cosmos DB NoSQL endpoint |
| `AZURE_OPENAI_EMBEDDING_ENDPOINT` | Azure OpenAI endpoint |
| `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | Embedding model deployment name |
| `VECTOR_ALGORITHM` | `diskann` or `quantizedflat` |

### 4. Authenticate

```bash
az login
```

This enables `DefaultAzureCredential` used by the sample.

## Run the sample

```bash
# Run with DiskANN (default)
go run ./cmd/vector-search/

# Run with QuantizedFlat
VECTOR_ALGORITHM=quantizedflat go run ./cmd/vector-search/
```

On Windows PowerShell:
```powershell
$env:VECTOR_ALGORITHM="quantizedflat"
go run ./cmd/vector-search/
```

### Build (optional)

```bash
go build -o bin/vector-search ./cmd/vector-search/
./bin/vector-search
```

## How it works

1. **Configuration** — Environment variables are loaded from `.env` (via godotenv) and validated.
2. **Authentication** — `DefaultAzureCredential` authenticates to both Cosmos DB and Azure OpenAI.
3. **Data loading** — Hotel documents (with pre-computed 1536-dimension vectors) are read from the shared data file.
4. **Insert** — Documents are inserted item-by-item into the selected container. If the container already has data, insertion is skipped.
5. **Embedding** — A search query is sent to Azure OpenAI to produce an embedding vector.
6. **Vector search** — A `VectorDistance()` SQL query finds the 5 most similar hotels and prints results with similarity scores.

## Code structure

```
nosql-vector-search-go/
├── cmd/vector-search/main.go      # Entry point — orchestrates the workflow
├── internal/
│   ├── config/config.go           # Environment parsing and validation
│   ├── client/clients.go          # Azure client initialization
│   ├── data/loader.go             # JSON loading and Cosmos DB insertion
│   └── query/vector_search.go     # Vector search query and result formatting
├── go.mod                         # Module dependencies
├── sample.env                     # Environment variable template
└── README.md                      # This file
```

## Deployment prerequisites (quota and regions)

Before running `azd up`, make sure your Azure subscription has sufficient quota for the models this template deploys.

### Models and quota

| Model | Deployment type | Capacity (TPM) | Purpose |
|---|---|---|---|
| `text-embedding-3-small` | **Standard** | 10 K | Generate 1536-dimension embeddings |
| `gpt-4.1-mini` | **Standard** | 50 K | Chat completion (optional) |

You need available **Azure OpenAI** quota for both models in the target region. Quota is per-subscription, per-region, per-model.

### Supported regions

The Bicep template restricts deployment to regions that support both models:

- **eastus2**
- **swedencentral**

If neither region works for your subscription, you can edit `infra/main.bicep` and add another region to the `@allowed` list — verify model availability in the [Azure OpenAI models documentation](https://learn.microsoft.com/azure/ai-services/openai/concepts/models).

### Common deployment errors

If `azd up` fails with quota-related errors, look for messages like:

```
InsufficientQuota: The specified capacity '10' for deployment
'text-embedding-3-small' with model 'text-embedding-3-small' using sku
'Standard' is not available. ...
```

```
InvalidTemplateDeployment: The template deployment failed because of an
inner error: "InsufficientQuota" ...
```

### How to fix quota errors

1. **Try a different region** — re-run `azd up` and choose the other allowed region (`eastus2` or `swedencentral`).
2. **Change the deployment SKU** — in `infra/main.bicep`, swap `'Standard'` to `'GlobalStandard'` (or vice versa) for the embedding model.
3. **Request a quota increase** — in the Azure Portal, go to **Subscriptions → Resource providers → Microsoft.CognitiveServices → Quotas** and request more capacity for the model in your target region.

## Troubleshooting

| Problem | Solution |
|---|---|
| `missing required environment variables` | Copy `sample.env` to `.env` and fill in values |
| `failed to create DefaultAzureCredential` | Run `az login` to authenticate |
| `Container already has N documents` | Data was already inserted; this is expected behavior |
| 404 on container | Ensure the Cosmos DB database and container exist with the correct names |
| Cross-partition query error | This sample uses a single partition key value; see [Known Limitations](#known-limitations) |
| `InsufficientQuota` during `azd up` | See [Deployment prerequisites](#deployment-prerequisites-quota-and-regions) above |

## Known Limitations

### Single partition key for Go SDK

The Go [`azcosmos`](https://pkg.go.dev/github.com/Azure/azure-sdk-for-go/sdk/data/azcosmos) SDK does not currently support `TOP` and `ORDER BY` clauses in cross-partition queries (see [`NewQueryItemsPager` docs](https://pkg.go.dev/github.com/Azure/azure-sdk-for-go/sdk/data/azcosmos#ContainerClient.NewQueryItemsPager)). Because `VectorDistance` queries typically require `TOP N ... ORDER BY`, this sample inserts **all hotel documents with a single constant partition key value** (`"hotels"`) so that every query runs within a single logical partition.

**What this means:**

- All 50 hotel documents share the partition key value `"hotels"` (the `HotelId` field is set to `"hotels"` for all documents)
- The unique document identity is preserved in the `id` field
- No cross-partition queries are needed, so `TOP` + `ORDER BY` work correctly
- If other language samples (Python, Java, TypeScript) insert into the same container with per-hotel partition keys, the Go documents coexist in their own partition

**This is a temporary workaround.** It will be revisited when the Go SDK adds full cross-partition query support.

## Resources

- [Azure Cosmos DB NoSQL Vector Search](https://learn.microsoft.com/azure/cosmos-db/nosql/vector-search)
- [azcosmos Go SDK](https://pkg.go.dev/github.com/Azure/azure-sdk-for-go/sdk/data/azcosmos)
- [azidentity Go SDK](https://pkg.go.dev/github.com/Azure/azure-sdk-for-go/sdk/azidentity)
- [azopenai Go SDK](https://pkg.go.dev/github.com/Azure/azure-sdk-for-go/sdk/ai/azopenai)
- [Go Best Practices](https://go.dev/doc/effective_go)
