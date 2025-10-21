#!/bin/bash
# chmod +x create-resources.sh
# az login --use-device-code
# az account list --query "[].{name:name}" -o table
# az account list-locations --query "[].name" -o tsv

# usage: ./create-resources.sh <resource-group-name> <location>
# example: ./create-resources.sh "langchain-agent" "eastus2"
# This script creates an Azure resource group and an Azure AI resource, retrieves keys, and deploys models.

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

# Set the subscription
az account set --subscription "$SUBSCRIPTION_ID"

# Create the resource group
echo "Creating resource group: $RESOURCE_GROUP_NAME in $LOCATION..."
az group create --location $LOCATION --resource-group $RESOURCE_GROUP_NAME

# Create the OpenAI resource
echo "Creating OpenAI resource: $OPENAI_RESOURCE_NAME..."
az cognitiveservices account create \
  --name "$OPENAI_RESOURCE_NAME" \
  --resource-group "$RESOURCE_GROUP_NAME" \
  --kind OpenAI \
  --sku S0 \
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
az cognitiveservices account deployment create \
  --name "$OPENAI_RESOURCE_NAME" \
  --resource-group "$RESOURCE_GROUP_NAME" \
  --deployment-name "$TEXT_EMBEDDING_DEPLOYMENT_NAME" \
  --model-name "$TEXT_EMBEDDING_DEPLOYMENT_NAME" \
  --model-format "OpenAI" \
  --model-version "2" \
  --capacity "8" \
  --sku "Standard"

# Deploy the LLM model
echo "Deploying LLM model: $LLM_DEPLOYMENT_NAME..."
az cognitiveservices account deployment create \
  --name "$OPENAI_RESOURCE_NAME" \
  --resource-group "$RESOURCE_GROUP_NAME" \
  --deployment-name "$LLM_DEPLOYMENT_NAME" \
  --model-name "$LLM_DEPLOYMENT_NAME" \
  --model-format "OpenAI" \
  --model-version "2024-05-13" \
  --capacity "10" \
  --sku "Standard"

# Create Cosmos DB MongoDB vCore cluster
echo "Creating Cosmos DB MongoDB vCore cluster: $COSMOS_MONGO_CLUSTER_NAME..."
az mongocluster create \
  --cluster-name "$COSMOS_MONGO_CLUSTER_NAME" \
  --resource-group "$RESOURCE_GROUP_NAME" \
  --location "$LOCATION" \
  --administrator-login "$COSMOS_MONGO_ADMIN_USER" \
  --administrator-login-password "$COSMOS_MONGO_ADMIN_PASSWORD" \
  --tier "M40" \
  --high-availability "Disabled" \
  --storage "128" \
  --shard-count "1"

echo "Waiting for Cosmos DB MongoDB vCore cluster to be ready..."
az mongocluster wait \
  --cluster-name "$COSMOS_MONGO_CLUSTER_NAME" \
  --resource-group "$RESOURCE_GROUP_NAME" \
  --created

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
COSMOS_MONGO_CONNECTION_STRING=$(az mongocluster show \
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
