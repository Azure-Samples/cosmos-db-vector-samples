#!/bin/bash
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

# EXIT ON ERROR: Stop the entire script if any command fails
# This prevents partial data states where only some samples get files copied
set -e

# RESOLVE REPOSITORY ROOT
# Script location: {repo}/infra/post-provision.sh
# $(dirname "${BASH_SOURCE[0]}"): Directory containing this script = {repo}/infra
# "/.." in cd command: Parent of infra directory = {repo}
# pwd: Absolute path to repo root
#
# Why absolute path?
#   - Ensures script works correctly even when called from different working directories
#   - azd may invoke this script from various locations (main repo, temp dirs, etc.)
#   - Absolute paths prevent "file not found" errors from relative path issues
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# SOURCE DIRECTORY: Where the data files are stored (committed to repo)
# Expected location: {repo}/data/
SOURCE_DATA_DIR="$REPO_ROOT/data"

# ============================================================================
# SCENARIO DETECTION
# ============================================================================
# Read environment variable that was set during "azd up" or "azd provision"
# Examples:
#   export AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME='HotelsCreateIndex' → CREATE-INDEX scenario
#   (unset) → VECTOR-SEARCH scenario (default)
#
# Bash syntax: "${VAR:-}" safely reads VAR, returns empty string if unset
# This prevents "unbound variable" errors in strict mode

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║ POST-PROVISIONING: Data File Management for Language Samples   ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "Checking deployment scenario..."
echo "Repository root: $REPO_ROOT"
echo "Source data directory: $SOURCE_DATA_DIR"
echo ""

# Check if createIndexDatabaseName was output by Bicep (indicates create-index scenario)
# NOTE: Bicep outputs this as AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME (no underscore),
# which is what's stored in .env after deployment
if [ -n "${AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME:-}" ]; then
    # ================================================================
    # CREATE-INDEX SCENARIO: Copy region-based data files
    # ================================================================
    CREATE_INDEX_DB_NAME="${AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME}"
    
    echo "📍 DEPLOYMENT SCENARIO: CREATE-INDEX"
    echo "   Database name: '$CREATE_INDEX_DB_NAME'"
    echo "   Database has: Database + Roles only (no containers)"
    echo "   SDKs will: Create containers, build vector indexes"
    echo "   Data files: REGION-BASED (organized by geographic region)"
    echo ""
    echo "Discovering all create-index language samples..."
    echo ""
    
    # DISCOVERY: Find all directories matching pattern "nosql-create-index-*"
    # Examples that will be found:
    #   - nosql-create-index-typescript
    #   - nosql-create-index-python
    #   - nosql-create-index-go
    #   - nosql-create-index-java
    #   - nosql-create-index-dotnet
    #   - nosql-create-index-<any-new-language> (automatically discovered!)
    #
    # Bash syntax: for sample_dir in "$REPO_ROOT"/nosql-create-index-*
    #   - Expands the wildcard pattern to list all matching directories
    #   - Loop iterates over each directory found
    #   - [ -d "$sample_dir" ] checks if the entry is actually a directory
    #     (prevents matching non-directories like nosql-create-index.txt)
    
    found_samples=0
    for sample_dir in "$REPO_ROOT"/nosql-create-index-*; do
        # Only process if it's actually a directory (not a file matching the pattern)
        if [ -d "$sample_dir" ]; then
            found_samples=$((found_samples + 1))
            
            # Extract language name from directory path
            # Example: "/path/to/nosql-create-index-typescript" → "typescript"
            # basename removes the directory path, leaving only the directory name
            language=$(basename "$sample_dir")
            
            # Construct data directory path where files will be copied
            # Example: "/path/to/nosql-create-index-typescript/data"
            target_data_dir="$sample_dir/data"
            
            # SETUP: Create data directory if it doesn't exist yet
            # Some samples may not have a data/ directory, so we ensure it exists
            # mkdir -p: Creates directory and parent directories if needed, silently succeeds if already exists
            mkdir -p "$target_data_dir"
            
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
            
            cp "$SOURCE_DATA_DIR/HotelsData_toCosmosDB_byRegion.json" "$target_data_dir/"
            cp "$SOURCE_DATA_DIR/HotelsData_toCosmosDB_Vector_byRegion.json" "$target_data_dir/"
            
            echo "   ✓ $language (region-based data files copied)"
        fi
    done
    
    if [ $found_samples -eq 0 ]; then
        echo "⚠ WARNING: No create-index language samples found!"
        echo "Expected pattern: nosql-create-index-*"
    fi
else
    # ================================================================
    # VECTOR-SEARCH SCENARIO: Copy non-region-based data files (Default)
    # ================================================================
    echo "📍 DEPLOYMENT SCENARIO: VECTOR-SEARCH (Default)"
    echo "   Database name: 'Hotels'"
    echo "   Database has: Database + Containers + Vector Indexes (pre-made)"
    echo "   SDKs will: Query vectors using pre-made containers"
    echo "   Data files: NON-REGION-BASED (flat structure)"
    echo ""
    echo "Discovering all vector-search language samples..."
    echo ""
    
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
    
    found_samples=0
    for sample_dir in "$REPO_ROOT"/nosql-vector-search-*; do
        # Only process if it's actually a directory (not a file matching the pattern)
        if [ -d "$sample_dir" ]; then
            found_samples=$((found_samples + 1))
            
            # Extract language name from directory path
            # Example: "/path/to/nosql-vector-search-typescript" → "typescript"
            # basename removes the directory path, leaving only the directory name
            language=$(basename "$sample_dir")
            
            # Construct data directory path where files will be copied
            # Example: "/path/to/nosql-vector-search-typescript/data"
            target_data_dir="$sample_dir/data"
            
            # SETUP: Create data directory if it doesn't exist yet
            # Some samples may not have a data/ directory, so we ensure it exists
            # mkdir -p: Creates directory and parent directories if needed, silently succeeds if already exists
            mkdir -p "$target_data_dir"
            
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
            
            cp "$SOURCE_DATA_DIR/HotelsData_toCosmosDB.JSON" "$target_data_dir/"
            cp "$SOURCE_DATA_DIR/HotelsData_toCosmosDB_Vector.json" "$target_data_dir/"
            
            echo "   ✓ $language (non-region-based data files copied)"
        fi
    done
    
    if [ $found_samples -eq 0 ]; then
        echo "⚠ WARNING: No vector-search language samples found!"
        echo "Expected pattern: nosql-vector-search-*"
    fi
fi

# ============================================================================
# COMPLETION
# ============================================================================
echo ""
echo "✅ Post-provisioning: Data file setup COMPLETED"
echo ""
echo "Next steps:"
echo "  - Language samples can now run without file-not-found errors"
echo "  - Each sample has the data files appropriate for its scenario"
echo "  - Run 'npm run start' (TypeScript), 'python ...' (Python), etc."
echo ""
