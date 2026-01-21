#!/bin/bash

# Azure CLI Script for Cosmos DB NoSQL Vector Search Setup
# This script creates all required Azure resources with managed identity and proper RBAC roles
# for both control plane and data plane access to Cosmos DB and Azure OpenAI

set -e  # Exit on any error

# ============================================
# Configuration Variables
# ============================================

# User Principal (set to your Azure AD user principal)
USER_PRINCIPAL=${USER_PRINCIPAL:-"diberry@microsoft.com"}

# Resource naming
RESOURCE_PREFIX=${RESOURCE_PREFIX:-"cosmosdb-vector"}
LOCATION=${LOCATION:-"eastus"}
RESOURCE_GROUP="${RESOURCE_PREFIX}-rg"

# Cosmos DB configuration
COSMOS_ACCOUNT_NAME="${RESOURCE_PREFIX}-cosmos-$(openssl rand -hex 4)"
COSMOS_DATABASE_NAME="Hotels"
COSMOS_CONTAINER_NAME="hotels"

# Azure OpenAI configuration
OPENAI_ACCOUNT_NAME="${RESOURCE_PREFIX}-openai-$(openssl rand -hex 4)"
OPENAI_DEPLOYMENT_NAME="text-embedding-3-small"
OPENAI_MODEL="text-embedding-3-small"
OPENAI_MODEL_VERSION="2"

# Managed Identity configuration
MANAGED_IDENTITY_NAME="${RESOURCE_PREFIX}-identity"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ============================================
# Helper Functions
# ============================================

print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_section() {
    echo ""
    echo "========================================"
    echo "$1"
    echo "========================================"
    echo ""
}

# ============================================
# Main Script
# ============================================

print_section "Starting Azure Resource Provisioning"

# Get current user object ID
print_status "Getting current user object ID for: $USER_PRINCIPAL"
USER_OBJECT_ID=$(az ad user show --id "$USER_PRINCIPAL" --query id -o tsv)
if [ -z "$USER_OBJECT_ID" ]; then
    print_error "Failed to get user object ID. Please verify the user principal: $USER_PRINCIPAL"
    exit 1
fi
print_status "User Object ID: $USER_OBJECT_ID"

# ============================================
# Resource Group
# ============================================

print_section "Creating Resource Group"
az group create \
    --name "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --output none

print_status "Resource Group created: $RESOURCE_GROUP"

# ============================================
# User-Assigned Managed Identity
# ============================================

print_section "Creating User-Assigned Managed Identity"
az identity create \
    --name "$MANAGED_IDENTITY_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --output none

# Get Managed Identity details
IDENTITY_PRINCIPAL_ID=$(az identity show --name "$MANAGED_IDENTITY_NAME" --resource-group "$RESOURCE_GROUP" --query principalId -o tsv)
IDENTITY_CLIENT_ID=$(az identity show --name "$MANAGED_IDENTITY_NAME" --resource-group "$RESOURCE_GROUP" --query clientId -o tsv)
IDENTITY_ID=$(az identity show --name "$MANAGED_IDENTITY_NAME" --resource-group "$RESOURCE_GROUP" --query id -o tsv)

print_status "Managed Identity created: $MANAGED_IDENTITY_NAME"
print_status "Principal ID: $IDENTITY_PRINCIPAL_ID"
print_status "Client ID: $IDENTITY_CLIENT_ID"

# ============================================
# Azure Cosmos DB Account
# ============================================

print_section "Creating Azure Cosmos DB Account (NoSQL API)"
print_status "This may take 5-10 minutes..."

az cosmosdb create \
    --name "$COSMOS_ACCOUNT_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --kind GlobalDocumentDB \
    --default-consistency-level Session \
    --enable-automatic-failover false \
    --enable-multiple-write-locations false \
    --output none

print_status "Cosmos DB Account created: $COSMOS_ACCOUNT_NAME"

# Get Cosmos DB Account details
COSMOS_ENDPOINT=$(az cosmosdb show --name "$COSMOS_ACCOUNT_NAME" --resource-group "$RESOURCE_GROUP" --query documentEndpoint -o tsv)
COSMOS_RESOURCE_ID=$(az cosmosdb show --name "$COSMOS_ACCOUNT_NAME" --resource-group "$RESOURCE_GROUP" --query id -o tsv)

print_status "Cosmos DB Endpoint: $COSMOS_ENDPOINT"

# ============================================
# Cosmos DB RBAC Roles
# ============================================

print_section "Configuring Cosmos DB RBAC Roles"

# Cosmos DB has custom RBAC roles for data plane access
# Built-in roles:
# - Cosmos DB Built-in Data Reader (00000000-0000-0000-0000-000000000001)
# - Cosmos DB Built-in Data Contributor (00000000-0000-0000-0000-000000000002)

print_status "Assigning Cosmos DB Built-in Data Contributor role to user..."
az cosmosdb sql role assignment create \
    --account-name "$COSMOS_ACCOUNT_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --role-definition-id "00000000-0000-0000-0000-000000000002" \
    --principal-id "$USER_OBJECT_ID" \
    --scope "$COSMOS_RESOURCE_ID" \
    --output none

print_status "Assigned Cosmos DB Data Contributor to user"

print_status "Assigning Cosmos DB Built-in Data Contributor role to managed identity..."
az cosmosdb sql role assignment create \
    --account-name "$COSMOS_ACCOUNT_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --role-definition-id "00000000-0000-0000-0000-000000000002" \
    --principal-id "$IDENTITY_PRINCIPAL_ID" \
    --scope "$COSMOS_RESOURCE_ID" \
    --output none

print_status "Assigned Cosmos DB Data Contributor to managed identity"

# Control plane access (for managing databases, containers, etc.)
print_status "Assigning Cosmos DB Account Contributor role to user (control plane)..."
az role assignment create \
    --assignee "$USER_OBJECT_ID" \
    --role "DocumentDB Account Contributor" \
    --scope "$COSMOS_RESOURCE_ID" \
    --output none

print_status "Assigned DocumentDB Account Contributor to user"

# ============================================
# Create Cosmos DB Database and Container
# ============================================

print_section "Creating Cosmos DB Database and Container"

print_status "Creating database: $COSMOS_DATABASE_NAME"
az cosmosdb sql database create \
    --account-name "$COSMOS_ACCOUNT_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --name "$COSMOS_DATABASE_NAME" \
    --output none

print_status "Creating container: $COSMOS_CONTAINER_NAME"
# Note: Vector indexing policy will be set by the application code
az cosmosdb sql container create \
    --account-name "$COSMOS_ACCOUNT_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --database-name "$COSMOS_DATABASE_NAME" \
    --name "$COSMOS_CONTAINER_NAME" \
    --partition-key-path "/HotelId" \
    --throughput 400 \
    --output none

print_status "Container created successfully"

# ============================================
# Azure OpenAI Account
# ============================================

print_section "Creating Azure OpenAI Account"

# Check if Azure OpenAI is available in the location
print_status "Creating Azure OpenAI account: $OPENAI_ACCOUNT_NAME"

az cognitiveservices account create \
    --name "$OPENAI_ACCOUNT_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --kind OpenAI \
    --sku S0 \
    --custom-domain "$OPENAI_ACCOUNT_NAME" \
    --output none

print_status "Azure OpenAI Account created: $OPENAI_ACCOUNT_NAME"

# Get OpenAI Account details
OPENAI_ENDPOINT=$(az cognitiveservices account show --name "$OPENAI_ACCOUNT_NAME" --resource-group "$RESOURCE_GROUP" --query properties.endpoint -o tsv)
OPENAI_RESOURCE_ID=$(az cognitiveservices account show --name "$OPENAI_ACCOUNT_NAME" --resource-group "$RESOURCE_GROUP" --query id -o tsv)

print_status "Azure OpenAI Endpoint: $OPENAI_ENDPOINT"

# ============================================
# Azure OpenAI RBAC Roles
# ============================================

print_section "Configuring Azure OpenAI RBAC Roles"

print_status "Assigning Cognitive Services OpenAI User role to user..."
az role assignment create \
    --assignee "$USER_OBJECT_ID" \
    --role "Cognitive Services OpenAI User" \
    --scope "$OPENAI_RESOURCE_ID" \
    --output none

print_status "Assigned Cognitive Services OpenAI User to user"

print_status "Assigning Cognitive Services OpenAI User role to managed identity..."
az role assignment create \
    --assignee "$IDENTITY_PRINCIPAL_ID" \
    --role "Cognitive Services OpenAI User" \
    --scope "$OPENAI_RESOURCE_ID" \
    --output none

print_status "Assigned Cognitive Services OpenAI User to managed identity"

# ============================================
# Deploy Azure OpenAI Model
# ============================================

print_section "Deploying Azure OpenAI Embedding Model"

print_status "Deploying model: $OPENAI_MODEL (version $OPENAI_MODEL_VERSION)"
print_status "Deployment name: $OPENAI_DEPLOYMENT_NAME"

az cognitiveservices account deployment create \
    --name "$OPENAI_ACCOUNT_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --deployment-name "$OPENAI_DEPLOYMENT_NAME" \
    --model-name "$OPENAI_MODEL" \
    --model-version "$OPENAI_MODEL_VERSION" \
    --model-format OpenAI \
    --sku-name "Standard" \
    --sku-capacity 10 \
    --output none

print_status "Model deployment created successfully"

# ============================================
# Wait for RBAC propagation
# ============================================

print_section "Waiting for RBAC Propagation"
print_status "Waiting 60 seconds for RBAC role assignments to propagate..."
sleep 60

# ============================================
# Verify Access
# ============================================

print_section "Verifying Access"

print_status "Verifying Cosmos DB access..."
# Try to list databases
if az cosmosdb sql database list --account-name "$COSMOS_ACCOUNT_NAME" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
    print_status "✓ Cosmos DB access verified (control plane)"
else
    print_warning "✗ Cosmos DB control plane access verification failed. This may take a few more minutes to propagate."
fi

print_status "Verifying Azure OpenAI access..."
# Try to list deployments
if az cognitiveservices account deployment list --name "$OPENAI_ACCOUNT_NAME" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
    print_status "✓ Azure OpenAI access verified"
else
    print_warning "✗ Azure OpenAI access verification failed. This may take a few more minutes to propagate."
fi

# ============================================
# Output Configuration
# ============================================

print_section "Resource Provisioning Complete!"

echo ""
echo "=================================================="
echo "ENVIRONMENT CONFIGURATION"
echo "=================================================="
echo ""
echo "# Azure Cosmos DB Configuration"
echo "COSMOS_ENDPOINT=\"$COSMOS_ENDPOINT\""
echo "COSMOS_DATABASE_NAME=\"$COSMOS_DATABASE_NAME\""
echo "COSMOS_CONTAINER_NAME=\"$COSMOS_CONTAINER_NAME\""
echo ""
echo "# Azure OpenAI Configuration"
echo "AZURE_OPENAI_EMBEDDING_ENDPOINT=\"$OPENAI_ENDPOINT\""
echo "AZURE_OPENAI_EMBEDDING_MODEL=\"$OPENAI_DEPLOYMENT_NAME\""
echo "AZURE_OPENAI_EMBEDDING_API_VERSION=\"2023-05-15\""
echo ""
echo "# Managed Identity Configuration"
echo "AZURE_CLIENT_ID=\"$IDENTITY_CLIENT_ID\""
echo ""
echo "# Data Configuration"
echo "DATA_FILE_WITH_VECTORS=\"../data/HotelsData_toCosmosDB_Vector.json\""
echo "EMBEDDED_FIELD=\"vector\""
echo "EMBEDDING_DIMENSIONS=\"1536\""
echo "LOAD_SIZE_BATCH=\"50\""
echo ""
echo "=================================================="
echo "RESOURCE DETAILS"
echo "=================================================="
echo ""
echo "Resource Group: $RESOURCE_GROUP"
echo "Location: $LOCATION"
echo ""
echo "Cosmos DB Account: $COSMOS_ACCOUNT_NAME"
echo "Cosmos DB Endpoint: $COSMOS_ENDPOINT"
echo "Database: $COSMOS_DATABASE_NAME"
echo "Container: $COSMOS_CONTAINER_NAME"
echo ""
echo "Azure OpenAI Account: $OPENAI_ACCOUNT_NAME"
echo "Azure OpenAI Endpoint: $OPENAI_ENDPOINT"
echo "Model Deployment: $OPENAI_DEPLOYMENT_NAME"
echo ""
echo "Managed Identity: $MANAGED_IDENTITY_NAME"
echo "Identity Client ID: $IDENTITY_CLIENT_ID"
echo "Identity Principal ID: $IDENTITY_PRINCIPAL_ID"
echo ""
echo "=================================================="
echo "RBAC ROLES ASSIGNED"
echo "=================================================="
echo ""
echo "User Principal ($USER_PRINCIPAL):"
echo "  - Cosmos DB Built-in Data Contributor (data plane)"
echo "  - DocumentDB Account Contributor (control plane)"
echo "  - Cognitive Services OpenAI User"
echo ""
echo "Managed Identity ($MANAGED_IDENTITY_NAME):"
echo "  - Cosmos DB Built-in Data Contributor (data plane)"
echo "  - Cognitive Services OpenAI User"
echo ""
echo "=================================================="
echo "NEXT STEPS"
echo "=================================================="
echo ""
echo "1. Copy the environment configuration above to your .env file"
echo ""
echo "2. Authenticate with Azure CLI:"
echo "   az login"
echo ""
echo "3. Run the sample application:"
echo "   cd nosql-vector-search-typescript"
echo "   npm install"
echo "   npm run build"
echo "   npm run start:diskann"
echo ""
echo "=================================================="
echo ""

print_warning "Note: RBAC role assignments may take up to 5 minutes to fully propagate."
print_warning "If you encounter authentication errors, wait a few minutes and try again."
echo ""
