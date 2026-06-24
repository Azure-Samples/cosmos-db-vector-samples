# Configuration Scripts

This directory contains helper scripts for setting up the .NET create-index sample.

## generate-appsettings

Scripts to generate `appsettings.json` from `azd` environment values.

### PowerShell (Windows)

```powershell
# Generate appsettings.json in the parent directory (sample root)
.\generate-appsettings.ps1

# Generate at a custom location
.\generate-appsettings.ps1 -OutputPath "C:\custom\path\appsettings.json"

# Skip validation of required fields (for partial configs)
.\generate-appsettings.ps1 -SkipValidation

# Get help
Get-Help .\generate-appsettings.ps1 -Full
```

### Bash/Shell (macOS and Linux)

```bash
# Make script executable
chmod +x generate-appsettings.sh

# Generate appsettings.json in the parent directory (sample root)
./generate-appsettings.sh

# Generate at a custom location
./generate-appsettings.sh /custom/path/appsettings.json

# Skip validation of required fields
./generate-appsettings.sh --skip-validation
```

## How It Works

1. Calls `azd env get-values` to retrieve environment variables from the current `azd` environment
2. Extracts specific values for Cosmos DB, OpenAI, and sample configuration
3. Builds a JSON object matching the expected `appsettings.json` structure
4. Validates that required fields (Cosmos DB endpoint, OpenAI endpoint) are present
5. Writes the file with UTF-8 encoding (NoBOM on Windows, standard UTF-8 on Unix)

## Required Environment Variables (from `azd up`)

The script expects the following to be set by `azd env get-values`:

- `AZURE_COSMOSDB_ENDPOINT` — Cosmos DB account endpoint URL
- `AZURE_OPENAI_ENDPOINT` — Azure OpenAI resource endpoint URL

Optional but recommended:

- `AZURE_COSMOSDB_DATABASENAME` — Database name (defaults to "HotelsCreateIndex")
- `AZURE_COSMOSDB_CONTAINER_NAME` — Specific container name (leave empty to use both)
- `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` — Deployment name (defaults to "text-embedding-3-small")
- `AZURE_OPENAI_EMBEDDING_API_VERSION` — API version (defaults to "2024-08-01-preview")
- `VECTOR_ALGORITHM` — Vector index type: "diskann" or "quantizedflat" (empty for both)
- `DATA_FILE_WITH_VECTORS_AND_REGIONS` — Path to hotel data file
- `AZURE_SUBSCRIPTION_ID` — Azure subscription ID
- `AZURE_RESOURCE_GROUP` — Azure resource group name
- `AZURE_COSMOSDB_ACCOUNT_NAME` — Cosmos DB account name

## Output Structure

The generated `appsettings.json` has this structure:

```json
{
  "CosmosDbSettings": {
    "Endpoint": "https://account.documents.azure.com:443/",
    "DatabaseName": "HotelsCreateIndex",
    "ContainerName": "",
    "PartitionKeyValue": "Northeast",
    "SubscriptionId": "...",
    "ResourceGroup": "...",
    "AccountName": "..."
  },
  "OpenAiSettings": {
    "Endpoint": "https://resource.openai.azure.com/",
    "Deployment": "text-embedding-3-small",
    "ApiVersion": "2024-08-01-preview"
  },
  "VectorAlgorithm": "",
  "EmbeddedField": "embedding",
  "DataFilePath": "./data/HotelsData_toCosmosDB_Vector_byRegion.json"
}
```

## Troubleshooting

### `ERROR: Failed to run 'azd env get-values'`

Make sure you've initialized an `azd` environment:

```bash
cd ../..  # Go to repo root
azd env new   # Create new environment, or
azd up        # Deploy resources (creates env automatically)
```

### Missing required environment variables

Check that your `.env` file in the azd environment root contains both:
- `AZURE_COSMOSDB_ENDPOINT`
- `AZURE_OPENAI_ENDPOINT`

If one is missing, either:
1. Re-run `azd up` to redeploy infrastructure
2. Manually add the value to `.env` and re-run `azd env set <KEY> <VALUE>`
3. Run with `--skip-validation` (PowerShell: `-SkipValidation`) as a temporary workaround

### Generated file is empty or invalid JSON

This can happen if `azd env get-values` output format doesn't match expectations. Try:
1. Run `azd env get-values` directly to see the output
2. Check that values don't contain special characters that break JSON (quotes, newlines)
3. Open an issue with the output of `azd env get-values`
