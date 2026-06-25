# Azure Cosmos DB for NoSQL create-index sample with Java

This sample shows how to load pre-vectorized hotel documents into existing Azure Cosmos DB for NoSQL containers and run vector similarity queries with Java.

It uses:
- `DefaultAzureCredential` for Azure Cosmos DB and the Azure OpenAI client
- existing `Hotels` database resources created by `azd up`
- the shared `..\data\HotelsData_toCosmosDB_Vector_byRegion.json` dataset
- bulk upsert operations for `hotels_diskann_java` and `hotels_quantizedflat_java`
- `VectorDistance()` SQL queries for similarity search

> [!IMPORTANT]
> This sample is data-plane only. It does not create databases, containers, or vector indexes. Run `azd up` from the repo root before you run this sample.

## Prerequisites

- Java 17 LTS or later
- Maven 3.9 or later
- Azure CLI installed and signed in with `az login`
- Azure resources already provisioned by `azd up`
- Microsoft Entra ID roles:
  - **Cosmos DB Built-in Data Contributor**
  - **Cognitive Services OpenAI User**

The sample expects these existing containers in the `Hotels` database:
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

2. Verify `.env` has your Azure Cosmos DB endpoint and Azure OpenAI settings.

   Notes:
   - Leave `AZURE_COSMOSDB_CONTAINER_NAME` empty to run all supported containers.
   - Leave `VECTOR_ALGORITHM` empty to run both algorithms.
   - Set `VECTOR_ALGORITHM` to `diskann` or `quantizedflat` to run one algorithm.
   - Set `AZURE_COSMOSDB_CONTAINER_NAME` only if you want to target one container directly.

3. Build the project.

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

### Note about SLF4J logging messages

When you run `mvn exec:java`, you may see these lines:

```text
SLF4J: Failed to load class "org.slf4j.impl.StaticLoggerBinder".
SLF4J: Defaulting to no-operation (NOP) logger implementation
SLF4J: See http://www.slf4j.org/codes.html#StaticLoggerBinder for further details.
```

This message is informational, not an error. The Azure SDK uses SLF4J as a logging facade, but no logging backend is on the classpath, so SLF4J defaults to a no-op logger that discards SDK internal log output. The sample's `System.out` output is unaffected. These lines print to stderr, so `> output.txt` doesn't capture them. To see SDK logs, add an SLF4J binding such as `slf4j-simple` or `logback-classic` as a dependency.

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
    └── DataPlane.java
```
