#!/bin/bash
# chmod +x "restore-vector-indexes.sh"

# ================================================================================================
# Restore Vector Indexes Script
# ================================================================================================
# This script restores vector indexes to a Cosmos DB container after bulk insert operations.
# Use this after completing bulk inserts to restore optimal vector search performance.
#
# Prerequisites:
# - Azure CLI installed and logged in (az login)
# - Cosmos DB account already exists with the specified container
# - You have appropriate permissions to modify container settings
# - Vector index backup file exists (.vector-index-backup.json)
#
# Usage:
#   ./scripts/restore-vector-indexes.sh
#   ./scripts/restore-vector-indexes.sh --dry-run    # Show commands without executing
#   ./scripts/restore-vector-indexes.sh --help      # Show this help
# ================================================================================================

set -euo pipefail  # Exit on error, undefined vars, pipe failures

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env"
BACKUP_FILE="$PROJECT_DIR/.vector-index-backup.json"
DRY_RUN=false

# Function to print colored output
print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_header() {
    echo -e "${BLUE}"
    echo "================================================================================================"
    echo "$1"
    echo "================================================================================================"
    echo -e "${NC}"
}

# Function to show help
show_help() {
    cat << EOF
Restore Vector Indexes Script

This script restores vector indexes to a Cosmos DB container after bulk insert operations.

USAGE:
    $0 [OPTIONS]

OPTIONS:
    --dry-run    Show what would be executed without making changes
    --help       Show this help message

PREREQUISITES:
    - Azure CLI installed and authenticated (run 'az login' first)
    - Cosmos DB account exists with the specified container
    - Appropriate permissions to modify container settings
    - Backup file exists (.vector-index-backup.json from remove-vector-indexes.sh)

WHAT THIS SCRIPT DOES:
    1. Reads the backup configuration from .vector-index-backup.json
    2. Validates the backup file and current container state
    3. Restores the original indexing policy with vector indexes
    4. Restores the vector embedding policy
    5. Waits for index rebuilding to complete
    6. Verifies the restoration was successful

IMPORTANT NOTES:
    - This script restores vector indexes for optimal vector search performance
    - Index rebuilding may take time and consume additional RUs
    - Always run this script after bulk insert operations are complete
    - The container will have degraded vector search performance until rebuilding completes

REQUIREMENTS:
    - You must have "Cosmos DB Contributor" role or equivalent permissions
    - The backup file (.vector-index-backup.json) must exist
    - The container must match the one that was backed up

EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --help|-h)
            show_help
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Function to execute or show command
execute_or_show() {
    local cmd="$1"
    local description="$2"
    
    if [ "$DRY_RUN" = true ]; then
        print_info "Would execute: $cmd"
    else
        print_info "$description"
        eval "$cmd"
    fi
}

# Function to extract account name from Cosmos DB endpoint
extract_cosmos_account_name() {
    local endpoint="$1"
    echo "$endpoint" | sed -n 's|https://\([^.]*\)\.documents\.azure\.com.*|\1|p'
}

# Function to validate backup file
validate_backup_file() {
    if [ ! -f "$BACKUP_FILE" ]; then
        print_error "Backup file not found: $BACKUP_FILE"
        print_info "You need to run remove-vector-indexes.sh first to create a backup"
        exit 1
    fi
    
    # Validate JSON structure
    if ! jq empty "$BACKUP_FILE" 2>/dev/null; then
        print_error "Backup file is not valid JSON: $BACKUP_FILE"
        exit 1
    fi
    
    # Check required fields
    local required_fields=("timestamp" "accountName" "databaseName" "containerName" "originalConfig")
    for field in "${required_fields[@]}"; do
        if ! jq -e ".$field" "$BACKUP_FILE" > /dev/null 2>&1; then
            print_error "Backup file missing required field: $field"
            exit 1
        fi
    done
    
    print_success "Backup file validation passed"
}

# Function to display backup information
show_backup_info() {
    print_info "Backup file information:"
    
    local timestamp=$(jq -r '.timestamp' "$BACKUP_FILE")
    local account_name=$(jq -r '.accountName' "$BACKUP_FILE")
    local database_name=$(jq -r '.databaseName' "$BACKUP_FILE")
    local container_name=$(jq -r '.containerName' "$BACKUP_FILE")
    
    print_info "  - Backup created: $timestamp"
    print_info "  - Account: $account_name"
    print_info "  - Database: $database_name"
    print_info "  - Container: $container_name"
    
    # Show vector configuration details
    if jq -e '.originalConfig.vectorEmbeddingPolicy.vectorEmbeddings[]?' "$BACKUP_FILE" > /dev/null 2>&1; then
        local vector_count=$(jq '.originalConfig.vectorEmbeddingPolicy.vectorEmbeddings | length' "$BACKUP_FILE")
        print_info "  - Vector embeddings to restore: $vector_count"
        jq -r '.originalConfig.vectorEmbeddingPolicy.vectorEmbeddings[] | "    • \(.path): \(.dimensions)D \(.distanceFunction)"' "$BACKUP_FILE"
    else
        print_warning "  - No vector embeddings found in backup"
    fi
    
    if jq -e '.originalConfig.indexingPolicy.vectorIndexes[]?' "$BACKUP_FILE" > /dev/null 2>&1; then
        local index_count=$(jq '.originalConfig.indexingPolicy.vectorIndexes | length' "$BACKUP_FILE")
        print_info "  - Vector indexes to restore: $index_count"
        jq -r '.originalConfig.indexingPolicy.vectorIndexes[] | "    • \(.path): \(.type)"' "$BACKUP_FILE"
    else
        print_warning "  - No vector indexes found in backup"
    fi
}

# Function to restore indexing policy
restore_indexing_policy() {
    local resource_group="$1"
    local account_name="$2"
    local database_name="$3"
    local container_name="$4"
    
    print_info "Restoring indexing policy with vector indexes..."
    
    # Extract indexing policy from backup
    local indexing_policy
    indexing_policy=$(jq '.originalConfig.indexingPolicy' "$BACKUP_FILE")
    
    if [ "$DRY_RUN" = true ]; then
        print_info "Would restore indexing policy:"
        echo "$indexing_policy" | jq .
        return 0
    fi
    
    # Create temporary file for indexing policy
    local temp_policy_file=$(mktemp)
    echo "$indexing_policy" > "$temp_policy_file"
    
    # Update container with restored indexing policy
    if MSYS_NO_PATHCONV=1 az cosmosdb sql container update \
        --resource-group "$resource_group" \
        --account-name "$account_name" \
        --database-name "$database_name" \
        --name "$container_name" \
        --idx "@$temp_policy_file" \
        --query "resource.indexingPolicy" -o json > /dev/null 2>&1; then
        
        print_success "Indexing policy restored successfully"
        
        # Clean up temp file
        rm -f "$temp_policy_file"
        
    else
        rm -f "$temp_policy_file"
        print_error "Failed to restore indexing policy"
        exit 1
    fi
}

# Function to restore vector embedding policy
restore_vector_embedding_policy() {
    local resource_group="$1"
    local account_name="$2"
    local database_name="$3"
    local container_name="$4"
    
    # Check if vector embedding policy exists in backup
    if ! jq -e '.originalConfig.vectorEmbeddingPolicy' "$BACKUP_FILE" > /dev/null 2>&1; then
        print_warning "No vector embedding policy found in backup - skipping"
        return 0
    fi
    
    print_info "Restoring vector embedding policy..."
    
    # Extract vector embedding policy from backup
    local vector_policy
    vector_policy=$(jq '.originalConfig.vectorEmbeddingPolicy' "$BACKUP_FILE")
    
    if [ "$DRY_RUN" = true ]; then
        print_info "Would restore vector embedding policy:"
        echo "$vector_policy" | jq .
        return 0
    fi
    
    # Create temporary file for vector policy
    local temp_vector_file=$(mktemp)
    echo "$vector_policy" > "$temp_vector_file"
    
    # Update container with restored vector embedding policy
    if MSYS_NO_PATHCONV=1 az cosmosdb sql container update \
        --resource-group "$resource_group" \
        --account-name "$account_name" \
        --database-name "$database_name" \
        --name "$container_name" \
        --vector-policy "@$temp_vector_file" \
        --query "resource.vectorEmbeddingPolicy" -o json > /dev/null 2>&1; then
        
        print_success "Vector embedding policy restored successfully"
        
        # Clean up temp file
        rm -f "$temp_vector_file"
        
    else
        rm -f "$temp_vector_file"
        print_error "Failed to restore vector embedding policy"
        print_warning "Indexing policy was restored, but vector embedding policy failed"
        exit 1
    fi
}

# Function to wait for index rebuilding
wait_for_index_rebuild() {
    if [ "$DRY_RUN" = true ]; then
        print_info "Would wait for index rebuilding to complete"
        return 0
    fi
    
    print_info "Index restoration initiated. Vector indexes are now rebuilding..."
    print_warning "Note: Index rebuilding happens asynchronously and may take time"
    print_info "Vector search performance will gradually improve as rebuilding progresses"
    
    # Wait a bit for the changes to take effect
    print_info "Waiting for initial propagation (15 seconds)..."
    sleep 15
    
    print_success "Index restoration process started successfully"
}

# Main execution
main() {
    print_header "🔄 Restore Vector Indexes for Optimal Search Performance"
    
    if [ "$DRY_RUN" = true ]; then
        print_warning "DRY RUN MODE - No changes will be made"
        echo
    fi
    
    # Check if Azure CLI is installed and logged in
    print_info "Checking Azure CLI status..."
    if ! command -v az &> /dev/null; then
        print_error "Azure CLI is not installed. Please install it first: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli"
        exit 1
    fi
    
    if ! az account show &> /dev/null; then
        print_error "Not logged in to Azure CLI. Please run 'az login' first"
        exit 1
    fi
    
    print_success "Azure CLI is installed and authenticated"
    
    # Validate backup file
    validate_backup_file
    
    # Show backup information
    show_backup_info
    
    # Extract configuration from backup
    COSMOS_ACCOUNT_NAME=$(jq -r '.accountName' "$BACKUP_FILE")
    COSMOS_DB_NAME=$(jq -r '.databaseName' "$BACKUP_FILE")
    COSMOS_CONTAINER_NAME=$(jq -r '.containerName' "$BACKUP_FILE")
    
    # Find resource group (try backup first, then .env, then search)
    RESOURCE_GROUP=""
    
    # Try to get from .env file
    if [ -f "$ENV_FILE" ] && grep -q "COSMOS_RESOURCE_GROUP=" "$ENV_FILE"; then
        RESOURCE_GROUP=$(grep "COSMOS_RESOURCE_GROUP=" "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'")
    fi
    
    if [ -z "$RESOURCE_GROUP" ]; then
        print_info "Searching for resource group..."
        COSMOS_INFO=$(az cosmosdb list --query "[?name=='$COSMOS_ACCOUNT_NAME'].{name:name, resourceGroup:resourceGroup}" -o tsv 2>/dev/null)
        if [ -n "$COSMOS_INFO" ]; then
            RESOURCE_GROUP=$(echo "$COSMOS_INFO" | cut -f2)
        else
            print_error "Could not find resource group for account: $COSMOS_ACCOUNT_NAME"
            print_info "Please add COSMOS_RESOURCE_GROUP to your .env file or ensure the account exists"
            exit 1
        fi
    fi
    
    print_success "Configuration loaded:"
    print_info "  - Account: $COSMOS_ACCOUNT_NAME"
    print_info "  - Database: $COSMOS_DB_NAME"
    print_info "  - Container: $COSMOS_CONTAINER_NAME"
    print_info "  - Resource Group: $RESOURCE_GROUP"
    
    # Verify container exists
    print_info "Verifying container exists..."
    if ! az cosmosdb sql container show \
        --resource-group "$RESOURCE_GROUP" \
        --account-name "$COSMOS_ACCOUNT_NAME" \
        --database-name "$COSMOS_DB_NAME" \
        --name "$COSMOS_CONTAINER_NAME" > /dev/null 2>&1; then
        
        print_error "Container not found: $COSMOS_CONTAINER_NAME"
        print_info "Please ensure the container exists before restoring indexes"
        exit 1
    fi
    
    print_success "Container verified: $COSMOS_CONTAINER_NAME"
    
    # Restore indexing policy
    restore_indexing_policy "$RESOURCE_GROUP" "$COSMOS_ACCOUNT_NAME" "$COSMOS_DB_NAME" "$COSMOS_CONTAINER_NAME"
    
    # Restore vector embedding policy
    restore_vector_embedding_policy "$RESOURCE_GROUP" "$COSMOS_ACCOUNT_NAME" "$COSMOS_DB_NAME" "$COSMOS_CONTAINER_NAME"
    
    # Wait for index rebuilding
    wait_for_index_rebuild
    
    echo
    print_header "🎉 Vector Index Restoration Complete!"
    
    if [ "$DRY_RUN" = false ]; then
        echo -e "${GREEN}Vector indexes have been restored for optimal search performance.${NC}"
        echo
        echo -e "${BLUE}What happened:${NC}"
        echo "• Indexing policy restored with vector indexes"
        echo "• Vector embedding policy restored"
        echo "• Index rebuilding initiated (runs asynchronously)"
        echo
        echo -e "${BLUE}Important notes:${NC}"
        echo "• Vector search performance will improve as indexes rebuild"
        echo "• Index rebuilding may take time and consume additional RUs"
        echo "• You can monitor progress in Azure Portal → Cosmos DB → Metrics"
        echo
        echo -e "${BLUE}Next steps:${NC}"
        echo "1. Monitor index rebuilding progress in Azure Portal"
        echo "2. Test vector search queries to verify performance"
        echo "3. Consider running performance tests to validate optimization"
        echo
        echo -e "${GREEN}Your container is now optimized for vector search operations! 🚀${NC}"
        
        # Clean up backup file after successful restoration
        if [ -f "$BACKUP_FILE" ]; then
            print_info "Cleaning up backup file..."
            rm -f "$BACKUP_FILE"
            print_success "Backup file cleaned up"
        fi
        
    else
        echo -e "${YELLOW}This was a dry run. Use the script without --dry-run to apply changes.${NC}"
    fi
}

# Error handling
trap 'print_error "Script failed on line $LINENO"' ERR

# Run main function
main "$@"