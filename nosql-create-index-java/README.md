# Azure Cosmos DB for NoSQL create-index sample with Java

This sample shows how to recreate vector-indexed Azure Cosmos DB for NoSQL containers, load pre-vectorized hotel documents, run vector similarity queries, and clean up the sample containers with Java.

It uses:
- `DefaultAzureCredential` for Azure Cosmos DB and the Azure OpenAI client
- an existing `HotelsCreateIndex` database created before running the sample
- the local `.\data\HotelsData_toCosmosDB_Vector_byRegion.json` dataset
- ARM SDK container creation and bulk upsert operations for `hotels_diskann` and `hotels_quantizedflat`
- `VectorDistance()` SQL queries for similarity search
- cleanup that deletes both sample containers

> [!IMPORTANT]
> This sample uses control-plane APIs to delete and recreate the sample containers
> with vector indexes. Bicep creates the configured database during `azd up` or
> `azd provision`; the Java sample never creates or deletes the database.

## Prerequisites

- Java 17 LTS or later
- Maven 3.9 or later
- Azure CLI installed and signed in with `az login`
- Azure resources already provisioned by `azd up`
- Microsoft Entra ID roles:
  - **Cosmos DB Built-in Data Contributor**
  - **Cognitive Services OpenAI User**

The sample expects the `HotelsCreateIndex` database to exist. It deletes and recreates these sample containers:
- `hotels_diskann`
- `hotels_quantizedflat`

## Set up the sample

1. Create the environment variables file.

   **If you deployed with `azd up`:**

   ```powershell
   azd env get-values > .env
   ```

   **Otherwise**, copy the template and fill in values from the Azure portal:

   ```powershell
   Copy-Item .env.example .env
   ```

   The `.env.example` file contains only the required settings for this sample. Add your subscription, resource group, account, Cosmos DB, and Azure OpenAI values to the copied `.env` file. Java reads process environment variables and does not load `.env` automatically, so export or set the values before running Maven.

2. Set up the data directory.

   ```powershell
   New-Item -ItemType Directory -Force .\data
   Copy-Item ..\HotelsData_toCosmosDB_Vector_byRegion.json .\data\
   ```

3. Build the project.

   ```powershell
   mvn compile
   ```

## Load environment variables and run the sample

**⚠️ Important:** Environment variables MUST be loaded in your current session BEFORE running the sample. They are not passed via the `azd` command—they are read by `src/main/java/com/azure/cosmos/createindex/App.java` at runtime.

| Action | PowerShell | Bash |
|--------|-----------|------|
| Load from `.env` file | `Get-Content .env \| ForEach-Object { if ($_ -match "^([^=]+)=(.*)$") { [Environment]::SetEnvironmentVariable($matches[1], $matches[2]) } }` | `export $(grep -v "^#" .env \| xargs)` |
| Set single variable | `[Environment]::SetEnvironmentVariable("AZURE_COSMOSDB_ENDPOINT", "https://your-account.documents.azure.com:443/")` | `export AZURE_COSMOSDB_ENDPOINT="https://your-account.documents.azure.com:443/"` |

**Required environment variables for control plane operations** (creating and deleting containers with ARM SDK):
- `AZURE_SUBSCRIPTION_ID` — Your Azure subscription ID
- `AZURE_RESOURCE_GROUP` — Your Azure resource group name
- `AZURE_COSMOSDB_ACCOUNT_NAME` — Your Cosmos DB account name
- `AZURE_LOCATION` — Azure region where resources are deployed

**Required environment variables for data plane operations** (querying and inserting data):
- `AZURE_COSMOSDB_ENDPOINT` — Cosmos DB endpoint URL
- `AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME` — Database name (e.g., "HotelsCreateIndex")
- `AZURE_OPENAI_EMBEDDING_ENDPOINT` — Azure OpenAI endpoint URL
- `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` — Deployment name (e.g., "text-embedding-3-small")

**⚠️ Control Plane Requirement:** This sample uses the Azure Resource Manager (ARM) SDK to create and delete containers at runtime. All ARM SDK environment variables above (subscription ID, resource group, account name, location) MUST be set before running the sample. No defaults are provided for these values.

**Optional environment variables:**
- `VECTOR_ALGORITHM` — "diskann" or "quantizedflat"; leave empty to run **both** containers
- `AZURE_COSMOSDB_CONTAINER_NAME` — Target container by name; leave empty to process all
- `AZURE_COSMOSDB_CREATE_INDEX_DISKANN_CONTAINER_NAME` — Custom diskANN container name (default: "hotels_diskann")
- `AZURE_COSMOSDB_CREATE_INDEX_QUANTIZEDFLAT_CONTAINER_NAME` — Custom quantizedFlat container name (default: "hotels_quantizedflat")
- `AZURE_COSMOSDB_CREATE_INDEX_ALLOW_DESTRUCTIVE_OPERATIONS` — Set to `true` only when custom container names are intentional and safe to delete

**Then run the sample:**

```powershell
mvn exec:java
```

### Note about SLF4J logging

The sample includes the `slf4j-nop` runtime dependency so Azure SDK internal logs are suppressed by default. You shouldn't see the `StaticLoggerBinder` warning when you run `mvn exec:java`. If you remove `slf4j-nop` and don't add another SLF4J backend, that warning can appear. To see SDK logs, replace `slf4j-nop` with an SLF4J binding such as `slf4j-simple` or `logback-classic`.

Examples:

```powershell
# Run both containers (default)
mvn exec:java

# Run only DiskANN
$env:VECTOR_ALGORITHM = 'diskann'
mvn exec:java

# Run only QuantizedFlat
$env:VECTOR_ALGORITHM = 'quantizedflat'
mvn exec:java
```

## Expected output

The sample prints:
- configuration and target container selection
- embedding dimension verification for `text-embedding-3-small`
- bulk ingestion status for each container
- top vector matches from each queried container
- cleanup status after deleting both sample containers

See `output/sample-output.txt` for example console output.

## Project structure

```text
nosql-create-index-java/
├── .env.example
├── output/
│   └── sample-output.txt
├── pom.xml
├── README.md
└── src/main/java/com/azure/cosmos/createindex/
    ├── App.java
    ├── Config.java
    ├── ControlPlane.java
    └── DataPlane.java
```

## Authentication and permissions

All Azure clients use `DefaultAzureCredential`. For local runs, sign in with `az login` or `azd auth login`. Hosted execution can use managed identity. The selected identity needs management-plane permission to create and delete the two configured containers, Cosmos DB data-plane access to insert and query documents, and the Cognitive Services OpenAI User role. Keys and connection strings aren't supported.

## Validate and clean generated artifacts

From the repository root, validate this sample with the shared validator:

```powershell
pwsh -NoProfile -File .github\skills\sample-validate-nosql-create-index\scripts\validate-create-index-samples.ps1 -Language Java
```

Preview and then remove generated local artifacts:

```powershell
pwsh -NoProfile -File .github\scripts\clean-all-create-index.ps1 -Language Java -WhatIf
pwsh -NoProfile -File .github\scripts\clean-all-create-index.ps1 -Language Java
```
