#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# delete-resources.sh — Delete resource group and purge Azure OpenAI resource
#
# Reads .env (written by create-resources.sh) to get resource names.
#
# Usage:
#   chmod +x scripts/delete-resources.sh
#   ./scripts/delete-resources.sh            # reads .env in current directory
#   ./scripts/delete-resources.sh path/.env  # reads a specific .env file
# ---------------------------------------------------------------------------

ENV_FILE="${1:-.env}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: .env file not found: ${ENV_FILE}"
  echo "Usage: $0 [path-to-.env]"
  exit 1
fi

# Load variables from .env (skip comments and blank lines)
set -a
while IFS='=' read -r key value; do
  # Skip comments and blank lines
  [[ -z "${key}" || "${key}" =~ ^# ]] && continue
  # Strip surrounding quotes from value
  value="${value%\"}"
  value="${value#\"}"
  export "${key}=${value}"
done < "${ENV_FILE}"
set +a

# Validate required variables
RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-}"
LOCATION="${AZURE_LOCATION:-}"
OPENAI_ENDPOINT="${AZURE_OPENAI_ENDPOINT:-}"

if [[ -z "${RESOURCE_GROUP}" ]]; then
  echo "ERROR: AZURE_RESOURCE_GROUP not found in ${ENV_FILE}"
  exit 1
fi

if [[ -z "${LOCATION}" ]]; then
  echo "ERROR: AZURE_LOCATION not found in ${ENV_FILE}"
  exit 1
fi

# Extract OpenAI account name from endpoint URL
# e.g. https://oai-vector-abc123.openai.azure.com/ → oai-vector-abc123
OPENAI_ACCOUNT_NAME=""
if [[ -n "${OPENAI_ENDPOINT}" ]]; then
  OPENAI_ACCOUNT_NAME=$(echo "${OPENAI_ENDPOINT}" | sed -E 's|https://([^.]+)\.openai\.azure\.com/?|\1|')
fi

echo "============================================================"
echo "Delete Azure Resources"
echo "============================================================"
echo "  Resource group:     ${RESOURCE_GROUP}"
echo "  Location:           ${LOCATION}"
echo "  OpenAI account:     ${OPENAI_ACCOUNT_NAME:-<not found>}"
echo ""

# ---- 1. Delete resource group ----
echo ""
echo "1/2  Deleting resource group: ${RESOURCE_GROUP}..."
az group delete \
  --name "${RESOURCE_GROUP}" \
  --yes \
  --no-wait
echo "     Resource group deletion started (runs in background)."

# ---- 2. Purge Azure OpenAI (Cognitive Services) resource ----
if [[ -n "${OPENAI_ACCOUNT_NAME}" ]]; then
  echo ""
  echo "2/2  Purging Azure OpenAI resource: ${OPENAI_ACCOUNT_NAME}..."
  echo "     Waiting for resource group deletion to remove the resource..."
  echo "     (This may take a few minutes.)"

  # Wait until the resource is soft-deleted (resource group deletion must finish first)
  MAX_WAIT=300
  ELAPSED=0
  while (( ELAPSED < MAX_WAIT )); do
    # Check if the resource appears in the deleted list
    DELETED=$(az cognitiveservices account list-deleted \
      --query "[?name=='${OPENAI_ACCOUNT_NAME}'].name" \
      --output tsv 2>/dev/null || true)

    if [[ -n "${DELETED}" ]]; then
      break
    fi

    sleep 15
    ELAPSED=$((ELAPSED + 15))
    echo "     Waiting... (${ELAPSED}s)"
  done

  if [[ -n "${DELETED}" ]]; then
    az cognitiveservices account purge \
      --name "${OPENAI_ACCOUNT_NAME}" \
      --resource-group "${RESOURCE_GROUP}" \
      --location "${LOCATION}"
    echo "     OpenAI resource purged."
  else
    echo "     WARNING: OpenAI resource not yet in deleted list after ${MAX_WAIT}s."
    echo "     Run manually later:"
    echo "       az cognitiveservices account purge \\"
    echo "         --name ${OPENAI_ACCOUNT_NAME} \\"
    echo "         --resource-group ${RESOURCE_GROUP} \\"
    echo "         --location ${LOCATION}"
  fi
else
  echo ""
  echo "2/2  Skipped — no AZURE_OPENAI_ENDPOINT in ${ENV_FILE}."
fi

echo ""
echo "============================================================"
echo "Done"
echo "============================================================"
