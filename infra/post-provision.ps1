# ============================================================================
# POST-PROVISIONING DATA FILE MANAGEMENT HOOK
# ============================================================================
# Purpose: Automatically copy the correct data files to language samples
#          based on the deployment scenario (create-index vs vector-search)
#
# This script is called by: azure.yaml (hooks.postprovision.run)
# When it runs: After azd provision completes infrastructure deployment
#
# ============================================================================
# DEPLOYMENT SCENARIOS EXPLAINED
# ============================================================================
#
# SCENARIO 1: CREATE-INDEX (Infrastructure Only)
#   - Database created: YES (empty, no containers)
#   - Containers created: NO (SDKs create them as part of the sample)
#   - Vector Indexes created: NO (SDKs create them as part of the sample)
#   - Data files used: REGION-BASED
#     * HotelsData_toCosmosDB_byRegion.json (organized by geographic region)
#     * HotelsData_toCosmosDB_Vector_byRegion.json (vectors organized by region)
#   - Trigger: AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME env var is SET
#   - Articles: Article 2 content (control plane demonstrations)
#
# SCENARIO 2: VECTOR-SEARCH (Default, Full Stack)
#   - Database created: YES (with pre-made containers and indexes)
#   - Containers created: YES (by infrastructure)
#   - Vector Indexes created: YES (by infrastructure)
#   - Data files used: NON-REGION-BASED (flat, no organization)
#     * HotelsData_toCosmosDB.JSON (flat structure)
#     * HotelsData_toCosmosDB_Vector.json (flat vectors)
#   - Trigger: AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME env var is NOT SET
#   - Articles: Article 1 content (data plane demonstrations)
#
# WHY DIFFERENT DATA FILES?
#   - Create-Index samples demonstrate how to ORGANIZE and CREATE vectors
#     using region-based structure to show real-world patterns
#   - Vector-Search samples demonstrate how to QUERY vectors in pre-made
#     containers, using simple flat data structure for clarity
#
# ============================================================================
# HOW AUTOMATION WORKS
# ============================================================================
#
# DISCOVERY (Automatic):
#   Uses wildcard patterns to find ALL language samples WITHOUT listing them:
#   - Pattern: nosql-create-index-* → finds ALL create-index language samples
#   - Pattern: nosql-vector-search-* → finds ALL vector-search language samples
#   - NEW LANGUAGES: No code changes needed! Adding nosql-create-index-rust
#     will automatically be discovered and processed
#
# PROCESSING (Per Sample):
#   For each discovered sample:
#   1. Extract language name from directory (e.g., "typescript" from "nosql-create-index-typescript")
#   2. Create data/ subdirectory if missing
#   3. Copy appropriate data files (region-based OR flat based on scenario)
#   4. Report completion status
#
# ============================================================================

param(
    # RepoRoot parameter: can be overridden for testing, defaults to script location
    [string]$RepoRoot = $PSScriptRoot
)

# RESOLVE REPOSITORY ROOT
# Script location: {repo}/infra/post-provision.ps1
# Script parent ($PSScriptRoot): {repo}/infra
# Repo root (our target): {repo} (parent of infra)
$RepoRoot = Split-Path -Parent $RepoRoot

# SOURCE DIRECTORY: Where the data files are stored (committed to repo)
# Expected location: {repo}/data/
$sourceDataDir = Join-Path $RepoRoot "data"

# ============================================================================
# SCENARIO DETECTION
# ============================================================================
# Read environment variable that was set during "azd up" or "azd provision"
# Examples:
#   $env:AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME='HotelsCreateIndex' → CREATE-INDEX scenario
#   (unset) → VECTOR-SEARCH scenario (default)

Write-Host ""
Write-Host "╔════════════════════════════════════════════════════════════════╗"
Write-Host "║ POST-PROVISIONING: Data File Management for Language Samples   ║"
Write-Host "╚════════════════════════════════════════════════════════════════╝"
Write-Host ""
Write-Host "Checking deployment scenario..."
Write-Host "Repository root: $RepoRoot"
Write-Host "Source data directory: $sourceDataDir"
Write-Host ""

# Check if createIndexDatabaseName environment variable was set (indicates create-index scenario)
$createIndexDbName = $env:AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME
$isCreateIndexScenario = -not [string]::IsNullOrEmpty($createIndexDbName)

if ($isCreateIndexScenario) {
    # ================================================================
    # CREATE-INDEX SCENARIO: Copy region-based data files
    # ================================================================
    Write-Host "📍 DEPLOYMENT SCENARIO: CREATE-INDEX"
    Write-Host "   Database name: '$createIndexDbName'"
    Write-Host "   Database has: Database + Roles only (no containers)"
    Write-Host "   SDKs will: Create containers, build vector indexes"
    Write-Host "   Data files: REGION-BASED (organized by geographic region)"
    Write-Host ""
    Write-Host "Discovering all create-index language samples..."
    Write-Host ""
    
    # DISCOVERY: Find all directories matching pattern "nosql-create-index-*"
    # Examples that will be found:
    #   - nosql-create-index-typescript
    #   - nosql-create-index-python
    #   - nosql-create-index-go
    #   - nosql-create-index-java
    #   - nosql-create-index-dotnet
    #   - nosql-create-index-<any-new-language> (automatically discovered!)
    #
    # The Get-ChildItem -Filter parameter uses wildcard matching, so this
    # query will find ANY directory starting with "nosql-create-index-"
    $sampleDirs = Get-ChildItem -Path $RepoRoot -Directory -Filter "nosql-create-index-*" | Select-Object -ExpandProperty FullName
    
    if ($sampleDirs.Count -eq 0) {
        Write-Host "⚠ WARNING: No create-index language samples found!"
        Write-Host "Expected pattern: nosql-create-index-*"
    } else {
        Write-Host "✓ Found $($sampleDirs.Count) create-index language sample(s):"
        Write-Host ""
        
        # PROCESSING: Loop through each discovered sample directory
        foreach ($sampleDir in $sampleDirs) {
            # Extract language name from directory path
            # Example: "C:\repo\nosql-create-index-typescript" → "typescript"
            $language = Split-Path -Leaf $sampleDir
            
            # Construct data directory path where files will be copied
            # Example: "C:\repo\nosql-create-index-typescript\data"
            $targetDataDir = Join-Path $sampleDir "data"
            
            # SETUP: Create data directory if it doesn't exist yet
            # Some samples may not have a data/ directory, so we ensure it exists
            if (-not (Test-Path $targetDataDir)) {
                New-Item -ItemType Directory -Path $targetDataDir -Force | Out-Null
            }
            
            # COPY FILES: Region-based data files for create-index scenario
            # File 1: HotelsData_toCosmosDB_byRegion.json
            #   - Contains hotel documents organized by geographic region
            #   - Used by create-index samples to demonstrate region-based partitioning
            #   - Demonstrates how to organize data before creating vectors
            #
            # File 2: HotelsData_toCosmosDB_Vector_byRegion.json
            #   - Contains hotel documents with vector embeddings, organized by region
            #   - Used by create-index samples to demonstrate creating vector indexes
            #   - Demonstrates how to create containers with immutable vector indexes
            
            $regionFile1 = Join-Path $sourceDataDir "HotelsData_toCosmosDB_byRegion.json"
            $regionFile2 = Join-Path $sourceDataDir "HotelsData_toCosmosDB_Vector_byRegion.json"
            
            if (Test-Path $regionFile1) {
                Copy-Item -Path $regionFile1 -Destination $targetDataDir -Force
            }
            if (Test-Path $regionFile2) {
                Copy-Item -Path $regionFile2 -Destination $targetDataDir -Force
            }
            
            Write-Host "   ✓ $language (region-based data files copied)"
        }
    }
} else {
    # ================================================================
    # VECTOR-SEARCH SCENARIO: Copy non-region-based data files (Default)
    # ================================================================
    Write-Host "📍 DEPLOYMENT SCENARIO: VECTOR-SEARCH (Default)"
    Write-Host "   Database name: 'Hotels'"
    Write-Host "   Database has: Database + Containers + Vector Indexes (pre-made)"
    Write-Host "   SDKs will: Query vectors using pre-made containers"
    Write-Host "   Data files: NON-REGION-BASED (flat structure)"
    Write-Host ""
    Write-Host "Discovering all vector-search language samples..."
    Write-Host ""
    
    # DISCOVERY: Find all directories matching pattern "nosql-vector-search-*"
    # Examples that will be found:
    #   - nosql-vector-search-typescript
    #   - nosql-vector-search-python
    #   - nosql-vector-search-go
    #   - nosql-vector-search-java
    #   - nosql-vector-search-dotnet
    #   - nosql-vector-search-<any-new-language> (automatically discovered!)
    #
    # Same wildcard discovery pattern as create-index scenario, but different
    # directory name pattern ensures create-index and vector-search samples
    # are never mixed up
    $sampleDirs = Get-ChildItem -Path $RepoRoot -Directory -Filter "nosql-vector-search-*" | Select-Object -ExpandProperty FullName
    
    if ($sampleDirs.Count -eq 0) {
        Write-Host "⚠ WARNING: No vector-search language samples found!"
        Write-Host "Expected pattern: nosql-vector-search-*"
    } else {
        Write-Host "✓ Found $($sampleDirs.Count) vector-search language sample(s):"
        Write-Host ""
        
        # PROCESSING: Loop through each discovered sample directory
        foreach ($sampleDir in $sampleDirs) {
            # Extract language name from directory path
            # Example: "C:\repo\nosql-vector-search-typescript" → "typescript"
            $language = Split-Path -Leaf $sampleDir
            
            # Construct data directory path where files will be copied
            # Example: "C:\repo\nosql-vector-search-typescript\data"
            $targetDataDir = Join-Path $sampleDir "data"
            
            # SETUP: Create data directory if it doesn't exist yet
            # Some samples may not have a data/ directory, so we ensure it exists
            if (-not (Test-Path $targetDataDir)) {
                New-Item -ItemType Directory -Path $targetDataDir -Force | Out-Null
            }
            
            # COPY FILES: Non-region-based (flat) data files for vector-search scenario
            # File 1: HotelsData_toCosmosDB.JSON
            #   - Contains hotel documents in flat structure (no regional organization)
            #   - Used by vector-search samples to load data into pre-made containers
            #   - Demonstrates how to use simple data with existing infrastructure
            #
            # File 2: HotelsData_toCosmosDB_Vector.json
            #   - Contains hotel documents with vector embeddings in flat structure
            #   - Used by vector-search samples to demonstrate vector query algorithms
            #   - Demonstrates how to query diskANN, quantizedFlat, and flat indexes
            
            $flatFile1 = Join-Path $sourceDataDir "HotelsData_toCosmosDB.JSON"
            $flatFile2 = Join-Path $sourceDataDir "HotelsData_toCosmosDB_Vector.json"
            
            if (Test-Path $flatFile1) {
                Copy-Item -Path $flatFile1 -Destination $targetDataDir -Force
            }
            if (Test-Path $flatFile2) {
                Copy-Item -Path $flatFile2 -Destination $targetDataDir -Force
            }
            
            Write-Host "   ✓ $language (non-region-based data files copied)"
        }
    }
}

# ============================================================================
# COMPLETION
# ============================================================================
Write-Host ""
Write-Host "✅ Post-provisioning: Data file setup COMPLETED"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  - Language samples can now run without file-not-found errors"
Write-Host "  - Each sample has the data files appropriate for its scenario"
Write-Host "  - Run 'npm run start' (TypeScript), 'python ...' (Python), etc."
Write-Host ""
