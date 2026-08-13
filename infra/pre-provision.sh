#!/bin/bash

# ============================================================================
# PRE-PROVISIONING ENVIRONMENT SETUP HOOK
# ============================================================================
# Purpose: Prepare environment variables for Bicep deployment
#          Capture scenario-specific variables before infrastructure provision
#
# This script is called by: azure.yaml (hooks.preprovision.run)
# When it runs: Before azd provision starts infrastructure deployment
#
# WHY THIS HOOK EXISTS:
#   - User sets AZURE_COSMOSDB_CREATE_INDEX_DATABASE_NAME BEFORE azd up
#   - But azd doesn't automatically persist session environment variables
#   - This hook captures the scenario-detection variable and ensures it's
#     available for the Bicep template (main.bicepparam)
#
# ============================================================================

set -e  # Exit on error

# Color codes for output
CYAN='\033[0;36m'
GREEN='\033[0;32m'
NC='\033[0m'  # No Color

echo ""
echo -e "${CYAN}╔════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║ PRE-PROVISIONING: Environment Setup for Scenario Detection        ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════════════╝${NC}"

# Check if CREATE-INDEX scenario is requested
if [ -n "$AZURE_COSMOSDB_CREATE_INDEX_DATABASE_NAME" ]; then
    echo ""
    echo -e "${GREEN}📍 CREATE-INDEX scenario detected${NC}"
    echo -e "${GREEN}   Database: $AZURE_COSMOSDB_CREATE_INDEX_DATABASE_NAME${NC}"
    echo -e "${GREEN}   Bicep will create empty database; SDKs create containers${NC}"
    echo ""
else
    echo ""
    echo -e "${GREEN}📍 VECTOR-SEARCH scenario (default)${NC}"
    echo -e "${GREEN}   Database: Hotels${NC}"
    echo -e "${GREEN}   Bicep will create full stack (database + containers + indexes)${NC}"
    echo ""
fi

echo -e "${GREEN}✓ Pre-provisioning setup complete${NC}"
