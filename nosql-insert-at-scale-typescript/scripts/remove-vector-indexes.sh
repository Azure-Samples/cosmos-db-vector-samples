#!/bin/bash
# chmod +x "remove-vector-indexes.sh"

# ================================================================================================
# Remove Vector Indexes Script
# ================================================================================================
# This script removes vector indexes from a Cosmos DB container to optimize bulk insert performance.
# Use this before large bulk insert operations to improve throughput and reduce RU consumption.
#
# Prerequisites:
# - Azure CLI installed and logged in (az login)
# - Cosmos DB account already exists with the specified container
# - You have appropriate permissions to modify container settings
#
# Usage:
#   ./scripts/remove-vector-indexes.sh
#   ./scripts/remove-vector-indexes.sh --dry-run    # Show commands without executing
#   ./scripts/remove-vector-indexes.sh --help      # Show this help
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
DRY_RUN=false
BACKUP_FILE="$PROJECT_DIR/.vector-index-backup.json"

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
Remove Vector Indexes Script

This script removes vector indexes from a Cosmos DB container to optimize bulk insert performance.

USAGE:
    $0 [OPTIONS]

OPTIONS:
    --dry-run    Show what would be executed without making changes
    --help       Show this help message

PREREQUISITES:
    - Azure CLI installed and authenticated (run 'az login' first)
    - Cosmos DB account exists with the specified container
    - Appropriate permissions to modify container settings

WHAT THIS SCRIPT DOES:
    1. Reads Cosmos DB configuration from .env file
    2. Backs up current container indexing policy and vector embedding policy
    3. Creates a minimal indexing policy (automatic indexing with no vector indexes)
    4. Updates the container with the simplified policy
    5. Saves backup for restoration later

IMPORTANT NOTES:
    - This script REMOVES vector indexes which will impact vector search performance
    - Always run this script before bulk inserts for better performance
    - Use restore-vector-indexes.sh after bulk operations to restore search capability
    - The backup file (.vector-index-backup.json) is crucial for restoration

REQUIREMENTS:
    - You must have "Cosmos DB Contributor" role or equivalent permissions
    - The container must already exist
    - Your .env file must contain COSMOS_ENDPOINT, COSMOS_DB_NAME, COSMOS_CONTAINER_NAME

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

# Function to backup current container configuration
backup_container_config() {
    local resource_group="$1"
    local account_name="$2"
    local database_name="$3"
    local container_name="$4"
    
    print_info "Backing up current container configuration..."
    
    if [ "$DRY_RUN" = true ]; then
        print_info "Would backup container config to: $BACKUP_FILE"
        return 0
    fi
    
    # Get current container configuration
    local container_config
    if container_config=$(az cosmosdb sql container show \
        --resource-group "$resource_group" \
        --account-name "$account_name" \
        --database-name "$database_name" \
        --name "$container_name" \
        --query "{indexingPolicy: resource.indexingPolicy, vectorEmbeddingPolicy: resource.vectorEmbeddingPolicy, partitionKey: resource.partitionKey}" \
        -o json 2>&1); then
        
        # Save backup with timestamp
        local timestamp=$(date '+%Y-%m-%d_%H-%M-%S')
        local backup_data="{
            \"timestamp\": \"$timestamp\",
            \"accountName\": \"$account_name\",
            \"databaseName\": \"$database_name\",
            \"containerName\": \"$container_name\",
            \"originalConfig\": $container_config
        }"
        
        echo "$backup_data" > "$BACKUP_FILE"
        print_success "Container configuration backed up to: $BACKUP_FILE"
        
        # Show what we backed up
        print_info "Backed up configuration includes:"
        if echo "$container_config" | jq -e '.vectorEmbeddingPolicy.vectorEmbeddings[]?' > /dev/null 2>&1; then
            local vector_count=$(echo "$container_config" | jq '.vectorEmbeddingPolicy.vectorEmbeddings | length')
            print_info "  - Vector embeddings: $vector_count configured"
            echo "$container_config" | jq -r '.vectorEmbeddingPolicy.vectorEmbeddings[] | "    • Path: \(.path), Dimensions: \(.dimensions), Distance: \(.distanceFunction)"'
        else
            print_info "  - Vector embeddings: None found"
        fi
        
        if echo "$container_config" | jq -e '.indexingPolicy.vectorIndexes[]?' > /dev/null 2>&1; then
            local index_count=$(echo "$container_config" | jq '.indexingPolicy.vectorIndexes | length')
            print_info "  - Vector indexes: $index_count configured"
            echo "$container_config" | jq -r '.indexingPolicy.vectorIndexes[] | "    • Path: \(.path), Type: \(.type)"'
        else
            print_info "  - Vector indexes: None found"
        fi
        
    else
        print_error "Failed to backup container configuration: $container_config"
        exit 1
    fi
}

# Function to create minimal indexing policy (no vector indexes)
create_minimal_indexing_policy() {
    cat << 'EOF'
{
    "indexingMode": "consistent",
    "automatic": true,
    "includedPaths": [
        {
            "path": "/*"
        }
    ],
    "excludedPaths": [
        {
            "path": "/\"_etag\"/?"
        }
    ]
}
EOF
}

# Main execution
main() {
    print_header "🗑️  Remove Vector Indexes for Bulk Insert Optimization"
    
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
    
    # Check if .env file exists
    if [ ! -f "$ENV_FILE" ]; then
        print_error ".env file not found at: $ENV_FILE"
        print_info "Please ensure you have a .env file with Cosmos DB configuration"
        exit 1
    fi
    
    # Read configuration from .env file
    print_info "Reading configuration from .env file..."
    
    # Extract required variables
    if ! grep -q "COSMOS_ENDPOINT=" "$ENV_FILE"; then
        print_error "COSMOS_ENDPOINT not found in .env file"
        exit 1
    fi
    
    if ! grep -q "COSMOS_DB_NAME=" "$ENV_FILE"; then
        print_error "COSMOS_DB_NAME not found in .env file"
        exit 1
    fi
    
    if ! grep -q "COSMOS_CONTAINER_NAME=" "$ENV_FILE"; then
        print_error "COSMOS_CONTAINER_NAME not found in .env file"
        exit 1
    fi
    
    COSMOS_ENDPOINT=$(grep "COSMOS_ENDPOINT=" "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'")
    COSMOS_DB_NAME=$(grep "COSMOS_DB_NAME=" "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'")
    COSMOS_CONTAINER_NAME=$(grep "COSMOS_CONTAINER_NAME=" "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'")
    
    # Extract account name
    COSMOS_ACCOUNT_NAME=$(extract_cosmos_account_name "$COSMOS_ENDPOINT")
    
    if [ -z "$COSMOS_ACCOUNT_NAME" ] || [ -z "$COSMOS_DB_NAME" ] || [ -z "$COSMOS_CONTAINER_NAME" ]; then
        print_error "Missing required configuration. Please check your .env file."
        exit 1
    fi
    
    print_success "Configuration loaded:"
    print_info "  - Account: $COSMOS_ACCOUNT_NAME"
    print_info "  - Database: $COSMOS_DB_NAME"
    print_info "  - Container: $COSMOS_CONTAINER_NAME"
    
    # Find resource group
    RESOURCE_GROUP=""
    if grep -q "COSMOS_RESOURCE_GROUP=" "$ENV_FILE"; then
        RESOURCE_GROUP=$(grep "COSMOS_RESOURCE_GROUP=" "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'")
    fi
    
    if [ -z "$RESOURCE_GROUP" ]; then
        print_info "Searching for resource group..."
        COSMOS_INFO=$(az cosmosdb list --query "[?name=='$COSMOS_ACCOUNT_NAME'].{name:name, resourceGroup:resourceGroup}" -o tsv 2>/dev/null)
        if [ -n "$COSMOS_INFO" ]; then
            RESOURCE_GROUP=$(echo "$COSMOS_INFO" | cut -f2)
        else
            print_error "Could not find resource group. Please add COSMOS_RESOURCE_GROUP to your .env file"
            exit 1
        fi
    fi
    
    print_success "Resource Group: $RESOURCE_GROUP"
    
    # Backup current configuration
    backup_container_config "$RESOURCE_GROUP" "$COSMOS_ACCOUNT_NAME" "$COSMOS_DB_NAME" "$COSMOS_CONTAINER_NAME"
    
    # Create minimal indexing policy
    print_info "Creating minimal indexing policy (removing vector indexes)..."
    
    local minimal_policy
    minimal_policy=$(create_minimal_indexing_policy)
    
    if [ "$DRY_RUN" = true ]; then
        print_info "Would apply minimal indexing policy:"
        echo "$minimal_policy" | jq .
        print_info "Would remove vector embedding policy"
    else
        print_info "Applying minimal indexing policy..."
        
        # Update container with minimal indexing policy and no vector embedding policy
        if MSYS_NO_PATHCONV=1 az cosmosdb sql container update \
            --resource-group "$RESOURCE_GROUP" \
            --account-name "$COSMOS_ACCOUNT_NAME" \
            --database-name "$COSMOS_DB_NAME" \
            --name "$COSMOS_CONTAINER_NAME" \
            --idx "$minimal_policy" \
            --query "resource.indexingPolicy" -o json > /dev/null 2>&1; then
            
            print_success "Successfully removed vector indexes from container"
            
            # Wait for policy propagation
            print_info "Waiting for indexing policy to propagate (10 seconds)..."
            sleep 10
            
        else
            print_error "Failed to update container indexing policy"
            print_info "The backup file is still available at: $BACKUP_FILE"
            exit 1
        fi
    fi
    
    echo
    print_header "🎉 Vector Index Removal Complete!"
    
    if [ "$DRY_RUN" = false ]; then
        echo -e "${GREEN}Vector indexes have been removed to optimize bulk insert performance.${NC}"
        echo
        echo -e "${BLUE}Important notes:${NC}"
        echo "• Vector search queries will now be slower until indexes are restored"
        echo "• Bulk insert operations should now have improved performance"
        echo "• Configuration backup saved to: $BACKUP_FILE"
        echo
        echo -e "${BLUE}Next steps:${NC}"
        echo "1. Run your bulk insert operations (npm run start:insert-at-scale)"
        echo "2. Restore vector indexes: ./scripts/restore-vector-indexes.sh"
        echo
        echo -e "${YELLOW}⚠️  Don't forget to restore indexes after bulk operations!${NC}"
    else
        echo -e "${YELLOW}This was a dry run. Use the script without --dry-run to apply changes.${NC}"
    fi
}

# Error handling
trap 'print_error "Script failed on line $LINENO"' ERR

# Run main function
main "$@"