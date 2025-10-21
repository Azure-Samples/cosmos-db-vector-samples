#!/bin/bash
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
TEXT_EMBEDDING_DEPLOYMENT_NAME="text-embedding-ada-002"
LLM_DEPLOYMENT_NAME="gpt-4o"
API_VERSION="2025-01-01-preview"

# Set the subscription
az account set --subscription "$SUBSCRIPTION_ID"

# Create the resource group
echo "Creating resource group: $RESOURCE_GROUP_NAME in $LOCATION..."
az group create --location $LOCATION --resource-group $RESOURCE_GROUP_NAME

# Create the Azure AI resource
echo "Creating Azure AI resource: $AZURE_AI_RESOURCE_NAME..."
az search service create \
  --name "$AZURE_AI_RESOURCE_NAME" \
  --resource-group "$RESOURCE_GROUP_NAME" \
  --sku "Basic" \
  --location "$LOCATION"

# Retrieve the admin and query keys
echo "Retrieving admin key for Azure AI Search resource..."
ADMIN_KEY=$(az search admin-key show \
  --service-name "$AZURE_AI_RESOURCE_NAME" \
  --resource-group "$RESOURCE_GROUP_NAME" \
  --query "primaryKey" -o tsv)

QUERY_KEY=$(az search query-key list \
  --service-name "$AZURE_AI_RESOURCE_NAME" \
  --resource-group "$RESOURCE_GROUP_NAME" \
  --query "[0].key" -o tsv)

# Output the keys
echo "Admin Key: $ADMIN_KEY"
echo "Query Key: $QUERY_KEY"

# Create the OpenAI resource
echo "Creating OpenAI resource: $OPENAI_RESOURCE_NAME..."
az cognitiveservices account create \
  --name "$OPENAI_RESOURCE_NAME" \
  --resource-group "$RESOURCE_GROUP_NAME" \
  --kind OpenAI \
  --sku S0 \
  --location "$LOCATION"

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
  --model-name "$TEXT_EMBEDDING_DEPLOYMENT_NAME" \
  --model-format "OpenAI" \
  --model-version "1" \
  --capacity "1" \
  --sku "Standard"

# Deploy the LLM model
echo "Deploying LLM model: $LLM_DEPLOYMENT_NAME..."
az cognitiveservices account deployment create \
  --name "$OPENAI_RESOURCE_NAME" \
  --resource-group "$RESOURCE_GROUP_NAME" \
  --model-name "$TEXT_EMBEDDING_DEPLOYMENT_NAME" \
  --model-format "OpenAI" \
  --model-version "1" \
  --capacity "1" \
  --sku "Standard"

# Create the .env file
ENV_FILE=".env"
echo "Creating .env file..."
cat <<EOL > $ENV_FILE
# Embedding resource
AZURE_OPENAI_EMBEDDING_INSTANCE="$OPENAI_RESOURCE_NAME"
AZURE_OPENAI_EMBEDDING_KEY="$OPENAI_KEY"
AZURE_OPENAI_EMBEDDING_MODEL="$TEXT_EMBEDDING_DEPLOYMENT_NAME"
AZURE_OPENAI_EMBEDDING_API_VERSION="$API_VERSION"

# LLM resource
AZURE_OPENAI_COMPLETE_INSTANCE="$OPENAI_RESOURCE_NAME"
AZURE_OPENAI_COMPLETE_KEY="$OPENAI_KEY"
AZURE_OPENAI_COMPLETE_MODEL="$LLM_DEPLOYMENT_NAME"
AZURE_OPENAI_COMPLETE_API_VERSION="$API_VERSION"
AZURE_OPENAI_COMPLETE_MAX_TOKENS=1000

# Azure AI Search connection settings
AZURE_AISEARCH_ENDPOINT="https://$AZURE_AI_RESOURCE_NAME.search.windows.net"
AZURE_AISEARCH_ADMIN_KEY="$ADMIN_KEY"
AZURE_AISEARCH_QUERY_KEY="$QUERY_KEY"
AZURE_AISEARCH_INDEX_NAME="northwind"

# Langsmith settings
LANGSMITH_TRACING=true
LANGSMITH_ENDPOINT="https://api.smith.langchain.com"
LANGSMITH_API_KEY=""
LANGSMITH_PROJECT=""
NORTHWIND_PDF_LOADED=true
EOL

echo ".env file created successfully."

echo "Resource group and resources created successfully."
echo "Resource group: $RESOURCE_GROUP_NAME"
echo "Azure AI resource: $AZURE_AI_RESOURCE_NAME"
echo "OpenAI resource: $OPENAI_RESOURCE_NAME"
echo "Admin Key: $ADMIN_KEY"
echo "Query Key: $QUERY_KEY"
echo "OpenAI Key: $OPENAI_KEY"
echo "Text Embedding Deployment Name: $TEXT_EMBEDDING_DEPLOYMENT_NAME"
echo "LLM Deployment Name: $LLM_DEPLOYMENT_NAME"
echo "API Version: $API_VERSION"
echo "Script completed successfully."
echo "You can now use the keys and resource names in your application."
echo "Remember to clean up resources when done using: az group delete --name $RESOURCE_GROUP_NAME --yes --no-wait"
echo "Script completed successfully."