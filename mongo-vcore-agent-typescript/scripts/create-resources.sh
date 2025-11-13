#!/bin/bash
# chmod +x create-resources.sh
# az login --use-device-code
# az account list --query "[].{name:name}" -o table
# az account list-locations --query "[].name" -o tsv

# usage: ./create-resources.sh <resource-group-name> <location>
# example: ./create-resources.sh "langchain-agent" "swedencentral"
# This script creates an Azure resource group and an Azure AI resource, retrieves keys, and deploys models.
#
# ========================================
# RECOMMENDED REGIONS (good availability for OpenAI + MongoDB vCore)
# ========================================
# Try these regions if you encounter quota issues:
#   1. swedencentral  (Best: Good capacity, newer region)
#   2. eastus2        (Good: Large capacity)
#   3. westus3        (Good: Newer region with capacity)
#   4. northcentralus (Alternative: Good availability)
#   5. southcentralus (Alternative: Good availability)
#   6. canadaeast     (Alternative: Good availability)
#   7. francecentral  (EU option)
#   8. uksouth        (EU option)
#
# AVOID if quota constrained: eastus, westus, westus2, westeurope (often at capacity)
# ========================================

# ========================================
# COST OPTIMIZATION NOTES
# ========================================
# This script is configured with MINIMAL tiers by default to reduce costs:
#
# Azure OpenAI:
#   - SKU: S0 (Standard, pay-as-you-go)
#   - To use FREE tier: Change OPENAI_SKU="F0" (limited to 1 per subscription)
#   - Model Capacity: 1 (minimum, adjust based on throughput needs)
#
# MongoDB vCore:
#   - Tier: M25 (smallest, 2 vCores, 8GB RAM) - good for dev/test
#   - Storage: 32GB (minimum)
#   - High Availability: Disabled
#   - Shards: 1 (minimum)
#
# For production workloads, increase:
#   - EMBEDDING_CAPACITY and LLM_CAPACITY (1-100)
#   - MONGO_TIER (M30, M40, M50, M60, M80)
#   - MONGO_STORAGE_GB (32-2048)
# ========================================

# Exit on error
set -e

# Check if the user is logged into Azure
if ! az account show > /dev/null 2>&1; then
  echo "You are not logged into Azure. Please run 'az login' to log in."
  exit 1
fi
echo "Logged into Azure."

# Check for required arguments
if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <resource-group-name> <location>"
  exit 1
fi
# Input parameters
RESOURCE_GROUP_NAME_BASE=$1
LOCATION=$2
echo "Arguments provided: $1 $2"

# Validate and suggest regions
echo ""
echo "📍 Checking region: $LOCATION"
RECOMMENDED_REGIONS=("swedencentral" "eastus2" "westus3" "northcentralus" "southcentralus" "canadaeast" "francecentral" "uksouth")
RECOMMENDED=false
for region in "${RECOMMENDED_REGIONS[@]}"; do
  if [ "$LOCATION" == "$region" ]; then
    RECOMMENDED=true
    break
  fi
done

if [ "$RECOMMENDED" = true ]; then
  echo "✅ Good choice! $LOCATION typically has good quota availability."
else
  echo "⚠️  Warning: $LOCATION may have quota constraints."
  echo "💡 Recommended regions with better availability:"
  echo "   - swedencentral (Best)"
  echo "   - eastus2"
  echo "   - westus3"
  echo "   - northcentralus"
  echo "   - canadaeast"
  echo ""
  read -p "Continue with $LOCATION? (y/n): " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Exiting. Please re-run with a different region."
    exit 1
  fi
fi
echo ""

# Retrieve the subscription ID from the current Azure account
SUBSCRIPTION_ID=$(az account show --query "id" -o tsv)
echo "Subscription ID: $SUBSCRIPTION_ID"

# Generate a random 6-character string
RANDOM_SUFFIX=$(openssl rand -hex 3)
echo "Random suffix: $RANDOM_SUFFIX"

# Append the random string to the resource group name
RESOURCE_GROUP_NAME="${RESOURCE_GROUP_NAME_BASE}-${RANDOM_SUFFIX}"
echo "Resource group name: $RESOURCE_GROUP_NAME"

# Variables
AZURE_AI_RESOURCE_NAME="azure-ai-resource-${RANDOM_SUFFIX}"
OPENAI_RESOURCE_NAME="openai-resource-${RANDOM_SUFFIX}"
COSMOS_MONGO_CLUSTER_NAME="cosmos-mongo-${RANDOM_SUFFIX}"
COSMOS_MONGO_ADMIN_USER="adminuser"
COSMOS_MONGO_ADMIN_PASSWORD="SecurePassword123!"
TEXT_EMBEDDING_DEPLOYMENT_NAME="text-embedding-ada-002"
LLM_DEPLOYMENT_NAME="gpt-4o"
API_VERSION="2025-01-01-preview"

# SKU Configuration - Use minimal tiers for cost savings
# Azure OpenAI: F0 (Free tier, limited to 1 per subscription) or S0 (Standard)
# To use free tier, change to: OPENAI_SKU="F0"
OPENAI_SKU="S0"

# Model Capacity - Lower capacity = lower cost
# Minimum capacity is 1 for Standard tier
EMBEDDING_CAPACITY="1"   # Lower from 8 to 1
LLM_CAPACITY="1"         # Lower from 10 to 1

# MongoDB vCore Tier - M25 is the smallest available tier
# Options: M25 (smallest), M30, M40, M50, M60, M80
# Note: M25 = 2 vCores, 8GB RAM, suitable for dev/test
MONGO_TIER="M25"
MONGO_STORAGE_GB="32"    # Lower from 128 to 32 (minimum)
MONGO_SHARD_COUNT="1"    # Keep at 1 shard

az config set extension.use_dynamic_install=yes_without_promp

# Set the subscription
az account set --subscription "$SUBSCRIPTION_ID"

# Create the resource group
echo "Creating resource group: $RESOURCE_GROUP_NAME in $LOCATION..."
az group create --location $LOCATION --resource-group $RESOURCE_GROUP_NAME

# Create the OpenAI resource
echo "Creating OpenAI resource: $OPENAI_RESOURCE_NAME..."
echo "Using SKU: $OPENAI_SKU (F0=Free tier with limits, S0=Standard pay-as-you-go)"
az cognitiveservices account create \
  --name "$OPENAI_RESOURCE_NAME" \
  --resource-group "$RESOURCE_GROUP_NAME" \
  --kind OpenAI \
  --sku "$OPENAI_SKU" \
  --location "$LOCATION"

# Get the current user's object ID for RBAC assignments
USER_OBJECT_ID=$(az ad signed-in-user show --query "id" -o tsv)
echo "Current user object ID: $USER_OBJECT_ID"

# Assign RBAC roles for OpenAI resource
echo "Assigning RBAC roles for OpenAI resource..."

# Cognitive Services OpenAI Contributor role for Assistants use case
echo "Assigning Cognitive Services OpenAI Contributor role..."
az role assignment create \
  --assignee "$USER_OBJECT_ID" \
  --role "a001fd3d-188f-4b5d-821b-7da978bf7442" \
  --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP_NAME/providers/Microsoft.CognitiveServices/accounts/$OPENAI_RESOURCE_NAME" \
  --only-show-errors

# Cognitive Services OpenAI User role for Chat completions use case
echo "Assigning Cognitive Services OpenAI User role..."
az role assignment create \
  --assignee "$USER_OBJECT_ID" \
  --role "5e0bd9bd-7b93-4f28-af87-19fc36ad61bd" \
  --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP_NAME/providers/Microsoft.CognitiveServices/accounts/$OPENAI_RESOURCE_NAME" \
  --only-show-errors

echo "Waiting for role assignments to propagate..."
sleep 30

# Retrieve the OpenAI key
OPENAI_KEY=$(az cognitiveservices account keys list \
  --name "$OPENAI_RESOURCE_NAME" \
  --resource-group "$RESOURCE_GROUP_NAME" \
  --query "key1" -o tsv)

# # Deploy the text embedding model
echo "Deploying text embedding model: $TEXT_EMBEDDING_DEPLOYMENT_NAME..."
echo "Using minimal capacity: $EMBEDDING_CAPACITY (1 = lowest cost)"
az cognitiveservices account deployment create \
  --name "$OPENAI_RESOURCE_NAME" \
  --resource-group "$RESOURCE_GROUP_NAME" \
  --deployment-name "$TEXT_EMBEDDING_DEPLOYMENT_NAME" \
  --model-name "$TEXT_EMBEDDING_DEPLOYMENT_NAME" \
  --model-format "OpenAI" \
  --model-version "2" \
  --capacity "$EMBEDDING_CAPACITY" \
  --sku "Standard"

# Deploy the LLM model
echo "Deploying LLM model: $LLM_DEPLOYMENT_NAME..."
echo "Using minimal capacity: $LLM_CAPACITY (1 = lowest cost)"
az cognitiveservices account deployment create \
  --name "$OPENAI_RESOURCE_NAME" \
  --resource-group "$RESOURCE_GROUP_NAME" \
  --deployment-name "$LLM_DEPLOYMENT_NAME" \
  --model-name "$LLM_DEPLOYMENT_NAME" \
  --model-format "OpenAI" \
  --model-version "2024-05-13" \
  --capacity "$LLM_CAPACITY" \
  --sku "Standard"

# Create Cosmos DB MongoDB vCore cluster
echo "Creating Cosmos DB MongoDB vCore cluster: $COSMOS_MONGO_CLUSTER_NAME..."
echo "Using minimal tier: $MONGO_TIER (M25 = smallest tier, 2 vCores, 8GB RAM)"
echo "Storage: ${MONGO_STORAGE_GB}GB (minimum for cost savings)"
az cosmosdb mongocluster create \
  --cluster-name "$COSMOS_MONGO_CLUSTER_NAME" \
  --resource-group "$RESOURCE_GROUP_NAME" \
  --location "$LOCATION" \
  --administrator-login "$COSMOS_MONGO_ADMIN_USER" \
  --administrator-login-password "$COSMOS_MONGO_ADMIN_PASSWORD" \
  --server-version "5.0" \
  --shard-node-tier "$MONGO_TIER" \
  --shard-node-ha false \
  --shard-node-disk-size-gb "$MONGO_STORAGE_GB" \
  --shard-node-count "$MONGO_SHARD_COUNT"

echo "Waiting for Cosmos DB MongoDB vCore cluster to be ready..."
# Wait for the cluster to be provisioned (can take 5-10 minutes)
MAX_RETRIES=60
RETRY_COUNT=0
while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  PROVISIONING_STATE=$(az cosmosdb mongocluster show \
    --cluster-name "$COSMOS_MONGO_CLUSTER_NAME" \
    --resource-group "$RESOURCE_GROUP_NAME" \
    --query "properties.provisioningState" -o tsv 2>/dev/null)
  
  CLUSTER_STATUS=$(az cosmosdb mongocluster show \
    --cluster-name "$COSMOS_MONGO_CLUSTER_NAME" \
    --resource-group "$RESOURCE_GROUP_NAME" \
    --query "properties.clusterStatus" -o tsv 2>/dev/null)
  
  # Check if provisioning succeeded
  if [ "$PROVISIONING_STATE" = "Succeeded" ]; then
    echo "✅ Cluster provisioning completed successfully!"
    echo "Cluster status: $CLUSTER_STATUS"
    break
  fi
  
  # Check for failed state
  if [ "$PROVISIONING_STATE" = "Failed" ]; then
    echo "❌ Cluster provisioning failed!"
    echo "Please check the Azure portal for error details."
    exit 1
  fi
  
  echo "Current state: $PROVISIONING_STATE | Cluster status: $CLUSTER_STATUS | Waiting... ($((RETRY_COUNT + 1))/$MAX_RETRIES)"
  sleep 10
  RETRY_COUNT=$((RETRY_COUNT + 1))
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
  echo "⚠️  Warning: Wait loop timed out, checking final state..."
  FINAL_STATE=$(az cosmosdb mongocluster show \
    --cluster-name "$COSMOS_MONGO_CLUSTER_NAME" \
    --resource-group "$RESOURCE_GROUP_NAME" \
    --query "properties.provisioningState" -o tsv 2>/dev/null)
  
  if [ "$FINAL_STATE" = "Succeeded" ]; then
    echo "✅ Cluster is actually ready! Continuing..."
  else
    echo "❌ Error: Cluster provisioning timed out after $((MAX_RETRIES * 10)) seconds"
    echo "Final provisioning state: $FINAL_STATE"
    exit 1
  fi
fi

# Patch MongoDB vCore cluster to enable RBAC (Microsoft Entra ID authentication)
echo "Enabling RBAC authentication for MongoDB vCore cluster..."
az resource patch \
  --resource-group "$RESOURCE_GROUP_NAME" \
  --name "$COSMOS_MONGO_CLUSTER_NAME" \
  --resource-type "Microsoft.DocumentDB/mongoClusters" \
  --properties "{\"authConfig\":{\"allowedModes\":[\"MicrosoftEntraID\",\"NativeAuth\"]}}" \
  --latest-include-preview

# Add current user to MongoDB vCore cluster with root access
echo "Adding current user to MongoDB vCore cluster with root access..."
az resource create \
  --resource-group "$RESOURCE_GROUP_NAME" \
  --name "$COSMOS_MONGO_CLUSTER_NAME/users/$USER_OBJECT_ID" \
  --resource-type "Microsoft.DocumentDB/mongoClusters/users" \
  --location "$LOCATION" \
  --properties "{\"identityProvider\":{\"type\":\"MicrosoftEntraID\",\"properties\":{\"principalType\":\"User\"}},\"roles\":[{\"db\":\"admin\",\"role\":\"root\"}]}" \
  --latest-include-preview

# Get Cosmos DB MongoDB connection string
echo "Retrieving Cosmos DB MongoDB connection details..."
COSMOS_MONGO_CONNECTION_STRING=$(az cosmosdb mongocluster show \
  --cluster-name "$COSMOS_MONGO_CLUSTER_NAME" \
  --resource-group "$RESOURCE_GROUP_NAME" \
  --query "connectionString" -o tsv)

# Create the .env file
ENV_FILE=".env"
echo "Creating .env file..."
cat <<EOL > $ENV_FILE
DEBUG=true
USE_PASSWORDLESS="true"

# ========================================
# Azure OpenAI Shared Settings
# ========================================
AZURE_OPENAI_API_KEY="$OPENAI_KEY"
AZURE_OPENAI_ENDPOINT="https://$OPENAI_RESOURCE_NAME.openai.azure.com/"

# ========================================
# Azure OpenAI Embedding Model Settings
# ========================================
AZURE_OPENAI_EMBEDDING_MODEL="$TEXT_EMBEDDING_DEPLOYMENT_NAME"
AZURE_OPENAI_EMBEDDING_API_VERSION="2023-05-15"

# ========================================
# Azure OpenAI Chat/Completions Model Settings
# ========================================
AZURE_OPENAI_CHAT_MODEL="$LLM_DEPLOYMENT_NAME"
AZURE_OPENAI_CHAT_API_VERSION="2024-02-15-preview"

# ========================================
# Data File Paths and Vector Configuration
# ========================================
DATA_FILE_WITHOUT_VECTORS="../data/HotelsData_toCosmosDB.JSON"
DATA_FILE_WITH_VECTORS="../data/HotelsData_toCosmosDB_Vector.json"
DATA_FILE_WITH_SIMILARITY="../data/HotelsData_toCosmosDB_Vector_Similarity.json"
QUERY_FILE_WITH_VECTORS="../data/HotelsData_Query_Vector.json"
DATA_FOLDER="../data/"
FIELD_TO_EMBED="Description"
EMBEDDED_FIELD="text_embedding_ada_002"
EMBEDDING_DIMENSIONS="1536"

# ========================================
# Embedding Creation Settings
# ========================================
EMBEDDING_BATCH_SIZE="16"
EMBEDDING_SIZE_BATCH="16"

# ========================================
# Data Loading and Processing Settings
# ========================================
LOAD_SIZE_BATCH="100"

# ========================================
# MongoDB/Cosmos DB Connection Settings
# ========================================
MONGO_CONNECTION_STRING="$COSMOS_MONGO_CONNECTION_STRING"
MONGO_CLUSTER_NAME="$COSMOS_MONGO_CLUSTER_NAME"
MONGO_DB_NAME="Hotels26"

# ========================================
# Agent Search Configuration
# ========================================
MAX_SEARCH_RESULTS="5"
SIMILARITY_THRESHOLD="0.7"

# ========================================
# Optional Settings
# ========================================
LANGSMITH_TRACING="false"
LANGSMITH_ENDPOINT="https://api.smith.langchain.com"
LANGSMITH_API_KEY=""
LANGSMITH_PROJECT=""
EOL

echo ".env file created successfully."

echo ""
echo "🎉 Resource creation completed successfully!"
echo "=============================================="
echo "📋 Resources Created:"
echo "  📁 Resource Group: $RESOURCE_GROUP_NAME"
echo "  🧠 OpenAI Resource: $OPENAI_RESOURCE_NAME"
echo "  🗄️  MongoDB vCore Cluster: $COSMOS_MONGO_CLUSTER_NAME"
echo ""
echo "🔐 RBAC Permissions Configured:"
echo "  ✅ OpenAI Contributor role assigned to current user"
echo "  ✅ OpenAI User role assigned to current user"
echo "  ✅ MongoDB vCore root access assigned to current user"
echo ""
echo "🚀 Model Deployments:"
echo "  📝 Embedding Model: $TEXT_EMBEDDING_DEPLOYMENT_NAME"
echo "  💬 Chat Model: $LLM_DEPLOYMENT_NAME"
echo ""
echo "📄 Configuration file created: .env"
echo "👤 Current user ($USER_OBJECT_ID) has full access to all resources"
echo ""
echo "🔧 Next steps:"
echo "  1. Copy the .env file to your project directory"
echo "  2. Run: npm install"
echo "  3. Run: npm run start:agent"
echo "=============================================="
