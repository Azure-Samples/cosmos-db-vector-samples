# Deployment Guide — Cosmos DB Vector Samples

This document explains how to deploy the Cosmos DB vector samples using Azure Developer CLI (`azd`), including the two deployment scenarios and how environment variables control which scenario runs.

## Table of Contents

- [Deployment Scenarios](#deployment-scenarios)
- [Environment Variable Setup](#environment-variable-setup)
- [Deploying Vector Search Scenario](#deploying-vector-search-scenario)
- [Deploying Create Index Scenario](#deploying-create-index-scenario)
- [Post-Provision and Pre-Down Hooks](#post-provision-and-pre-down-hooks)
- [Troubleshooting](#troubleshooting)

## Deployment Scenarios

The repository supports two deployment scenarios for demonstrating different aspects of vector search:

### Vector Search (Default)

**When to use:** Demonstrating how to query vectors with similarity search in existing containers.

**Environment Variable:** Not set (or empty)

**Database Structure:**
- Standard Cosmos DB NoSQL containers with vector policies pre-configured
- Multiple containers for different indexing algorithms (DiskANN, QuantizedFlat, Flat)
- Sample data includes flat JSON files without region organization

**Data Files Copied:**
- `HotelsData_toCosmosDB.JSON` (flat structure)
- `HotelsData_toCosmosDB_Vector.json` (flat structure)

**Sample Deployment:**
```bash
azd up
```

### Create Index (Custom Vector Indexing)

**When to use:** Demonstrating how to build and configure custom vector index policies, then query the indexed data.

**Environment Variable:** Must be set to `'HotelsCreateIndex'`

**Database Structure:**
- Bicep-created database (`HotelsCreateIndex` by default)
- Each sample creates and deletes only `hotels_diskann` and `hotels_quantizedflat`
  with specific vector index policies
- Sample data includes region-organized JSON files for comprehensive testing

**Data Files Copied:**
- `HotelsData_toCosmosDB_byRegion.json` (organized by region)
- `HotelsData_toCosmosDB_Vector_byRegion.json` (organized by region)

**Sample Deployment:**
```powershell
# Set the environment variable first
$env:AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME='HotelsCreateIndex'

# Then provision
azd up

# Tear down the active azd environment when testing is complete
azd down
```

## Environment Variable Setup

Set `AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME` before provisioning. Prefer
storing it in the active Azure Developer CLI environment:

```powershell
azd env set AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME "HotelsCreateIndex"
```

### Why This Matters

1. Bicep creates the configured create-index database.
2. The post-provision hook copies the region-based data files.
3. The pre-down hook reads mutually exclusive Bicep outputs to select cleanup.

### ⚠️ Common Mistake

```powershell
# This sets the variable only for the current PowerShell session.
$env:AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME='HotelsCreateIndex'; azd up
```

### ✅ Do This Instead

```powershell
# Store the scenario in the active azd environment
azd env set AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME "HotelsCreateIndex"

# Verify the active azd environment value
azd env get-values | Select-String "AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME"

# Now run azd commands
azd up

# Later, tear down the same active azd environment
azd down
```

## Deploying Vector Search Scenario

The default deployment uses the Vector Search scenario — no environment variable required.

### PowerShell (Windows)

```powershell
# 1. Authenticate with Azure
azd auth login

# 2. Provision Azure resources (uses default vector-search scenario)
azd up

# 3. Navigate to a sample directory
cd nosql-vector-search-typescript

# 4. Install dependencies
npm install

# 5. Set environment variables from the provisioned infrastructure
azd env get-values > .env

# 6. Build and run
npm run build
npm run start

# 7. Later, tear down resources
azd down
```

### Bash (Linux/macOS/WSL)

```bash
# 1. Authenticate with Azure
azd auth login

# 2. Provision Azure resources
azd up

# 3. Navigate to a sample directory
cd nosql-vector-search-go

# 4. Set environment variables
azd env get-values > .env

# 5. Build and run
./run.sh

# 6. Tear down
azd down
```

## Deploying Create Index Scenario

The Create Index scenario requires setting the environment variable **before** running `azd up`.

### PowerShell (Windows)

```powershell
# 1. Authenticate with Azure
azd auth login

# 2. Configure the create-index scenario
azd env set AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME "HotelsCreateIndex"

# 3. Verify it's set
Write-Host "Create Index Database Name: $env:AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME"

# 4. Provision Azure resources
#    Post-provision hook will see the variable and copy region-based data files
azd up

# 5. Navigate to a create-index sample
cd nosql-create-index-typescript

# 6. Install dependencies
npm install

# 7. Set environment variables
azd env get-values > .env

# 8. Compile, load .env, and run
npm start

# 9. Later, tear down the active azd environment
azd down
```

### Bash (Linux/macOS/WSL)

```bash
# 1. Authenticate with Azure
azd auth login

# 2. Configure the create-index scenario
azd env set AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME "HotelsCreateIndex"

# 3. Verify it's set
echo $AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME

# 4. Provision
azd up

# 5. Navigate to a sample
cd nosql-create-index-python

# 6. Set environment variables
azd env get-values > .env

# 7. Export the .env values, then run
set -a; source .env; set +a
python -m src.index

# 8. Tear down the active azd environment
azd down
```

## Post-Provision and Pre-Down Hooks

Both deployment phases use lifecycle hooks to automate data file management.

### Post-Provision Hook (`infra/post-provision.sh` and `infra/post-provision.ps1`)

**When it runs:** After Azure resources are successfully created

**What it does:**
1. **Detects the scenario** by checking if `AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME` is set
2. **Discovers all language samples** using glob patterns:
   - Create Index: `nosql-create-index-*` directories
   - Vector Search: `nosql-vector-search-*` directories
3. **Copies the correct data files:**
   - **Create Index scenario:** Copies `HotelsData_toCosmosDB_byRegion.json` and `HotelsData_toCosmosDB_Vector_byRegion.json` (region-organized files)
   - **Vector Search scenario:** Copies `HotelsData_toCosmosDB.JSON` and `HotelsData_toCosmosDB_Vector.json` (flat files)
4. **Creates the `data/` directory** if it doesn't exist in each sample
5. **Logs each action** so you can see what was copied where

### Pre-Down Hook (`infra/pre-down.sh` and `infra/pre-down.ps1`)

**When it runs:** Before Azure resources are deleted (when you run `azd down`)

**What it does:**
1. **Detects the scenario** by checking if `AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME` is set
2. **Discovers all language samples** using the same glob patterns as post-provision
3. **Removes data files** from each sample directory:
   - **Create Index scenario:** Looks for and removes `_byRegion` files
   - **Vector Search scenario:** Looks for and removes flat JSON files
4. **Skips cleanup rather than guessing** if neither scenario output is available
5. **Logs cleanup status** for each directory (found/removed, or skipped if missing)

### Scenario detection safety

The pre-down hook checks the create-index and vector-search database outputs
from the active `azd` environment. If neither output is available, the hook
reports that it can't determine the scenario and skips local data-file cleanup
instead of selecting the wrong sample set.

## Troubleshooting

### Files Not Being Copied After `azd up`

**Problem:** Post-provision hook ran successfully, but data files are missing from sample directories.

**Solution:**
1. **Verify the scenario is correct:**
   ```powershell
   # Check if Create Index variable is set
   $env:AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME
   
   # If empty/null, you deployed Vector Search scenario
   # If set to 'HotelsCreateIndex', you deployed Create Index scenario
   ```

2. **Check the hook output:**
   - Look for post-provision hook messages in the `azd up` output
   - Verify it found samples with the expected pattern

3. **Verify source data exists:**
   ```bash
   ls -la ./data/
   # Should show HotelsData_toCosmosDB* files in the repo root
   ```

4. **Check the sample directories:**
   ```bash
   ls -la ./nosql-vector-search-typescript/data/
   # Files should be there after successful post-provision
   ```

### Files Not Being Cleaned Up During `azd down`

**Problem:** `azd down` completes, but files remain in sample directories.

**Solution:**
1. **Ensure the variable matches the deployment scenario:**
   ```powershell
   # If you deployed with the variable set:
   $env:AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME='HotelsCreateIndex'
   azd down
   
   # If you deployed WITHOUT the variable:
   # Don't set it before running azd down
   azd down
   ```

2. **Run the hook manually to see what it's doing:**
   ```bash
   azd hooks run predown
   # Watch for log messages indicating which files were removed
   ```

3. **Check file ownership and permissions:**
   - Make sure you have write permissions to the sample directories
   - On Linux/macOS, verify the files aren't read-only

### Template Output Evaluation Failed Error

**Problem:** `azd up` fails with: `DeploymentOutputEvaluationFailed: Unable to evaluate template outputs: 'AZURE_COSMOSDB_DISKANN_CONTAINER_NAME,AZURE_COSMOSDB_QUANTIZEDFLAT_CONTAINER_NAME'`

**Solution:**
- This error occurs when the Bicep template tries to output container names that don't exist
- Verify that the correct scenario database was created (check Azure Portal)
- The variable `AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME` should match the deployment scenario you intended

### Hooks Timing Out

**Problem:** Post-provision or pre-down hook takes too long or times out.

**Solution:**
1. Check the repository has all expected sample directories
2. Verify the network connection to Azure (for API calls within hooks)
3. Check disk space (data file copying requires temporary space)
4. Run the hook manually for better diagnostics:
   ```bash
   azd hooks run postprovision
   azd hooks run predown
   ```

## References

- [Azure Developer CLI Documentation](https://learn.microsoft.com/azure/developer/azure-developer-cli)
- [Azure CLI Hooks Reference](https://learn.microsoft.com/azure/developer/azure-developer-cli/azd-cli-reference#azd-hooks-run)
- [Azure Cosmos DB Vector Search](https://learn.microsoft.com/azure/cosmos-db/vector-search)
