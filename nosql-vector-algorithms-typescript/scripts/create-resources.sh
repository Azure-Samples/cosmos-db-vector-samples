#!/bin/bash
# Create Azure resources for vector algorithm comparison sample
# Creates: Resource Group, Cosmos DB (serverless), 6 containers (2 algorithms × 3 distance functions), Azure OpenAI
set -euo pipefail

RESOURCE_GROUP=${RESOURCE_GROUP:-"rg-cosmos-vector-algorithms"}
LOCATION=${LOCATION:-"eastus2"}
COSMOSDB_ACCOUNT=${COSMOSDB_ACCOUNT:-"db-vector-$(openssl rand -hex 4)"}
DATABASE_NAME=${DATABASE_NAME:-"Hotels"}
OPENAI_ACCOUNT=${OPENAI_ACCOUNT:-"openai-vector-$(openssl rand -hex 4)"}
EMBEDDING_MODEL="text-embedding-3-small"
EMBEDDING_DIMENSIONS=1536
PARTITION_KEY="/HotelId"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Vector Algorithm Comparison — Resource Setup ==="
echo "Resource Group:   $RESOURCE_GROUP"
echo "Location:         $LOCATION"
echo "Cosmos DB:        $COSMOSDB_ACCOUNT"
echo "OpenAI:           $OPENAI_ACCOUNT"
echo ""

# 1. Resource Group
echo "Creating resource group..."
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

# 2. Azure Cosmos DB account (serverless)
echo "Creating Cosmos DB account (serverless)..."
az cosmosdb create \
    --name "$COSMOSDB_ACCOUNT" \
    --resource-group "$RESOURCE_GROUP" \
    --capabilities EnableServerless \
    --kind GlobalDocumentDB \
    --output none

# 3. Database
echo "Creating database: $DATABASE_NAME..."
az cosmosdb sql database create \
    --account-name "$COSMOSDB_ACCOUNT" \
    --resource-group "$RESOURCE_GROUP" \
    --name "$DATABASE_NAME" \
    --output none

# 4. Create 6 containers (2 algorithms × 3 distance functions)
ALGORITHMS=("quantizedflat" "diskann")
ALGORITHM_TYPES=("quantizedFlat" "diskANN")
DISTANCE_FUNCTIONS=("cosine" "dotproduct" "euclidean")

for i in "${!ALGORITHMS[@]}"; do
    alg="${ALGORITHMS[$i]}"
    alg_type="${ALGORITHM_TYPES[$i]}"

    for dist in "${DISTANCE_FUNCTIONS[@]}"; do
        container_name="hotels_${alg}_${dist}"
        echo "Creating container: $container_name (algorithm: $alg_type, distance: $dist)..."

        # Use the pre-defined index policy file
        index_policy_file="${SCRIPT_DIR}/policies/${alg}-index-policy.json"

        # Generate vector embedding policy dynamically
        vector_embedding_policy=$(cat <<EOF
{
    "vectorEmbeddings": [
        {
            "path": "/DescriptionVector",
            "dataType": "float32",
            "distanceFunction": "${dist}",
            "dimensions": ${EMBEDDING_DIMENSIONS}
        }
    ]
}
EOF
)

        az cosmosdb sql container create \
            --account-name "$COSMOSDB_ACCOUNT" \
            --resource-group "$RESOURCE_GROUP" \
            --database-name "$DATABASE_NAME" \
            --name "$container_name" \
            --partition-key-path "$PARTITION_KEY" \
            --idx @"$index_policy_file" \
            --vector-embedding-policy "$vector_embedding_policy" \
            --output none

        echo "  ✓ $container_name created"
    done
done

# 5. Azure OpenAI account with embedding deployment
echo "Creating Azure OpenAI account..."
az cognitiveservices account create \
    --name "$OPENAI_ACCOUNT" \
    --resource-group "$RESOURCE_GROUP" \
    --kind OpenAI \
    --sku S0 \
    --location "$LOCATION" \
    --output none

echo "Deploying embedding model: $EMBEDDING_MODEL..."
az cognitiveservices account deployment create \
    --name "$OPENAI_ACCOUNT" \
    --resource-group "$RESOURCE_GROUP" \
    --deployment-name "$EMBEDDING_MODEL" \
    --model-name "$EMBEDDING_MODEL" \
    --model-version "1" \
    --model-format OpenAI \
    --sku-capacity 1 \
    --sku-name "Standard" \
    --output none

# 6. RBAC role assignments for data-plane access
echo "Assigning RBAC roles..."
CURRENT_USER_ID=$(az ad signed-in-user show --query id -o tsv)

# Cosmos DB Built-in Data Contributor
COSMOSDB_ACCOUNT_ID=$(az cosmosdb show --name "$COSMOSDB_ACCOUNT" --resource-group "$RESOURCE_GROUP" --query id -o tsv)
az cosmosdb sql role assignment create \
    --account-name "$COSMOSDB_ACCOUNT" \
    --resource-group "$RESOURCE_GROUP" \
    --scope "/" \
    --principal-id "$CURRENT_USER_ID" \
    --role-definition-id "00000000-0000-0000-0000-000000000002" \
    --output none 2>/dev/null || echo "  Cosmos DB role assignment already exists"

# Cognitive Services OpenAI User
az role assignment create \
    --assignee "$CURRENT_USER_ID" \
    --role "Cognitive Services OpenAI User" \
    --scope "$( az cognitiveservices account show --name "$OPENAI_ACCOUNT" --resource-group "$RESOURCE_GROUP" --query id -o tsv)" \
    --output none 2>/dev/null || echo "  OpenAI role assignment already exists"

# Print connection info
COSMOS_ENDPOINT=$(az cosmosdb show --name "$COSMOSDB_ACCOUNT" --resource-group "$RESOURCE_GROUP" --query documentEndpoint -o tsv)
OPENAI_ENDPOINT=$(az cognitiveservices account show --name "$OPENAI_ACCOUNT" --resource-group "$RESOURCE_GROUP" --query "properties.endpoint" -o tsv)

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Add these to your .env file:"
echo ""
echo "AZURE_COSMOSDB_ENDPOINT=\"$COSMOS_ENDPOINT\""
echo "AZURE_COSMOSDB_DATABASENAME=\"$DATABASE_NAME\""
echo "AZURE_OPENAI_EMBEDDING_ENDPOINT=\"$OPENAI_ENDPOINT\""
echo "AZURE_OPENAI_EMBEDDING_MODEL=\"$EMBEDDING_MODEL\""
echo "AZURE_OPENAI_EMBEDDING_API_VERSION=\"2024-08-01-preview\""
