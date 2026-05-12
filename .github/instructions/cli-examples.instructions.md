---
applyTo: "nosql-*/**"
---
# Running Samples — CLI Invocation (Cosmos DB NoSQL Vector Search)

Environment variables are loaded from a `.env` file in each sample directory. Run `azd up` first to provision infrastructure — the CLI commands below only run data-plane application code.

## Prerequisites

```bash
# 1. Deploy infrastructure (creates account, database, 2 containers with vector policies, RBAC)
azd up

# 2. Copy and populate the .env file in the sample directory
cp sample.env .env
# Edit .env with values from your azd deployment
```

Infrastructure is provisioned once. Both containers (`hotels_diskann`, `hotels_quantizedflat`) persist across runs.

## Environment Variables

Create a `.env` file in the sample directory with these variables:

| Variable | Purpose | Example |
|----------|---------|---------|
| `AZURE_COSMOSDB_ENDPOINT` | Cosmos DB account endpoint | `https://myaccount.documents.azure.com:443/` |
| `AZURE_COSMOSDB_DATABASENAME` | Database name | `Hotels` |
| `AZURE_OPENAI_EMBEDDING_ENDPOINT` | Azure OpenAI endpoint | `https://myoai.openai.azure.com/` |
| `AZURE_OPENAI_EMBEDDING_MODEL` | Embedding model name | `text-embedding-3-small` |
| `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | Embedding deployment name | `text-embedding-3-small` |
| `AZURE_OPENAI_EMBEDDING_API_VERSION` | API version | `2024-08-01-preview` |
| `DATA_FILE_WITH_VECTORS` | Path to pre-embedded data JSON | `../data/HotelsData_toCosmosDB_Vector.json` |
| `DATA_FILE_WITHOUT_VECTORS` | Path to raw data JSON | `../data/HotelsData_toCosmosDB.JSON` |
| `EMBEDDED_FIELD` | Vector field name | `DescriptionVector` |
| `EMBEDDING_DIMENSIONS` | Vector dimensions | `1536` |
| `VECTOR_ALGORITHM` | Algorithm to use | `diskann` or `quantizedflat` |
| `VECTOR_DISTANCE_FUNCTION` | Distance function | `cosine`, `euclidean`, or `dotproduct` |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID | Set by `azd env get-values` |
| `AZURE_TENANT_ID` | Azure AD tenant ID | Set by `azd env get-values` |
| `AZURE_RESOURCE_GROUP` | Resource group name | Set by `azd env get-values` |
| `AZURE_ENV_NAME` | azd environment name | Set by `azd env get-values` |
| `AZURE_LOCATION` | Azure region | Set by `azd env get-values` |
| `AZURE_OPENAI_SERVICE` | Azure OpenAI service name | Set by `azd env get-values` |

## SDK Packages per Language

| Language | Cosmos DB SDK | Azure OpenAI SDK |
|----------|--------------|-----------------|
| TypeScript | `@azure/cosmos` (v4.5+) | `openai` (v5+) |
| .NET | `Microsoft.Azure.Cosmos` | `Azure.AI.OpenAI` |
| Python | `azure-cosmos` | `openai` (v1.57+, NOT v5) |
| Java | `com.azure:azure-cosmos` | `com.azure:azure-ai-openai` |
| Go | `github.com/Azure/azure-sdk-for-go/sdk/data/azcosmos` | `github.com/Azure/azure-sdk-for-go/sdk/ai/azopenai` (v0.7.1) |

## TypeScript / Node.js

```bash
# Install dependencies
npm install

# Build
npm run build

# Run with diskANN container
npm run start:diskann

# Run with quantizedFlat container
npm run start:quantizedflat

# Clean up inserted documents
npm run delete:all
```

The `.env` file is loaded natively via `node --env-file .env` (Node.js 20+). No `dotenv` package needed.

### ESM Module Pattern

TypeScript samples use ESM (`"type": "module"` in `package.json`):
- Requires `.js` extensions in import paths (even for `.ts` source files)
- Uses `import.meta.url` for `__dirname` equivalent
- Requires Node.js 20+

## Python

```bash
# Install dependencies
pip install -r requirements.txt

# Run sample (set env vars before running, or use shell export)
python src/vector_search.py

# Clean up inserted documents
python src/delete_all.py
```

Set `VECTOR_ALGORITHM=diskann` or `VECTOR_ALGORITHM=quantizedflat` as an environment variable (or in `.env` and load via `export $(cat .env | xargs)`) to select the container. Do NOT use `python-dotenv` — use `os.environ` to read env vars.

## Go

```bash
# Run sample (pass env vars at invocation, or source .env first)
# Example: source .env && go run ./cmd/vector-search/...
go run ./cmd/vector-search/...
```

Set `VECTOR_ALGORITHM` as an environment variable before running. Go uses `os.Getenv()` — no dotenv package needed.

## Java

```bash
# Compile and run (env vars passed via shell or system properties)
mvn compile exec:java
```

Configure `VECTOR_ALGORITHM` as an environment variable or system property to select `hotels_diskann` or `hotels_quantizedflat`.

## .NET

```bash
# Run sample (reads appsettings.json + env var overrides)
dotnet run
```

Set overrides as environment variables. `appsettings.json` holds defaults; env vars take precedence. Do NOT use a dotenv package — .NET uses `appsettings.json` natively.

## Loading Variables from `azd` Environment

If you've already run `azd up`, values are available directly from the azd environment:

**Bash:**
```bash
# Load all variables from azd environment
eval $(azd env get-values)

# Then run (TypeScript example)
npm run start:diskann
```

**PowerShell:**
```powershell
# Load all variables from azd environment
azd env get-values | ForEach-Object {
    $parts = $_ -split '=', 2
    [Environment]::SetEnvironmentVariable($parts[0], $parts[1].Trim('"'))
}

# Then run (TypeScript example)
npm run start:diskann
```

## Expected Output

Samples print results per container:

```
--- Vector Search: hotels_diskann ---
Query: "luxury hotel with ocean view"
Results:
  HotelName: Grand Resort & Spa | Rating: 4.8 | SimilarityScore: 0.8234
  HotelName: Oceanview Lodge | Rating: 4.5 | SimilarityScore: 0.7891
  ...

--- Vector Search: hotels_quantizedflat ---
Query: "luxury hotel with ocean view"
Results:
  HotelName: Grand Resort & Spa | Rating: 4.8 | SimilarityScore: 0.8234
  HotelName: Oceanview Lodge | Rating: 4.5 | SimilarityScore: 0.7891
  ...
```

Scores should be consistent between algorithms for the same query (ranking may vary slightly due to approximation).

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `401 Unauthorized` | RBAC not assigned | Run `azd up` or assign custom "Write to Azure Cosmos DB for NoSQL data plane" role |
| `Container not found` | Infrastructure not provisioned | Run `azd up` first |
| `disableKeyBasedAuth` error | Using connection string | Use `DefaultAzureCredential` — key auth is disabled |
| Missing module / package not found | Dependencies not installed | Run `npm install` / `pip install -r requirements.txt` / `mvn install` |
| Wrong dimensions error | Mismatched embedding model | Check `EMBEDDING_DIMENSIONS` matches model output (default: `1536`) |
| `.env` not found | Missing config file | Copy `sample.env` to `.env` and populate values |
