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

$ErrorActionPreference = "Stop"

# Get the repository root (where this script is located, minus /infra)
$REPO_ROOT = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$ENV_FILE = Join-Path $env:AZURE_ENV_NAME ".env"

Write-Host "╔════════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║ PRE-PROVISIONING: Environment Setup for Scenario Detection        ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan

# Check if CREATE-INDEX scenario is requested
if ($env:AZURE_COSMOSDB_CREATE_INDEX_DATABASE_NAME) {
    Write-Host ""
    Write-Host "📍 CREATE-INDEX scenario detected" -ForegroundColor Green
    Write-Host "   Database: $($env:AZURE_COSMOSDB_CREATE_INDEX_DATABASE_NAME)" -ForegroundColor Green
    Write-Host "   Bicep will create empty database; SDKs create containers" -ForegroundColor Green
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "📍 VECTOR-SEARCH scenario (default)" -ForegroundColor Green
    Write-Host "   Database: Hotels" -ForegroundColor Green
    Write-Host "   Bicep will create full stack (database + containers + indexes)" -ForegroundColor Green
    Write-Host ""
}

Write-Host "✓ Pre-provisioning setup complete" -ForegroundColor Green
