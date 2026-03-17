#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# create-resources.sh — Create resource group, Azure OpenAI, Cosmos DB account + database
#
# Creates the Azure foundation so that src/index.ts can use the ARM SDK
# (@azure/arm-cosmosdb) to create the container with a vector index.
#
# Usage:
#   chmod +x scripts/create-resources.sh
#   ./scripts/create-resources.sh                                          # Full setup (control + data plane)
#   SETUP_MODE=control ./scripts/create-resources.sh                       # Control plane only
#   SETUP_MODE=full ./scripts/create-resources.sh                          # Full setup (explicit)
#   ./scripts/create-resources.sh <resource-group> <location>              # Custom values
#   SETUP_MODE=control ./scripts/create-resources.sh my-rg westus2         # Combined
#
# SETUP_MODE:
#   "full"    — (default) Creates resources + assigns both control plane
#               and data plane RBAC roles.
#   "control" — Creates resources + assigns control plane roles only.
#               Use when data plane roles are assigned separately (e.g.,
#               by azd or a separate RBAC script).
#
# Prerequisites:
#   - Azure CLI installed and logged in (az login)
#   - Active subscription selected (az account set --subscription <id>)
# ---------------------------------------------------------------------------

SETUP_MODE="${SETUP_MODE:-full}"
RESOURCE_GROUP="${1:-cosmos-vector-rg}"
LOCATION="${2:-eastus2}"

if [[ "${SETUP_MODE}" != "full" && "${SETUP_MODE}" != "control" ]]; then
  echo "ERROR: SETUP_MODE must be 'full' or 'control'. Got: '${SETUP_MODE}'"
  exit 1
fi

echo "============================================================"
echo "Azure Resource Setup (mode: ${SETUP_MODE})"
echo "============================================================"

# ---- Current identity and subscription ----
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
USER_OBJECT_ID=$(az ad signed-in-user show --query id -o tsv)
USER_UPN=$(az ad signed-in-user show --query userPrincipalName -o tsv)

echo "Subscription:   ${SUBSCRIPTION_ID}"
echo "User:           ${USER_UPN} (${USER_OBJECT_ID})"
echo "Resource group: ${RESOURCE_GROUP}"
echo "Location:       ${LOCATION}"
echo "Setup mode:     ${SETUP_MODE}"
echo ""

# ---- Generate unique suffix for globally unique resource names ----
SUFFIX=$(echo -n "${SUBSCRIPTION_ID}${RESOURCE_GROUP}" | md5sum 2>/dev/null | head -c 8 || printf '%04x%04x' $RANDOM $RANDOM)
COSMOS_ACCOUNT_NAME="${COSMOS_ACCOUNT_NAME:-db-vector-${SUFFIX}}"
OPENAI_ACCOUNT_NAME="${OPENAI_ACCOUNT_NAME:-oai-vector-${SUFFIX}}"

# ---- Cosmos DB built-in data plane role definition IDs ----
# 00000000-0000-0000-0000-000000000001 = Cosmos DB Built-in Data Reader
# 00000000-0000-0000-0000-000000000002 = Cosmos DB Built-in Data Contributor
COSMOS_DATA_CONTRIBUTOR_ROLE="00000000-0000-0000-0000-000000000002"

# ---- Step counter ----
if [[ "${SETUP_MODE}" == "full" ]]; then
  TOTAL_STEPS=9
else
  TOTAL_STEPS=8
fi
STEP=0
next_step() { STEP=$((STEP + 1)); }

# ---- 1. Create resource group ----
next_step
echo "${STEP}/${TOTAL_STEPS}  Creating resource group: ${RESOURCE_GROUP}..."
az group create \
  --name "${RESOURCE_GROUP}" \
  --location "${LOCATION}" \
  --output none

# ---- 2. Assign Contributor role to current user on resource group ----
next_step
echo "${STEP}/${TOTAL_STEPS}  Assigning Contributor role (control plane) to current user..."
az role assignment create \
  --assignee-object-id "${USER_OBJECT_ID}" \
  --assignee-principal-type "User" \
  --role "Contributor" \
  --scope "/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}" \
  --output none 2>/dev/null || echo "     (Already assigned or inherited)"

# ---- 3. Create Azure OpenAI account ----
next_step
echo "${STEP}/${TOTAL_STEPS}  Creating Azure OpenAI account: ${OPENAI_ACCOUNT_NAME}..."
az cognitiveservices account create \
  --name "${OPENAI_ACCOUNT_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --location "${LOCATION}" \
  --kind "OpenAI" \
  --sku "S0" \
  --custom-domain "${OPENAI_ACCOUNT_NAME}" \
  --output none

# ---- 4. Deploy embedding model ----
next_step
echo "${STEP}/${TOTAL_STEPS}  Deploying text-embedding-3-small model..."
az cognitiveservices account deployment create \
  --name "${OPENAI_ACCOUNT_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --deployment-name "text-embedding-3-small" \
  --model-name "text-embedding-3-small" \
  --model-version "1" \
  --model-format "OpenAI" \
  --sku-name "Standard" \
  --sku-capacity 10 \
  --output none

# ---- 5. Assign Cognitive Services OpenAI User role ----
next_step
echo "${STEP}/${TOTAL_STEPS}  Assigning Cognitive Services OpenAI User role..."
OPENAI_RESOURCE_ID=$(az cognitiveservices account show \
  --name "${OPENAI_ACCOUNT_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --query id -o tsv)

az role assignment create \
  --assignee-object-id "${USER_OBJECT_ID}" \
  --assignee-principal-type "User" \
  --role "Cognitive Services OpenAI User" \
  --scope "${OPENAI_RESOURCE_ID}" \
  --output none 2>/dev/null || echo "     (Already assigned)"

# ---- 6. Create Cosmos DB account ----
next_step
echo "${STEP}/${TOTAL_STEPS}  Creating Cosmos DB account: ${COSMOS_ACCOUNT_NAME}..."
az cosmosdb create \
  --name "${COSMOS_ACCOUNT_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --locations regionName="${LOCATION}" failoverPriority=0 \
  --capabilities "EnableNoSQLVectorSearch" \
  --default-consistency-level "Session" \
  --output none

# ---- 7. Create Cosmos DB database ----
next_step
echo "${STEP}/${TOTAL_STEPS}  Creating Cosmos DB database: Hotels..."
az cosmosdb sql database create \
  --account-name "${COSMOS_ACCOUNT_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --name "Hotels" \
  --output none

# ---- Data plane steps (full mode only) ----
if [[ "${SETUP_MODE}" == "full" ]]; then

  # ---- 8. Assign Cosmos DB Built-in Data Contributor role (data plane) ----
  next_step
  echo "${STEP}/${TOTAL_STEPS}  Assigning Cosmos DB Built-in Data Contributor role (data plane)..."
  az cosmosdb sql role assignment create \
    --account-name "${COSMOS_ACCOUNT_NAME}" \
    --resource-group "${RESOURCE_GROUP}" \
    --role-definition-id "${COSMOS_DATA_CONTRIBUTOR_ROLE}" \
    --principal-id "${USER_OBJECT_ID}" \
    --scope "/" \
    --output none 2>/dev/null || echo "     (Already assigned)"

fi

# ---- Collect endpoints ----
OPENAI_ENDPOINT=$(az cognitiveservices account show \
  --name "${OPENAI_ACCOUNT_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --query "properties.endpoint" -o tsv)

COSMOS_ENDPOINT=$(az cosmosdb show \
  --name "${COSMOS_ACCOUNT_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --query "documentEndpoint" -o tsv)

# ---- Write .env file ----
next_step
echo "${STEP}/${TOTAL_STEPS}  Writing .env file..."
cat > .env << EOF
# Generated by scripts/create-resources.sh (mode: ${SETUP_MODE}) — $(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Identity for local developer authentication with Azure CLI
AZURE_TOKEN_CREDENTIALS=AzureCliCredential

# Azure
AZURE_SUBSCRIPTION_ID="${SUBSCRIPTION_ID}"
AZURE_RESOURCE_GROUP="${RESOURCE_GROUP}"
AZURE_LOCATION="${LOCATION}"
AZURE_USER_PRINCIPAL_ID="${USER_OBJECT_ID}"

# Cosmos DB (container + vector index created by npm start via ARM SDK)
AZURE_COSMOSDB_ACCOUNT_NAME="${COSMOS_ACCOUNT_NAME}"
AZURE_COSMOSDB_ENDPOINT="${COSMOS_ENDPOINT}"
AZURE_COSMOSDB_DATABASENAME="Hotels"
AZURE_COSMOSDB_CONTAINER_NAME="hotels_diskann"

# Azure OpenAI
AZURE_OPENAI_ENDPOINT="${OPENAI_ENDPOINT}"
AZURE_OPENAI_EMBEDDING_DEPLOYMENT="text-embedding-3-small"
AZURE_OPENAI_EMBEDDING_API_VERSION="2024-08-01-preview"

# Vector index configuration
VECTOR_INDEX_TYPE="diskANN"
EMBEDDED_FIELD="DescriptionVector"
EMBEDDING_DIMENSIONS="1536"

# Data file with pre-computed vectors (relative to dist/)
DATA_FILE_WITH_VECTORS="../data/HotelsData_toCosmosDB_Vector.json"
EOF

echo ""
echo "============================================================"
echo "Setup complete (mode: ${SETUP_MODE})"
echo "============================================================"
echo ""
echo "  Cosmos DB account:  ${COSMOS_ACCOUNT_NAME}"
echo "  Cosmos DB endpoint: ${COSMOS_ENDPOINT}"
echo "  Cosmos DB database: Hotels"
echo "  OpenAI endpoint:    ${OPENAI_ENDPOINT}"
echo "  .env file:          written"
echo ""
echo "  Roles assigned:"
echo "    - Contributor (control plane, resource group scope)"
echo "    - Cognitive Services OpenAI User (data plane, OpenAI scope)"
if [[ "${SETUP_MODE}" == "full" ]]; then
  echo "    - Cosmos DB Built-in Data Contributor (data plane, account scope)"
else
  echo ""
  echo "  NOTE: Cosmos DB data plane roles were NOT assigned (mode: control)."
  echo "  Data plane RBAC must be configured separately"
  echo "  (e.g., via azd provision or a dedicated RBAC script)."
fi
echo ""
echo "Next:"
echo "  npm install"
echo "  npm start    # Creates container with vector index via ARM SDK"
