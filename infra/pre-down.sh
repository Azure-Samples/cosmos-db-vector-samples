#!/bin/bash
################################################################################
# PRE-DOWN HOOK FOR AZD - REMOVES DATA FILES
#
# SYNOPSIS:
#   This script runs BEFORE infrastructure teardown and cleans up data files that 
#   were automatically copied to language samples by the post-provision hook.
#
# DEPLOYMENT SCENARIOS:
#   1. CREATE-INDEX: Database-only deployment (no containers/indexes pre-created)
#      - Scenario triggered by: $AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME env var set
#      - Affects: All nosql-create-index-* sample directories
#      - Files removed: HotelsData_toCosmosDB_byRegion.json, HotelsData_toCosmosDB_Vector_byRegion.json
#
#   2. VECTOR-SEARCH: Full-stack deployment (database + containers + indexes pre-created)
#      - Scenario triggered by: $AZURE_COSMOSDB_DATABASENAME env var set
#      - Affects: All nosql-vector-search-* sample directories
#      - Files removed: HotelsData_toCosmosDB.JSON, HotelsData_toCosmosDB_Vector.json
#
# AUTOMATION MECHANISM (Future-Proof):
#   This script uses glob patterns to automatically discover ALL language sample directories:
#   - nosql-create-index-* matches: nosql-create-index-typescript, nosql-create-index-python, etc.
#   - nosql-vector-search-* matches: nosql-vector-search-typescript, nosql-vector-search-python, etc.
#
#   Why glob discovery? New language samples (e.g., nosql-create-index-rust) are automatically
#   discovered and cleaned up with ZERO code changes. The script adapts dynamically without
#   maintaining an explicit list of supported languages.
#
# CLEANUP STRATEGY:
#   - Preserves original data files in ./data/ directory (repo root)
#   - Removes only the copies that were placed in individual sample directories
#   - Uses error handling to gracefully skip missing files (sample may have deleted them manually)
#   - Reports which directories were cleaned and file counts for visibility
#
# ENVIRONMENT:
#   - Runs with access to all environment variables set at command line
#   - Working directory: repo root (infra/ directory is sibling)
#   - Exit code: 0 (success) or 1 (failure)
#
# AUTHOR:
#   Azure Developer CLI (azd) automation
#
# PLATFORM:
#   Bash 4+, compatible with macOS, Linux, and Windows Git Bash
#
################################################################################

set -u  # Exit on undefined variables, but allow errors to be handled

# Get the repository root directory (parent of infra/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

echo "Repository root: $REPO_ROOT"

# Detect the deployment scenario from mutually exclusive Bicep outputs.
if [ -n "${AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME:-}" ] && [ -z "${AZURE_COSMOSDB_DATABASENAME:-}" ]; then
    DEPLOYMENT_SCENARIO="create-index"
    echo "Detected CREATE-INDEX scenario — cleaning up create-index samples"
    echo "  (Environment variable AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME = '$AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME')"
elif [ -n "${AZURE_COSMOSDB_DATABASENAME:-}" ] && [ -z "${AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME:-}" ]; then
    DEPLOYMENT_SCENARIO="vector-search"
    echo "Detected VECTOR-SEARCH scenario — cleaning up vector-search samples"
    echo "  (Environment variable AZURE_COSMOSDB_DATABASENAME = '$AZURE_COSMOSDB_DATABASENAME')"
else
    echo "WARNING: Unable to determine the deployment scenario. Exactly one of AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME or AZURE_COSMOSDB_DATABASENAME must be set."
    echo "WARNING: Skipping sample data cleanup rather than assuming a scenario."
    exit 0
fi

if [ "$DEPLOYMENT_SCENARIO" = "create-index" ]; then
    # CREATE-INDEX SCENARIO
    # ======================
    # Find all create-index sample directories using glob pattern
    # Pattern: nosql-create-index-*
    # Examples matched: nosql-create-index-typescript, nosql-create-index-python, nosql-create-index-go, etc.
    
    sample_count=0
    total_files_removed=0
    
    # Use glob pattern to discover all matching directories
    # The loop handles the case where no directories match (pattern expansion produces literal string)
    for sample_dir in "$REPO_ROOT"/nosql-create-index-*; do
        # Skip if no directories match the pattern (globbing produces literal string if no match)
        if [ ! -d "$sample_dir" ]; then
            if [ "$sample_count" -eq 0 ]; then
                echo "No create-index samples found (pattern: nosql-create-index-*). Skipping cleanup."
            fi
            continue
        fi
        
        sample_name=$(basename "$sample_dir")
        
        if [ "$sample_count" -eq 0 ]; then
            echo "Found create-index sample directory(ies):"
        fi
        
        echo "  Processing: $sample_name"
        ((sample_count++))
        
        # Data directory path (samples expect data/ subdirectory)
        data_dir="$sample_dir/data"
        
        # Skip if directory doesn't exist (data may have been manually deleted)
        if [ ! -d "$data_dir" ]; then
            echo "    ℹ Data directory not found: $data_dir (skipping)"
            continue
        fi
        
        files_removed=0
        
        # Files to remove for create-index scenario
        # These are region-based data files (organized by geographic region for real-world demonstration)
        files_to_remove=("HotelsData_toCosmosDB_byRegion.json" "HotelsData_toCosmosDB_Vector_byRegion.json")
        
        # Remove each data file
        for filename in "${files_to_remove[@]}"; do
            filepath="$data_dir/$filename"
            
            if [ -f "$filepath" ]; then
                rm -f "$filepath"
                echo "    ✓ Removed: $filename"
                ((files_removed++))
                ((total_files_removed++))
            else
                echo "    ℹ File not found: $filename (already removed)"
            fi
        done
        
        # Also clean up vector-search files if they exist (handles scenario mismatch)
        # This can occur if post-provision was run with different env var state than pre-down
        vector_search_files=("HotelsData_toCosmosDB.JSON" "HotelsData_toCosmosDB_Vector.json")
        for filename in "${vector_search_files[@]}"; do
            filepath="$data_dir/$filename"
            if [ -f "$filepath" ]; then
                rm -f "$filepath"
                echo "    ℹ Also removed: $filename (vector-search scenario mismatch)"
                ((files_removed++))
                ((total_files_removed++))
            fi
        done
        
        echo "    Summary: Removed $files_removed file(s) from $sample_name/data/"
    done
    
    if [ "$sample_count" -eq 0 ]; then
        echo "No directories matched pattern nosql-create-index-*"
    fi

else
    # VECTOR-SEARCH SCENARIO
    # =======================
    # Find all vector-search sample directories using glob pattern
    # Pattern: nosql-vector-search-*
    # Examples matched: nosql-vector-search-typescript, nosql-vector-search-python, etc.
    
    sample_count=0
    total_files_removed=0
    
    # Use glob pattern to discover all matching directories
    # The loop handles the case where no directories match (pattern expansion produces literal string)
    for sample_dir in "$REPO_ROOT"/nosql-vector-search-*; do
        # Skip if no directories match the pattern (globbing produces literal string if no match)
        if [ ! -d "$sample_dir" ]; then
            if [ "$sample_count" -eq 0 ]; then
                echo "No vector-search samples found (pattern: nosql-vector-search-*). Skipping cleanup."
            fi
            continue
        fi
        
        sample_name=$(basename "$sample_dir")
        
        if [ "$sample_count" -eq 0 ]; then
            echo "Found vector-search sample directory(ies):"
        fi
        
        echo "  Processing: $sample_name"
        ((sample_count++))
        
        # Data directory path (samples expect data/ subdirectory)
        data_dir="$sample_dir/data"
        
        # Skip if directory doesn't exist (data may have been manually deleted)
        if [ ! -d "$data_dir" ]; then
            echo "    ℹ Data directory not found: $data_dir (skipping)"
            continue
        fi
        
        files_removed=0
        
        # Files to remove for vector-search scenario
        # These are flat (non-region-based) data files for simple query demonstrations
        # Note: Case sensitivity in filenames (.JSON vs .json) matches original repo data structure
        files_to_remove=("HotelsData_toCosmosDB.JSON" "HotelsData_toCosmosDB_Vector.json")
        
        # Remove each data file
        for filename in "${files_to_remove[@]}"; do
            filepath="$data_dir/$filename"
            
            if [ -f "$filepath" ]; then
                rm -f "$filepath"
                echo "    ✓ Removed: $filename"
                ((files_removed++))
                ((total_files_removed++))
            else
                echo "    ℹ File not found: $filename (already removed)"
            fi
        done
        
        # Also clean up create-index files if they exist (handles scenario mismatch)
        # This can occur if post-provision was run with env var set, then pre-down runs without it
        create_index_files=("HotelsData_toCosmosDB_byRegion.json" "HotelsData_toCosmosDB_Vector_byRegion.json")
        for filename in "${create_index_files[@]}"; do
            filepath="$data_dir/$filename"
            if [ -f "$filepath" ]; then
                rm -f "$filepath"
                echo "    ℹ Also removed: $filename (create-index scenario mismatch)"
                ((files_removed++))
                ((total_files_removed++))
            fi
        done
        
        echo "    Summary: Removed $files_removed file(s) from $sample_name/data/"
    done
    
    if [ "$sample_count" -eq 0 ]; then
        echo "No directories matched pattern nosql-vector-search-*"
    fi
fi

echo "Pre-down cleanup completed successfully."
exit 0
