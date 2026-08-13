<#
.SYNOPSIS
Pre-down hook for azd — removes data files copied to sample directories during provisioning.

.DESCRIPTION
This script runs BEFORE infrastructure teardown and cleans up data files that were automatically
copied to language samples by the post-provision hook. It mirrors the post-provision logic:

DEPLOYMENT SCENARIOS:
  1. CREATE-INDEX: Database-only deployment (no containers/indexes pre-created)
     - Scenario triggered by: $AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME environment variable set
     - Affects: All nosql-create-index-* sample directories
     - Files removed: HotelsData_toCosmosDB_byRegion.json, HotelsData_toCosmosDB_Vector_byRegion.json

  2. VECTOR-SEARCH: Full-stack deployment (database + containers + indexes pre-created)
     - Scenario triggered by: $AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME NOT set or empty
     - Affects: All nosql-vector-search-* sample directories
     - Files removed: HotelsData_toCosmosDB.JSON, HotelsData_toCosmosDB_Vector.json

AUTOMATION MECHANISM (Future-Proof):
  This script uses wildcard patterns to automatically discover ALL language sample directories:
  - nosql-create-index-* matches: nosql-create-index-typescript, nosql-create-index-python, nosql-create-index-go, etc.
  - nosql-vector-search-* matches: nosql-vector-search-typescript, nosql-vector-search-python, etc.
  
  Why wildcard discovery? New language samples (e.g., nosql-create-index-rust) are automatically
  discovered and cleaned up with ZERO code changes. The script adapts dynamically.

CLEANUP STRATEGY:
  - Preserves original data files in ./data/ directory (repo root)
  - Removes only the copies that were placed in individual sample directories
  - Uses -ErrorAction Continue to skip missing files gracefully (sample may have deleted them manually)
  - Reports which directories were cleaned and file counts for visibility

ENVIRONMENT:
  - Runs with access to all environment variables set at command line (e.g., $env:AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME)
  - Working directory: repo root (infra/ directory is sibling)
  - Exit code: 0 (success) or 1 (critical failure)

.NOTES
  Author: Azure Developer CLI (azd) automation
  Platform: Windows PowerShell 7+
  Execution: Called by azure.yaml predown hook
#>

param()

# Enable strict error handling
$ErrorActionPreference = "Stop"

# Get the repository root directory (parent of infra/)
$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Write-Host "Repository root: $RepoRoot"

# Detect deployment scenario via environment variable
# NOTE: Variable name must match what is used in bicep parameter file and post-provision hook:
#   AZURE_COSMOSDB_CREATE_INDEX_DATABASE_NAME (with underscore between INDEX and DATABASE)
$CreateIndexDatabaseName = $env:AZURE_COSMOSDB_CREATE_INDEX_DATABASE_NAME
$IsCreateIndexScenario = -not [string]::IsNullOrEmpty($CreateIndexDatabaseName)

if ($IsCreateIndexScenario) {
    Write-Host "Detected CREATE-INDEX scenario — cleaning up create-index samples"
    Write-Host "  (Environment variable AZURE_COSMOSDB_CREATE_INDEX_DATABASE_NAME = '$CreateIndexDatabaseName')"
    
    # Find all create-index sample directories
    # Pattern: nosql-create-index-* matches nosql-create-index-typescript, nosql-create-index-python, etc.
    # Wildcard discovery means new languages are auto-discovered with zero code changes
    $SampleDirectories = Get-ChildItem -Path $RepoRoot -Directory -Filter "nosql-create-index-*" | 
                        Select-Object -ExpandProperty FullName
    
    if (-not $SampleDirectories) {
        Write-Host "No create-index samples found (pattern: nosql-create-index-*). Skipping cleanup."
        exit 0
    }
    
    Write-Host "Found $($SampleDirectories.Count) create-index sample directory(ies):"
    
    # Files to remove for create-index scenario
    # These are region-based data files (organized by geographic region for real-world demonstration)
    $FilesToRemove = @("HotelsData_toCosmosDB_byRegion.json", "HotelsData_toCosmosDB_Vector_byRegion.json")
    
    # Process each sample directory
    foreach ($SampleDir in $SampleDirectories) {
        $SampleName = Split-Path -Leaf $SampleDir
        Write-Host "  Processing: $SampleName"
        
        # Create data directory path (samples expect data/ subdirectory)
        $DataDir = Join-Path -Path $SampleDir -ChildPath "data"
        
        # Skip if directory doesn't exist (data may have been manually deleted)
        if (-not (Test-Path -Path $DataDir -PathType Container)) {
            Write-Host "    ℹ Data directory not found: $DataDir (skipping)"
            continue
        }
        
        $FilesRemovedCount = 0
        
        # Remove each data file
        foreach ($FileName in $FilesToRemove) {
            $FilePath = Join-Path -Path $DataDir -ChildPath $FileName
            
            if (Test-Path -Path $FilePath -PathType Leaf) {
                try {
                    Remove-Item -Path $FilePath -Force
                    Write-Host "    ✓ Removed: $FileName"
                    $FilesRemovedCount++
                }
                catch {
                    Write-Warning "Failed to remove $FilePath`: $_"
                }
            }
            else {
                Write-Host "    ℹ File not found: $FileName (already removed)"
            }
        }
        
        Write-Host "    Summary: Removed $FilesRemovedCount file(s) from $SampleName/data/"
    }
}
else {
    Write-Host "Detected VECTOR-SEARCH scenario — cleaning up vector-search samples"
    Write-Host "  (Environment variable AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME not set or empty)"
    
    # Find all vector-search sample directories
    # Pattern: nosql-vector-search-* matches nosql-vector-search-typescript, nosql-vector-search-python, etc.
    # Wildcard discovery means new languages are auto-discovered with zero code changes
    $SampleDirectories = Get-ChildItem -Path $RepoRoot -Directory -Filter "nosql-vector-search-*" | 
                        Select-Object -ExpandProperty FullName
    
    if (-not $SampleDirectories) {
        Write-Host "No vector-search samples found (pattern: nosql-vector-search-*). Skipping cleanup."
        exit 0
    }
    
    Write-Host "Found $($SampleDirectories.Count) vector-search sample directory(ies):"
    
    # Files to remove for vector-search scenario
    # These are flat (non-region-based) data files for simple query demonstrations
    # Note: Case sensitivity in filenames (.JSON vs .json) matches original repo data structure
    $FilesToRemove = @("HotelsData_toCosmosDB.JSON", "HotelsData_toCosmosDB_Vector.json")
    
    # Process each sample directory
    foreach ($SampleDir in $SampleDirectories) {
        $SampleName = Split-Path -Leaf $SampleDir
        Write-Host "  Processing: $SampleName"
        
        # Create data directory path (samples expect data/ subdirectory)
        $DataDir = Join-Path -Path $SampleDir -ChildPath "data"
        
        # Skip if directory doesn't exist (data may have been manually deleted)
        if (-not (Test-Path -Path $DataDir -PathType Container)) {
            Write-Host "    ℹ Data directory not found: $DataDir (skipping)"
            continue
        }
        
        $FilesRemovedCount = 0
        
        # Remove each data file for vector-search scenario
        foreach ($FileName in $FilesToRemove) {
            $FilePath = Join-Path -Path $DataDir -ChildPath $FileName
            
            if (Test-Path -Path $FilePath -PathType Leaf) {
                try {
                    Remove-Item -Path $FilePath -Force
                    Write-Host "    ✓ Removed: $FileName"
                    $FilesRemovedCount++
                }
                catch {
                    Write-Warning "Failed to remove $FilePath`: $_"
                }
            }
            else {
                Write-Host "    ℹ File not found: $FileName (already removed)"
            }
        }
        
        # Also clean up create-index files if they exist (handles scenario mismatch)
        # This can occur if post-provision was run with env var set, then pre-down runs without it
        $CreateIndexFiles = @("HotelsData_toCosmosDB_byRegion.json", "HotelsData_toCosmosDB_Vector_byRegion.json")
        foreach ($FileName in $CreateIndexFiles) {
            $FilePath = Join-Path -Path $DataDir -ChildPath $FileName
            
            if (Test-Path -Path $FilePath -PathType Leaf) {
                try {
                    Remove-Item -Path $FilePath -Force
                    Write-Host "    ℹ Also removed: $FileName (create-index scenario mismatch)"
                    $FilesRemovedCount++
                }
                catch {
                    Write-Warning "Failed to remove $FilePath`: $_"
                }
            }
        }
        
        Write-Host "    Summary: Removed $FilesRemovedCount file(s) from $SampleName/data/"
    }
}

Write-Host "Pre-down cleanup completed successfully."
exit 0
