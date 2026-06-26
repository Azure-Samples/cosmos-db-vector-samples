# Azure Cosmos DB for NoSQL create-index sample with Java

This sample shows how to recreate vector-indexed Azure Cosmos DB for NoSQL containers, load pre-vectorized hotel documents, run vector similarity queries, and clean up the sample containers with Java.

It uses:
- `DefaultAzureCredential` for Azure Cosmos DB and the Azure OpenAI client
- an existing `HotelsCreateIndex` database created before running the sample
- the local `.\data\HotelsData_toCosmosDB_Vector_byRegion.json` dataset
- ARM SDK container creation and bulk upsert operations for `hotels_diskann_java` and `hotels_quantizedflat_java`
- `VectorDistance()` SQL queries for similarity search
- cleanup that deletes both sample containers

> [!IMPORTANT]
> This sample uses control-plane APIs to delete and recreate the sample containers with vector indexes. It assumes the `HotelsCreateIndex` database already exists; run `azd up` from the repo root or create the database before running this sample.

## Prerequisites

- Java 17 LTS or later
- Maven 3.9 or later
- Azure CLI installed and signed in with `az login`
- Azure resources already provisioned by `azd up`
- Microsoft Entra ID roles:
  - **Cosmos DB Built-in Data Contributor**
  - **Cognitive Services OpenAI User**

The sample expects the `HotelsCreateIndex` database to exist. It deletes and recreates these sample containers:
- `hotels_diskann_java`
- `hotels_quantizedflat_java`

## Set up the sample

1. Populate environment variables.

   **If you deployed with `azd up`:**

   ```powershell
   azd env get-values > .env
   ```

   **Otherwise**, copy the template and fill in values from the Azure portal:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Verify `.env` has the required Azure resource, Azure Cosmos DB, and Azure OpenAI settings.

   ```dotenv
   AZURE_SUBSCRIPTION_ID="<your-subscription-id>"
   AZURE_RESOURCE_GROUP="<your-resource-group>"
   AZURE_COSMOSDB_ACCOUNT_NAME="<your-account-name>"
   AZURE_LOCATION="<your-account-location>"
   AZURE_COSMOSDB_ENDPOINT="https://<your-account>.documents.azure.com:443/"
   AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME="HotelsCreateIndex"
   AZURE_OPENAI_EMBEDDING_ENDPOINT="https://<your-openai-resource>.openai.azure.com/"
   AZURE_OPENAI_EMBEDDING_DEPLOYMENT="text-embedding-3-small"
   ```

   Notes:
   - The code reads `AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME` for the database name.
   - Leave `AZURE_COSMOSDB_CONTAINER_NAME` empty to run all supported containers.
   - Leave `VECTOR_ALGORITHM` empty to run both algorithms.
   - Set `VECTOR_ALGORITHM` to `diskann` or `quantizedflat` to run one algorithm.
   - Set `AZURE_COSMOSDB_CONTAINER_NAME` only if you want to target one container directly.

3. Set up the data directory.

   ```powershell
   New-Item -ItemType Directory -Force .\data
   Copy-Item ..\HotelsData_toCosmosDB_Vector_byRegion.json .\data\
   ```

4. Build the project.

   ```powershell
   mvn compile
   ```

## Run the sample

**Load environment variables from `.env` first:**

```powershell
# PowerShell (strips quotes from values)
Get-Content .env | Where-Object { $_ -match '^[^#].*=' } | ForEach-Object { $k,$v = $_ -split '=',2; [Environment]::SetEnvironmentVariable($k.Trim(), $v.Trim().Trim('"').Trim("'")) }
```

```bash
# Bash/Linux/Mac
set -a; source .env; set +a
```

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
├── sample.env
└── src/main/java/com/azure/cosmos/createindex/
    ├── App.java
    ├── Config.java
    ├── ControlPlane.java
    └── DataPlane.java
```
