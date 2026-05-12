#!/bin/bash
# Delete all Azure resources for vector algorithm comparison sample
set -euo pipefail

RESOURCE_GROUP=${RESOURCE_GROUP:-"rg-cosmos-vector-algorithms"}

echo "Deleting resource group: $RESOURCE_GROUP"
echo "This will delete ALL resources in the group."
echo ""

az group delete --name "$RESOURCE_GROUP" --yes --no-wait

echo "Resource group deletion initiated (running in background)."
