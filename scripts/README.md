# scripts/

Pre-flight utilities and hook documentation for the `cosmos-db-vector-samples` AZD deployment.

## Quick Links

- **Want to deploy the samples?** → See [DEPLOYMENT.md](../DEPLOYMENT.md) in the root
- **Building a reusable sample-set validator?** → See [Validate repository sample sets](../.github/docs/VALIDATE-SAMPLE-SETS.md)
- **Understanding post-provision and pre-down hooks?** → See [Hook Architecture](#hook-architecture) below
- **Checking Azure quota before deploying?** → See [check-quota.sh](#check-quotash)

## Hook Architecture

### Overview

The deployment uses two Azure Developer CLI lifecycle hooks to automate data file management:

| Hook | When it Runs | What it Does |
|------|---|---|
| **post-provision** | After `azd up` succeeds | Copies sample data files to language sample directories |
| **predown** | Before `azd down` deletes resources | Removes copied data files from language sample directories |

**Hook files:**
- `infra/post-provision.sh` (Bash version for Linux/WSL)
- `infra/post-provision.ps1` (PowerShell version for Windows)
- `infra/pre-down.sh` (Bash version for Linux/WSL)
- `infra/pre-down.ps1` (PowerShell version for Windows)

### Scenario Detection

The hooks detect the deployment scenario from mutually exclusive database
outputs in the active `azd` environment:

| Variable State | Scenario | Data Files Used |
|---|---|---|
| **Set** (e.g., `'HotelsCreateIndex'`) | Create Index | Region-organized: `*_byRegion.json` files |
| `AZURE_COSMOSDB_DATABASENAME` set | Vector Search | Flat structure: `*.JSON` and `*.json` files |

> [!IMPORTANT]
> Before provisioning the create-index scenario, run
> `azd env set AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME "HotelsCreateIndex"`.
> Bicep creates that database; the samples create and delete only their two
> configured containers.

### Discovery Pattern

The hooks automatically discover all language samples without hardcoding individual directories:

**Create Index samples:** Glob pattern `nosql-create-index-*`
```
nosql-create-index-typescript/
nosql-create-index-python/
nosql-create-index-java/
nosql-create-index-go/
nosql-create-index-dotnet/
```

**Vector Search samples:** Glob pattern `nosql-vector-search-*`
```
nosql-vector-search-typescript/
nosql-vector-search-python/
nosql-vector-search-java/
nosql-vector-search-go/
nosql-vector-search-dotnet/
```

When you add a new language sample (e.g., `nosql-create-index-rust/`), the hooks automatically discover and process it without any code changes.

### Post-Provision Hook Workflow

**When:** Runs automatically after `azd provision` completes  
**Trigger:** Defined in `azure.yaml` as a `postprovision` hook  
**Log location:** Visible in `azd up` command output

**Steps:**
1. Read `AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME` to detect scenario
2. Discover all sample directories matching the scenario pattern
3. For each sample directory:
   - Create `data/` subdirectory if missing
   - Copy appropriate data files from repo root `./data/` to sample's `data/` subdirectory
   - Log each copy action or error
4. Exit with status code 0 after copying the required files

**Example output (Create Index scenario):**
```
Detected CREATE-INDEX scenario — copying data files to create-index samples
(Environment variable AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME = 'HotelsCreateIndex')

Found create-index sample directory(ies):
  Processing: nosql-create-index-typescript
    ✓ Copied HotelsData_toCosmosDB_byRegion.json
    ✓ Copied HotelsData_toCosmosDB_Vector_byRegion.json
  Processing: nosql-create-index-python
    ✓ Copied HotelsData_toCosmosDB_byRegion.json
    ✓ Copied HotelsData_toCosmosDB_Vector_byRegion.json
  (... more samples ...)

Post-provision data file setup completed successfully.
```

### Pre-Down Hook Workflow

**When:** Runs during `azd down` before resources are deleted  
**Trigger:** Defined in `azure.yaml` as a `predown` hook  
**Log location:** Visible in `azd hooks run predown` or `azd down` command output

**Steps:**
1. Read the create-index and vector-search database outputs to detect the scenario
2. Discover all sample directories matching the scenario pattern
3. For each sample directory:
   - Look for data files from the detected scenario
   - Remove each file found (or skip if missing)
   - Log each removal or skip action
4. Skip cleanup with a diagnostic if neither scenario output is available

**Example output (Vector Search scenario):**
```
Detected VECTOR-SEARCH scenario — cleaning up vector-search samples
(Environment variable AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME not set or empty)

Found vector-search sample directory(ies):
  Processing: nosql-vector-search-typescript
    ✓ Removed HotelsData_toCosmosDB.JSON
    ✓ Removed HotelsData_toCosmosDB_Vector.json
  Processing: nosql-vector-search-python
    ✓ Removed HotelsData_toCosmosDB.JSON
    ✓ Removed HotelsData_toCosmosDB_Vector.json
  (... more samples ...)

Pre-down cleanup completed successfully.
```

### Scenario detection safety

The pre-down hook doesn't infer a scenario from a missing variable. It uses
the active `azd` environment outputs and skips local data-file cleanup if
neither database output is available.

## check-quota.sh

Checks that your Azure subscription has enough Azure OpenAI quota to deploy the models in `infra/main.bicep` **before** you run `azd up`.

### What it checks

The Bicep template deploys two Azure OpenAI models:

| Model | Version | SKU (deployment type) | Capacity |
|---|---|---|---|
| `gpt-4.1-mini` | 2025-04-14 | Standard | 50K TPM |
| `text-embedding-3-small` | 1 | Standard | 10K TPM |

Allowed regions: `eastus2`, `swedencentral`

The script:

1. Verifies you're logged in to Azure CLI
2. Checks model availability in each region (model + SKU combination)
3. Queries your subscription's quota usage and limits
4. Compares what the template needs vs. what's available
5. Shows a clear pass/fail table
6. Suggests alternative regions if quota is insufficient

### Prerequisites

- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) installed
- Logged in: `az login`
- A subscription with Azure OpenAI access

### Usage

```bash
# Basic check — all template-allowed regions
./scripts/check-quota.sh

# Check + show fix suggestions
./scripts/check-quota.sh --fix

# Check a specific region only
./scripts/check-quota.sh --region swedencentral

# Use a specific subscription
./scripts/check-quota.sh --subscription 00000000-0000-0000-0000-000000000000

# Combine flags
./scripts/check-quota.sh --fix --region eastus2 --subscription <id>
```

### Example output

```
Azure OpenAI Quota Pre-flight Check
====================================

ℹ  Subscription: My Subscription (abc-123-def)

✅ Bicep references match hardcoded model specs.

Checking quota in target region(s)...

Region           Model                      SKU               Requested       Used      Limit  Status
────────────────  ──────────────────────────  ────────────────  ──────────  ──────────  ──────────  ──────────────
eastus2          gpt-4.1-mini               Standard                50K         30K        80K  ✅ OK (50K free)
eastus2          text-embedding-3-small     Standard                10K          0K       120K  ✅ OK (120K free)

✅ All models have sufficient quota. Ready to deploy!
```

### The `--fix` flag

When quota is insufficient, `--fix` suggests actionable commands:

- **`azd env set AZURE_LOCATION <region>`** — switch to a region with quota
- Portal link to request a quota increase
- How to reduce capacity in the Bicep template

### Keeping the script up to date

The model specs are hardcoded in the script (not parsed from Bicep) for reliability. If you change the models, SKUs, or capacities in `infra/main.bicep`, update the `MODEL_SPECS` array near the top of `check-quota.sh` to match.

### Platform compatibility

Works on Linux, macOS, WSL, and Git Bash on Windows. No dependency on `jq` — uses `az --query` (JMESPath) and standard shell tools only.
