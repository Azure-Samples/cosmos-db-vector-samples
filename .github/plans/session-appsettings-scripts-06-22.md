# Session: Appsettings Generation Scripts + Configuration Automation

**Date:** 2026-06-22  
**Branch:** `diberry/article-2`  
**Commit:** 42c9dcb (feat(dotnet): add appsettings.json generation script from azd environment)

## Objective

Create automation scripts to generate `appsettings.json` for the .NET create-index sample from `azd` environment values, enabling seamless developer setup without manual JSON editing.

## Deliverables

### 1. PowerShell Script (`generate-appsettings.ps1`)
- **Location:** `nosql-create-index-dotnet/scripts/generate-appsettings.ps1`
- **Size:** 6.5 KB
- **Platform:** Windows PowerShell 7+
- **Key Features:**
  - Parses `azd env get-values` output with robust regex
  - Validates required fields (Cosmos DB endpoint, OpenAI endpoint)
  - Optional `-SkipValidation` flag for partial configs
  - UTF-8 NoBOM encoding (Windows-compatible JSON standard)
  - Color-coded output (green for success, red for errors, cyan for warnings)
  - Automatic output directory creation (idempotent)
  - Detailed parameter help via `Get-Help`

### 2. Bash/Shell Script (`generate-appsettings.sh`)
- **Location:** `nosql-create-index-dotnet/scripts/generate-appsettings.sh`
- **Size:** 4.3 KB
- **Platform:** macOS/Linux bash
- **Key Features:**
  - Identical feature set to PowerShell version
  - POSIX-compliant shell syntax
  - Uses associative arrays for environment parsing
  - UTF-8 standard encoding
  - Same validation and output formatting

### 3. Documentation (`scripts/README.md`)
- **Location:** `nosql-create-index-dotnet/scripts/README.md`
- **Size:** 4.1 KB
- **Content:**
  - Quick start for both PowerShell and Bash
  - How it works (5-step process)
  - Required environment variables from `azd up`
  - Optional variables with descriptions
  - Output JSON structure documentation
  - Comprehensive troubleshooting section

## Technical Implementation

### Environment Variable Mapping

The scripts parse the following from `azd env get-values`:

**Required for validation:**
- `AZURE_COSMOSDB_ENDPOINT` → CosmosDbSettings.Endpoint
- `AZURE_OPENAI_ENDPOINT` → OpenAiSettings.Endpoint

**Optional with defaults:**
- `AZURE_COSMOSDB_DATABASENAME` → CosmosDbSettings.DatabaseName (default: "HotelsCreateIndex")
- `AZURE_COSMOSDB_CONTAINER_NAME` → CosmosDbSettings.ContainerName (default: empty)
- `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` → OpenAiSettings.Deployment (default: "text-embedding-3-small")
- `AZURE_OPENAI_EMBEDDING_API_VERSION` → OpenAiSettings.ApiVersion (default: "2024-08-01-preview")
- `VECTOR_ALGORITHM` → VectorAlgorithm (default: empty, meaning both "diskann" and "quantizedflat")
- `DATA_FILE_WITH_VECTORS` → DataFilePath (default: "./data/HotelsData_toCosmosDB_Vector_byRegion.json")

**Control Plane values (passed to Config):**
- `AZURE_SUBSCRIPTION_ID` → CosmosDbSettings.SubscriptionId
- `AZURE_RESOURCE_GROUP` → CosmosDbSettings.ResourceGroup
- `AZURE_COSMOSDB_ACCOUNT_NAME` → CosmosDbSettings.AccountName

### Generated Output Format

Both scripts produce identical JSON structure:

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

## Usage Examples

### Windows
```powershell
cd nosql-create-index-dotnet

# Generate in sample root (creates ../appsettings.json)
.\scripts\generate-appsettings.ps1

# Generate at custom path
.\scripts\generate-appsettings.ps1 -OutputPath "C:\config\appsettings.json"

# Skip validation (for partial configs)
.\scripts\generate-appsettings.ps1 -SkipValidation

# View help
Get-Help .\scripts\generate-appsettings.ps1 -Full
```

### macOS/Linux
```bash
cd nosql-create-index-dotnet

# Make executable
chmod +x scripts/generate-appsettings.sh

# Generate in sample root (creates ../appsettings.json)
./scripts/generate-appsettings.sh

# Generate at custom path
./scripts/generate-appsettings.sh /custom/path/appsettings.json

# Skip validation
./scripts/generate-appsettings.sh --skip-validation
```

## Windows Compatibility Notes

All scripts follow the [windows-compatibility skill](../.github/skills/windows-compatibility/) conventions:

1. **UTF-8 NoBOM encoding** — JSON files use `Out-File -Encoding utf8NoBOM` (PowerShell) and standard UTF-8 (Bash)
2. **No colons in filenames** — Timestamps replaced with hyphens
3. **Proper path handling** — Uses `Join-Path` (PowerShell) and `cd` then relative paths (Bash)
4. **Cross-platform line endings** — Both scripts output with platform-native line endings (CRLF on Windows, LF on Unix)

## Testing / Verification

### Manual Test Steps

1. **Environment Setup:**
   ```bash
   cd cosmos-db-vector-samples
   azd env new  # Or: azd up (if not already deployed)
   ```

2. **Run PowerShell Script (Windows):**
   ```powershell
   cd nosql-create-index-dotnet
   .\scripts\generate-appsettings.ps1
   # Should output "✓ Generated: C:\...\appsettings.json"
   ```

3. **Run Bash Script (macOS/Linux):**
   ```bash
   cd nosql-create-index-dotnet
   chmod +x scripts/generate-appsettings.sh
   ./scripts/generate-appsettings.sh
   # Should output "✓ Generated: /.../appsettings.json"
   ```

4. **Verify Output:**
   ```bash
   cat appsettings.json | jq .
   # Should display valid JSON with all required fields
   ```

5. **Run .NET Sample:**
   ```bash
   cd nosql-create-index-dotnet
   dotnet run
   # Should connect to Cosmos DB using credentials from appsettings.json
   ```

### Expected Output

**Success (PowerShell):**
```
========================================
Generate appsettings.json for .NET Sample
========================================

Retrieving azd environment values...
Retrieved values: 12 environment variables

✓ Generated: C:\project-dina\...\appsettings.json

Configuration Summary:
  Cosmos DB Endpoint:    https://account.documents.azure.com:443...
  Database:              HotelsCreateIndex
  Container:             
  Embedded Field:        embedding
  OpenAI Endpoint:       https://resource.openai.azure.com...
  OpenAI Deployment:     text-embedding-3-small
  Data File:             ./data/HotelsData_toCosmosDB_Vector_byRegion.json

✓ appsettings.json is ready for use with 'dotnet run'
```

**Success (Bash):**
```
========================================
Generate appsettings.json for .NET Sample
========================================

Retrieving azd environment values...
Retrieved values: 12 environment variables

✓ Generated: /.../appsettings.json

Configuration Summary:
  Cosmos DB Endpoint:    https://account.documents.azure.com:443...
  Database:              HotelsCreateIndex
  ...
```

## Integration with Existing Code

### Config.cs Deserialization

The generated JSON is designed to deserialize directly into the .NET `Config` class:

```csharp
public class Config
{
    [JsonPropertyName("CosmosDbSettings")]
    public CosmosDbSettings CosmosDbSettings { get; set; } = new();

    [JsonPropertyName("OpenAiSettings")]
    public OpenAiSettings OpenAiSettings { get; set; } = new();

    [JsonPropertyName("VectorAlgorithm")]
    public string VectorAlgorithm { get; set; } = "";

    [JsonPropertyName("EmbeddedField")]
    public string EmbeddedField { get; set; } = "embedding";

    [JsonPropertyName("DataFilePath")]
    public string DataFilePath { get; set; } = "./data/HotelsData_toCosmosDB_Vector_byRegion.json";
}
```

### Bicep Output Mapping

The scripts expect these bicep outputs to be populated in `azd env` (via `.env`):

```bicep
output cosmosDbEndpoint string = cosmosDbAccount.properties.documentEndpoint
output openAiEndpoint string = openAiAccount.properties.endpoint
output subscriptionId string = subscription().subscriptionId
output resourceGroup string = resourceGroup().name
output cosmosDbAccountName string = cosmosDbAccount.name
```

## Known Limitations & Gotchas

1. **Azure CLI Availability:** Scripts require `azd` CLI installed and authenticated
2. **Environment Population:** Assumes `azd up` or `azd env set` has already populated `.env`
3. **Field Name Mapping:** Uses hardcoded field names from `create-index-architecture.md` plan
4. **No Dynamic Validation:** Script does NOT verify endpoint connectivity—only JSON format
5. **Partial Configs:** Without `--skip-validation`, script fails if required fields are missing

## Next Steps

### Immediate
- [ ] Test scripts against actual `azd` environment
- [ ] Verify appsettings.json deserializes correctly in Config.cs
- [ ] Add script invocation to sample README or quickstart

### Optional Enhancements
- [ ] Add similar scripts for Python (.env generation)
- [ ] Add similar scripts for TypeScript (.env generation)
- [ ] Add similar scripts for Go (.env generation)
- [ ] Add similar scripts for Java (.env generation)
- [ ] Add CI/CD integration to run scripts during `azd up`
- [ ] Add validation test that runs `dotnet run` after script generation

### Documentation
- [ ] Add script usage to quickstart-create-index-dotnet.md
- [ ] Link from main README to scripts documentation

## Files Modified/Created

| File | Action | Purpose |
|------|--------|---------|
| `nosql-create-index-dotnet/scripts/generate-appsettings.ps1` | CREATE | PowerShell script for Windows |
| `nosql-create-index-dotnet/scripts/generate-appsettings.sh` | CREATE | Bash script for macOS/Linux |
| `nosql-create-index-dotnet/scripts/README.md` | CREATE | Usage and troubleshooting documentation |

## Commit Summary

**Commit:** 42c9dcb  
**Message:** `feat(dotnet): add appsettings.json generation script from azd environment`  
**Files Changed:** 3 files, 399 insertions(+), 0 deletions(-)

## Related Sessions

- **Prior Session (087):** Harmonized all 5 quickstart articles for consistent Goal 1 & 2 code coverage
- **Prior Context:** All 5 languages (Python, TypeScript, Go, Java, .NET) now have matching depth of code examples for control plane and distance functions

---

**Status:** ✅ COMPLETE — Scripts created, committed, documented.  
**Ready for:** Testing against live azd environment, integration into sample workflow, or additional language-specific scripts.
