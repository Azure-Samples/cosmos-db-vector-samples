#!/bin/bash
# chmod +x "setup-cosmos-permissions.sh"


# ================================================================================================
# Cosmos DB Permissions Setup Script
# ================================================================================================
# This script sets up the necessary Azure RBAC permissions for passwordless authentication
# to your Cosmos DB account for the insert-at-scale package.
#
# Prerequisites:
# - Azure CLI installed and logged in (az login)
# - Cosmos DB account already exists
# - You have appropriate permissions to assign roles
#
# Usage:
#   ./scripts/setup-cosmos-permissions.sh
#   ./scripts/setup-cosmos-permissions.sh --dry-run    # Show commands without executing
#   ./scripts/setup-cosmos-permissions.sh --help      # Show this help
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
Cosmos DB Permissions Setup Script

This script configures Azure RBAC permissions for passwordless authentication to Cosmos DB.

USAGE:
    $0 [OPTIONS]

OPTIONS:
    --dry-run    Show what would be executed without making changes
    --help       Show this help message

PREREQUISITES:
    - Azure CLI installed and authenticated (run 'az login' first)
    - Cosmos DB account exists
    - Appropriate permissions to assign RBAC roles

WHAT THIS SCRIPT DOES:
    1. Reads Cosmos DB configuration from .env file
    2. Gets your current user identity
    3. Extracts Cosmos DB account details from endpoint URL
    4. Finds the built-in "Cosmos DB Built-in Data Contributor" role definition
    5. Creates a Cosmos DB-specific role assignment (data plane access)
    6. Verifies the permission assignment

NOTE: This script uses Cosmos DB's native RBAC system, not Azure's general RBAC.
The "Cosmos DB Built-in Data Contributor" role provides data plane access to read
and write data in Cosmos DB containers.

REQUIREMENTS:
    - You must have "Cosmos DB Operator" role or equivalent control plane access
    - The Cosmos DB account must already exist
    - Your .env file must contain COSMOS_ENDPOINT (and optionally COSMOS_RESOURCE_GROUP)

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
    # Extract account name from https://account-name.documents.azure.com format
    echo "$endpoint" | sed -n 's|https://\([^.]*\)\.documents\.azure\.com.*|\1|p'
}

# Main execution
main() {
    print_header "🚀 Azure Cosmos DB Permissions Setup"
    
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
    
    # Check if logged in
    if ! az account show &> /dev/null; then
        print_error "Not logged in to Azure CLI. Please run 'az login' first"
        exit 1
    fi
    
    print_success "Azure CLI is installed and authenticated"
    
    # Check if .env file exists
    if [ ! -f "$ENV_FILE" ]; then
        print_error ".env file not found at: $ENV_FILE"
        print_info "Please ensure you have a .env file with COSMOS_ENDPOINT configured"
        exit 1
    fi
    
    # Read Cosmos DB endpoint from .env file
    print_info "Reading configuration from .env file..."
    
    if ! grep -q "COSMOS_ENDPOINT=" "$ENV_FILE"; then
        print_error "COSMOS_ENDPOINT not found in .env file"
        exit 1
    fi
    
    COSMOS_ENDPOINT=$(grep "COSMOS_ENDPOINT=" "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'")
    
    if [ -z "$COSMOS_ENDPOINT" ]; then
        print_error "COSMOS_ENDPOINT is empty in .env file"
        exit 1
    fi
    
    print_success "Found Cosmos DB endpoint: $COSMOS_ENDPOINT"
    
    # Extract account name from endpoint
    COSMOS_ACCOUNT_NAME=$(extract_cosmos_account_name "$COSMOS_ENDPOINT")
    
    if [ -z "$COSMOS_ACCOUNT_NAME" ]; then
        print_error "Could not extract Cosmos DB account name from endpoint: $COSMOS_ENDPOINT"
        exit 1
    fi
    
    print_success "Extracted Cosmos DB account name: $COSMOS_ACCOUNT_NAME"
    
    # Get current user information
    print_info "Getting current user information..."
    USER_ID=$(az ad signed-in-user show --query id -o tsv)
    USER_EMAIL=$(az ad signed-in-user show --query mail -o tsv)
    SUBSCRIPTION_ID=$(az account show --query id -o tsv)
    SUBSCRIPTION_NAME=$(az account show --query name -o tsv)
    
    print_success "Current user: $USER_EMAIL (ID: $USER_ID)"
    print_success "Current subscription: $SUBSCRIPTION_NAME (ID: $SUBSCRIPTION_ID)"
    
    # Find the Cosmos DB account and resource group
    print_info "Locating Cosmos DB account..."
    
    # Method 1: Check if resource group is specified in .env file
    RESOURCE_GROUP=""
    if grep -q "COSMOS_RESOURCE_GROUP=" "$ENV_FILE"; then
        RESOURCE_GROUP=$(grep "COSMOS_RESOURCE_GROUP=" "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'")
        if [ -n "$RESOURCE_GROUP" ]; then
            print_success "Using resource group from .env file: $RESOURCE_GROUP"
            
            # Verify the account exists in this resource group
            if az cosmosdb show --name "$COSMOS_ACCOUNT_NAME" --resource-group "$RESOURCE_GROUP" &> /dev/null; then
                print_success "Verified Cosmos DB account exists in resource group: $RESOURCE_GROUP"
            else
                print_error "Cosmos DB account '$COSMOS_ACCOUNT_NAME' not found in resource group '$RESOURCE_GROUP'"
                exit 1
            fi
        fi
    fi
    
    # Method 2: Try to find the account by listing all Cosmos DB accounts
    if [ -z "$RESOURCE_GROUP" ]; then
        print_info "Searching for Cosmos DB account in current subscription..."
        
        COSMOS_INFO=$(az cosmosdb list --query "[?name=='$COSMOS_ACCOUNT_NAME'].{name:name, resourceGroup:resourceGroup}" -o tsv 2>/dev/null)
        
        if [ -n "$COSMOS_INFO" ]; then
            RESOURCE_GROUP=$(echo "$COSMOS_INFO" | cut -f2)
            print_success "Found Cosmos DB account in resource group: $RESOURCE_GROUP"
        else
            print_warning "Could not find Cosmos DB account '$COSMOS_ACCOUNT_NAME' by listing accounts"
            print_info "This might be due to permissions or the account being in a different subscription"
        fi
    fi
    
    # Method 3: Try to find using resource graph query (if available)
    if [ -z "$RESOURCE_GROUP" ] && command -v az graph &> /dev/null; then
        print_info "Trying Azure Resource Graph query..."
        
        GRAPH_RESULT=$(az graph query -q "Resources | where type == 'microsoft.documentdb/databaseaccounts' and name == '$COSMOS_ACCOUNT_NAME' | project name, resourceGroup" --query "data[0].resourceGroup" -o tsv 2>/dev/null)
        
        if [ -n "$GRAPH_RESULT" ] && [ "$GRAPH_RESULT" != "null" ]; then
            RESOURCE_GROUP="$GRAPH_RESULT"
            print_success "Found resource group using Resource Graph: $RESOURCE_GROUP"
        fi
    fi
    
    # If still not found, prompt user or show available options
    if [ -z "$RESOURCE_GROUP" ]; then
        print_error "Could not automatically determine the resource group for Cosmos DB account '$COSMOS_ACCOUNT_NAME'"
        echo
        print_info "Available options:"
        echo "1. Add COSMOS_RESOURCE_GROUP=<your-resource-group> to your .env file"
        echo "2. Check available Cosmos DB accounts in your subscription:"
        
        print_info "Listing all Cosmos DB accounts in current subscription:"
        az cosmosdb list --query "[].{name:name, resourceGroup:resourceGroup, location:location}" -o table 2>/dev/null || {
            print_warning "Could not list Cosmos DB accounts. You may not have sufficient permissions."
            echo
            print_info "You can find your resource group in the Azure Portal:"
            echo "https://portal.azure.com -> Cosmos DB -> $COSMOS_ACCOUNT_NAME -> Overview"
        }
        
        echo
        print_info "Once you know the resource group, add it to your .env file:"
        echo "COSMOS_RESOURCE_GROUP=your-actual-resource-group-name"
        
        exit 1
    fi
    
    # Construct the resource identifiers for reference
    print_info "Cosmos DB Account: $COSMOS_ACCOUNT_NAME in Resource Group: $RESOURCE_GROUP"
    
    # Get the built-in Cosmos DB Data Contributor role definition ID
    print_info "Getting 'Cosmos DB Built-in Data Contributor' role definition..."
    
    ROLE_DEFINITION_ID=""
    if ROLE_DEF_OUTPUT=$(az cosmosdb sql role definition list \
        --resource-group "$RESOURCE_GROUP" \
        --account-name "$COSMOS_ACCOUNT_NAME" \
        --query "[?roleName=='Cosmos DB Built-in Data Contributor'].id" \
        -o tsv 2>&1); then
        
        ROLE_DEFINITION_ID="$ROLE_DEF_OUTPUT"
        if [ -n "$ROLE_DEFINITION_ID" ]; then
            print_success "Found built-in role definition: $ROLE_DEFINITION_ID"
            
            # Extract just the GUID portion for the assignment (Git Bash path conversion issue workaround)
            ROLE_GUID=$(echo "$ROLE_DEFINITION_ID" | grep -o '[0-9a-f\-]*$' | tail -1)
            if [ -n "$ROLE_GUID" ]; then
                print_info "Using role GUID for assignment: $ROLE_GUID"
            else
                print_error "Could not extract GUID from role definition ID"
                exit 1
            fi
        else
            print_error "Could not find 'Cosmos DB Built-in Data Contributor' role definition"
            print_info "This role should exist by default. Checking available roles..."
            
            if az cosmosdb sql role definition list \
                --resource-group "$RESOURCE_GROUP" \
                --account-name "$COSMOS_ACCOUNT_NAME" \
                --query "[].{RoleName:roleName, Type:typePropertiesType}" \
                -o table 2>/dev/null; then
                echo
            fi
            exit 1
        fi
    else
        print_error "Failed to list Cosmos DB role definitions. Error: $ROLE_DEF_OUTPUT"
        print_info "This could indicate:"
        echo "  - The Cosmos DB account doesn't exist or is inaccessible"
        echo "  - You don't have sufficient permissions"
        echo "  - The account name or resource group is incorrect"
        exit 1
    fi
    
    # Check existing role assignments using Cosmos DB specific commands
    print_info "Checking for existing role assignments..."
    
    EXISTING_ASSIGNMENT=""
    if ASSIGNMENT_CHECK=$(az cosmosdb sql role assignment list \
        --resource-group "$RESOURCE_GROUP" \
        --account-name "$COSMOS_ACCOUNT_NAME" \
        --query "[?principalId=='$USER_ID' && (roleDefinitionId=='$ROLE_DEFINITION_ID' || roleDefinitionId=='$ROLE_GUID')].id" \
        -o tsv 2>&1); then
        
        EXISTING_ASSIGNMENT="$ASSIGNMENT_CHECK"
        if [ -n "$EXISTING_ASSIGNMENT" ]; then
            print_success "✅ Role assignment already exists: $EXISTING_ASSIGNMENT"
            print_info "No action needed - permissions are already configured correctly"
        else
            print_info "No existing role assignment found - will create one"
        fi
    else
        print_warning "Could not check existing role assignments. Error: $ASSIGNMENT_CHECK"
        print_info "Will attempt to create the assignment anyway..."
    fi
    
    if [ -z "$EXISTING_ASSIGNMENT" ]; then
        # Create the role assignment using Cosmos DB specific command
        print_info "Creating Cosmos DB role assignment..."
        
        # Generate a unique GUID for the role assignment
        ASSIGNMENT_ID=$(uuidgen 2>/dev/null || python3 -c "import uuid; print(str(uuid.uuid4()))" 2>/dev/null || date +%s | md5sum | cut -c1-32)
        
        if [ "$DRY_RUN" = true ]; then
            print_info "Would execute: az cosmosdb sql role assignment create"
            print_info "  --resource-group $RESOURCE_GROUP"
            print_info "  --account-name $COSMOS_ACCOUNT_NAME"
            print_info "  --role-definition-id $ROLE_GUID"
            print_info "  --principal-id $USER_ID"
            print_info "  --scope /"
        else
            # Use MSYS_NO_PATHCONV to prevent Git Bash from converting Unix paths on Windows
            if ASSIGNMENT_OUTPUT=$(MSYS_NO_PATHCONV=1 az cosmosdb sql role assignment create \
                --resource-group "$RESOURCE_GROUP" \
                --account-name "$COSMOS_ACCOUNT_NAME" \
                --role-definition-id "$ROLE_GUID" \
                --principal-id "$USER_ID" \
                --scope "/" 2>&1); then
                
                print_success "✅ Successfully created Cosmos DB role assignment"
                
                # Wait for propagation
                print_info "Waiting for role assignment to propagate (5 seconds)..."
                sleep 5
                
            else
                print_error "Failed to create role assignment. Error details:"
                echo "$ASSIGNMENT_OUTPUT"
                echo
                print_info "Common causes and solutions:"
                echo "1. Insufficient permissions - You need 'Cosmos DB Operator' role or equivalent"
                echo "2. Role assignment already exists with different ID"
                echo "3. Account configuration issue"
                echo
                print_info "You can assign the role manually through Azure Portal:"
                echo "1. Go to https://portal.azure.com"
                echo "2. Navigate to your Cosmos DB account: $COSMOS_ACCOUNT_NAME"
                echo "3. Go to Data Explorer -> Access Control (IAM)"
                echo "4. Add role assignment -> Cosmos DB Built-in Data Contributor"
                echo "5. Assign to: $USER_EMAIL"
                echo ""
                print_info "Alternatively, you can try this command from PowerShell or Command Prompt:"
                echo "az cosmosdb sql role assignment create --resource-group $RESOURCE_GROUP --account-name $COSMOS_ACCOUNT_NAME --role-definition-id $ROLE_GUID --principal-id $USER_ID --scope /"
                echo
                print_info "To check your current permissions on this Cosmos DB account:"
                echo "az cosmosdb show --name $COSMOS_ACCOUNT_NAME --resource-group $RESOURCE_GROUP"
                exit 1
            fi
        fi
    fi
    
    # Final verification using Cosmos DB commands
    if [ "$DRY_RUN" = false ]; then
        print_info "Verifying final role assignments..."
        
        if FINAL_ASSIGNMENTS=$(az cosmosdb sql role assignment list \
            --resource-group "$RESOURCE_GROUP" \
            --account-name "$COSMOS_ACCOUNT_NAME" \
            --query "[?principalId=='$USER_ID'].{RoleDefinitionId:roleDefinitionId, Scope:scope, Id:id}" \
            -o table 2>&1); then
            
            echo "$FINAL_ASSIGNMENTS"
            print_success "✅ Role assignment verification completed"
        else
            print_warning "Could not verify final assignments: $FINAL_ASSIGNMENTS"
        fi
    fi
    
    echo
    print_header "🎉 Setup Complete!"
    
    if [ "$DRY_RUN" = false ]; then
        echo -e "${GREEN}Your Azure identity now has Cosmos DB data plane access permissions.${NC}"
        echo
        echo -e "${BLUE}Next steps:${NC}"
        echo "1. Run: npm run build"
        echo "2. Run: npm run start:insert-at-scale"
        echo
        echo -e "${BLUE}Configuration summary:${NC}"
        echo "• Cosmos DB Account: $COSMOS_ACCOUNT_NAME"
        echo "• Resource Group: $RESOURCE_GROUP"
        echo "• User: $USER_EMAIL"
        echo "• Role: Cosmos DB Built-in Data Contributor (Data Plane Access)"
        echo "• Scope: Account-wide access to all databases and containers"
    else
        echo -e "${YELLOW}This was a dry run. Use the script without --dry-run to apply changes.${NC}"
    fi
}

# Error handling
trap 'print_error "Script failed on line $LINENO"' ERR

# Run main function
main "$@"