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

## Getting Started

### 1. Configure environment variables

If you provisioned resources with Azure Developer CLI (`azd`), generate your `.env` file from the deployed environment:

**Bash:**

```bash
azd env get-values > .env
```

**PowerShell:**

```powershell
azd env get-values > .env
```

Otherwise, copy the template and fill in your Azure resource values manually:

**Bash:**

```bash
cp .env.example .env
```

**PowerShell:**

```powershell
Copy-Item .env.example .env
```

Then load the variables into your shell:

**Bash:**

```bash
set -a && source .env && set +a
```

**PowerShell:**

```powershell
Get-Content .env | ForEach-Object {
  if ($_ -match '^\s*([^#][^=]*)=(.*)$') {
    $name = $matches[1].Trim()
    $value = $matches[2].Trim().Trim('"')
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }
}
```

### 2. Build the project

**Bash:**

```bash
mvn compile
```

**PowerShell:**

```powershell
mvn compile
```

### 3. Run the sample

**Bash:**

```bash
# Both containers (default)
unset VECTOR_ALGORITHM
mvn exec:java

# DiskANN only
export VECTOR_ALGORITHM=diskann
mvn exec:java

# QuantizedFlat only
export VECTOR_ALGORITHM=quantizedflat
mvn exec:java
```

**PowerShell:**

```powershell
# Both containers (default)
Remove-Item Env:VECTOR_ALGORITHM -ErrorAction SilentlyContinue
mvn exec:java

# DiskANN only
$env:VECTOR_ALGORITHM = 'diskann'
mvn exec:java

# QuantizedFlat only
$env:VECTOR_ALGORITHM = 'quantizedflat'
mvn exec:java
```

## Environment variables

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

### Note about SLF4J logging

The sample includes the `slf4j-nop` runtime dependency so Azure SDK internal logs are suppressed by default. You shouldn't see the `StaticLoggerBinder` warning when you run `mvn exec:java`. If you remove `slf4j-nop` and don't add another SLF4J backend, that warning can appear. To see SDK logs, replace `slf4j-nop` with an SLF4J binding such as `slf4j-simple` or `logback-classic`.

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
