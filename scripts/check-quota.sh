#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# check-quota.sh — Pre-flight Azure OpenAI quota check
#
# Verifies that your Azure subscription has enough Azure OpenAI quota to
# deploy the models defined in infra/main.bicep before you run `azd up`.
#
# Works on: Linux, macOS, WSL, Git Bash (Windows)
# Requires: Azure CLI (az) — installed and logged in
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# Prevent Git Bash (MSYS) from mangling forward-slash arguments sent to az CLI
export MSYS_NO_PATHCONV=1

# ─────────────────────────────────────────────────────────────────────────────
# Script location & project root
# ─────────────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BICEP_FILE="${PROJECT_ROOT}/infra/main.bicep"

# ─────────────────────────────────────────────────────────────────────────────
# Terminal colors (auto-disabled when stdout is piped)
# ─────────────────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
    RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
    BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
else
    RED=''; GREEN=''; YELLOW=''; BLUE=''; BOLD=''; NC=''
fi

# ─────────────────────────────────────────────────────────────────────────────
# Model specifications — keep in sync with infra/main.bicep
#
# Each entry is: "label|model_name|version|sku|capacity"
#   label    — friendly display name
#   model    — Azure OpenAI model name (e.g., gpt-4o-mini)
#   version  — model version string
#   sku      — deployment type: Standard, GlobalStandard, etc.
#   capacity — requested TPM in thousands (50 = 50 000 TPM)
# ─────────────────────────────────────────────────────────────────────────────
MODEL_SPECS=(
    "Chat|gpt-4.1-mini|2025-04-14|Standard|50"
    "Embedding|text-embedding-3-small|1|Standard|10"
)

# Regions the Bicep @allowed decorator permits (deployable without edits)
TEMPLATE_REGIONS=("eastus2" "swedencentral")

# Extra regions to scan when suggesting alternatives (require template edits)
EXTRA_REGIONS=(
    "westus3" "northcentralus" "eastus" "canadaeast"
    "uksouth" "westeurope" "francecentral"
    "australiaeast" "japaneast" "norwayeast"
)

# ─────────────────────────────────────────────────────────────────────────────
# Argument parsing
# ─────────────────────────────────────────────────────────────────────────────
FIX_MODE=false
TARGET_REGION=""
SUBSCRIPTION_FLAG=""

show_help() {
    cat <<'HELPEOF'
check-quota.sh — Pre-flight Azure OpenAI quota check

Usage:
  ./scripts/check-quota.sh [OPTIONS]

Options:
  --fix                  Show suggested azd env set commands to resolve issues
  --region <region>      Check only this region (default: all template-allowed)
  --subscription <id>    Use a specific Azure subscription
  -h, --help             Show this help

Examples:
  ./scripts/check-quota.sh
  ./scripts/check-quota.sh --fix
  ./scripts/check-quota.sh --region swedencentral
  ./scripts/check-quota.sh --subscription 00000000-0000-0000-0000-000000000000
HELPEOF
    exit 0
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --fix)          FIX_MODE=true; shift ;;
        --region)       [[ -z "${2:-}" ]] && { echo "Error: --region requires a value"; exit 1; }
                        TARGET_REGION="$2"; shift 2 ;;
        --subscription) [[ -z "${2:-}" ]] && { echo "Error: --subscription requires a value"; exit 1; }
                        SUBSCRIPTION_FLAG="--subscription $2"; shift 2 ;;
        -h|--help)      show_help ;;
        *)              echo "Unknown option: $1"; echo; show_help ;;
    esac
done

# Determine which regions to check
if [[ -n "$TARGET_REGION" ]]; then
    REGIONS_TO_CHECK=("$TARGET_REGION")
else
    REGIONS_TO_CHECK=("${TEMPLATE_REGIONS[@]}")
fi

# ─────────────────────────────────────────────────────────────────────────────
# Logging helpers
# ─────────────────────────────────────────────────────────────────────────────
info()  { echo -e "${BLUE}ℹ${NC}  $*"; }
pass()  { echo -e "${GREEN}✅${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠️${NC}  $*"; }
fail()  { echo -e "${RED}❌${NC} $*"; }

# ─────────────────────────────────────────────────────────────────────────────
# check_prerequisites — Verify az CLI is installed and the user is logged in
# ─────────────────────────────────────────────────────────────────────────────
check_prerequisites() {
    if ! command -v az &>/dev/null; then
        fail "Azure CLI (az) is not installed."
        echo "  Install: https://learn.microsoft.com/cli/azure/install-azure-cli"
        exit 1
    fi

    # shellcheck disable=SC2086
    if ! az account show ${SUBSCRIPTION_FLAG} -o none 2>/dev/null; then
        fail "Not logged in to Azure CLI, or the specified subscription was not found."
        echo "  Run:  az login"
        [[ -n "$SUBSCRIPTION_FLAG" ]] && echo "  Or verify your --subscription value."
        exit 1
    fi

    # Display active subscription for confirmation
    # shellcheck disable=SC2086
    local sub_name sub_id
    sub_name=$(az account show ${SUBSCRIPTION_FLAG} --query "name" -o tsv 2>/dev/null)
    sub_id=$(az account show ${SUBSCRIPTION_FLAG} --query "id" -o tsv 2>/dev/null)
    info "Subscription: ${BOLD}${sub_name}${NC} (${sub_id})"
}

# ─────────────────────────────────────────────────────────────────────────────
# validate_bicep — Quick sanity-check that our hardcoded specs match the file
# ─────────────────────────────────────────────────────────────────────────────
validate_bicep() {
    if [[ ! -f "$BICEP_FILE" ]]; then
        warn "Bicep file not found at ${BICEP_FILE} — using hardcoded model specs."
        return
    fi

    local stale=false
    for spec in "${MODEL_SPECS[@]}"; do
        IFS='|' read -r _label name _ver _sku _cap <<< "$spec"
        if ! grep -q "'${name}'" "$BICEP_FILE" 2>/dev/null; then
            warn "Model '${name}' not found in Bicep — script may be out of date."
            stale=true
        fi
    done
    if ! $stale; then
        pass "Bicep references match hardcoded model specs."
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# is_model_available — Check if model + SKU is offered in a region
#   Args: region, model_name, sku
#   Returns: 0 if available, 1 otherwise
# ─────────────────────────────────────────────────────────────────────────────
is_model_available() {
    local region="$1" model_name="$2" sku="$3"

    # Flatten all SKU names for matching model entries and grep for our SKU
    # shellcheck disable=SC2086
    local sku_list
    sku_list=$(az cognitiveservices model list \
        --location "$region" \
        ${SUBSCRIPTION_FLAG} \
        --query "[?model.name=='${model_name}'].skus[].name" \
        -o tsv 2>/dev/null) || return 1

    echo "$sku_list" | grep -qi "^${sku}$"
}

# ─────────────────────────────────────────────────────────────────────────────
# get_quota — Retrieve current usage and limit for a model/SKU in a region
#   Args: region, sku, model_name
#   Outputs: "current<TAB>limit" or empty string if not found
#
# Azure quota entry names follow the pattern: OpenAI.<SKU>.<model>
# ─────────────────────────────────────────────────────────────────────────────
get_quota() {
    local region="$1" sku="$2" model_name="$3"
    local usage_key="OpenAI.${sku}.${model_name}"

    # shellcheck disable=SC2086
    az cognitiveservices usage list \
        --location "$region" \
        ${SUBSCRIPTION_FLAG} \
        --query "[?name.value=='${usage_key}'].[currentValue, limit] | [0]" \
        -o tsv 2>/dev/null
}

# ─────────────────────────────────────────────────────────────────────────────
# check_region_viable — Returns 0 if ALL models have sufficient quota there
#   Args: region
# ─────────────────────────────────────────────────────────────────────────────
check_region_viable() {
    local region="$1"
    for spec in "${MODEL_SPECS[@]}"; do
        IFS='|' read -r _label name version sku capacity <<< "$spec"

        # Model must be offered in this region with the right SKU
        if ! is_model_available "$region" "$name" "$sku" 2>/dev/null; then
            return 1
        fi

        # Quota must be sufficient
        local usage_line
        usage_line=$(get_quota "$region" "$sku" "$name")
        if [[ -z "$usage_line" ]]; then
            return 1
        fi

        local current limit available
        current=$(echo "$usage_line" | awk '{printf "%d", $1}')
        limit=$(echo "$usage_line" | awk '{printf "%d", $2}')
        available=$((limit - current))

        if [[ $available -lt $capacity ]]; then
            return 1
        fi
    done
    return 0
}

# ─────────────────────────────────────────────────────────────────────────────
# print_table_header
# ─────────────────────────────────────────────────────────────────────────────
print_table_header() {
    printf "%-16s %-26s %-16s %10s %10s %10s  %s\n" \
        "Region" "Model" "SKU" "Requested" "Used" "Limit" "Status"
    printf "%-16s %-26s %-16s %10s %10s %10s  %s\n" \
        "────────────────" "──────────────────────────" "────────────────" \
        "──────────" "──────────" "──────────" "──────────────"
}

# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────
main() {
    echo
    echo -e "${BOLD}Azure OpenAI Quota Pre-flight Check${NC}"
    echo -e "${BOLD}====================================${NC}"
    echo

    check_prerequisites
    echo
    validate_bicep

    echo
    echo -e "${BOLD}Checking quota in target region(s)...${NC}"
    echo

    print_table_header

    # Track whether all checks pass and collect viable regions for --fix
    local overall_pass=true
    local viable_template_region=""

    for region in "${REGIONS_TO_CHECK[@]}"; do
        for spec in "${MODEL_SPECS[@]}"; do
            IFS='|' read -r label name version sku capacity <<< "$spec"

            # Step 1: Is the model available in this region with this SKU?
            if ! is_model_available "$region" "$name" "$sku"; then
                printf "%-16s %-26s %-16s %10s %10s %10s  %s\n" \
                    "$region" "$name" "$sku" "${capacity}K" "—" "—" "❌ Not available"
                overall_pass=false
                continue
            fi

            # Step 2: What's the quota situation?
            local usage_line
            usage_line=$(get_quota "$region" "$sku" "$name")

            if [[ -z "$usage_line" ]]; then
                printf "%-16s %-26s %-16s %10s %10s %10s  %s\n" \
                    "$region" "$name" "$sku" "${capacity}K" "?" "?" "⚠️  No quota entry"
                overall_pass=false
                continue
            fi

            local current limit available
            current=$(echo "$usage_line" | awk '{printf "%d", $1}')
            limit=$(echo "$usage_line" | awk '{printf "%d", $2}')
            available=$((limit - current))

            # Step 3: Compare requested vs available
            if [[ $available -ge $capacity ]]; then
                printf "%-16s %-26s %-16s %10s %10s %10s  %s\n" \
                    "$region" "$name" "$sku" "${capacity}K" "${current}K" "${limit}K" \
                    "✅ OK (${available}K free)"
            else
                printf "%-16s %-26s %-16s %10s %10s %10s  %s\n" \
                    "$region" "$name" "$sku" "${capacity}K" "${current}K" "${limit}K" \
                    "❌ Need ${capacity}K, only ${available}K free"
                overall_pass=false
            fi
        done
    done

    echo

    # ─── All good? Exit early. ───────────────────────────────────────────────
    if $overall_pass; then
        pass "${BOLD}All models have sufficient quota. Ready to deploy!${NC}"
        echo
        exit 0
    fi

    # ─── Quota issues: scan for alternatives ─────────────────────────────────
    warn "${BOLD}Quota issues detected.${NC} Scanning alternative regions..."
    echo

    local found_template_alt=false
    local found_extra_alt=false

    # Check template-allowed regions first, then extras
    for region in "${TEMPLATE_REGIONS[@]}" "${EXTRA_REGIONS[@]}"; do
        # Skip regions we already checked
        local skip=false
        for checked in "${REGIONS_TO_CHECK[@]}"; do
            [[ "$region" == "$checked" ]] && { skip=true; break; }
        done
        $skip && continue

        # Is this region allowed by the template?
        local in_template=false
        for t in "${TEMPLATE_REGIONS[@]}"; do
            [[ "$region" == "$t" ]] && { in_template=true; break; }
        done

        if check_region_viable "$region"; then
            if $in_template; then
                pass "  ${BOLD}${region}${NC} — quota available ${GREEN}(allowed by template, deployable now)${NC}"
                found_template_alt=true
                [[ -z "$viable_template_region" ]] && viable_template_region="$region"
            else
                info "  ${region} — quota available ${YELLOW}(requires adding region to template @allowed list)${NC}"
                found_extra_alt=true
            fi
        fi
    done

    if ! $found_template_alt && ! $found_extra_alt; then
        warn "  No alternative regions found with sufficient quota."
    fi

    echo

    # ─── --fix: Emit actionable commands ─────────────────────────────────────
    if $FIX_MODE; then
        echo -e "${BOLD}Suggested fixes:${NC}"
        echo

        if [[ -n "$viable_template_region" ]]; then
            echo "  Option 1 — Switch to a region with available quota:"
            echo
            echo "    azd env set AZURE_LOCATION ${viable_template_region}"
            echo "    azd up"
            echo
        fi

        echo "  Option 2 — Request a quota increase in Azure Portal:"
        echo
        echo "    1. Go to: https://portal.azure.com"
        echo "    2. Navigate: Subscriptions → Your subscription → Usage + quotas"
        echo "    3. Filter by: Azure OpenAI"
        echo "    4. Request increase for the model(s) that failed above"
        echo

        echo "  Option 3 — Reduce requested capacity in infra/main.bicep:"
        echo
        echo "    Edit the 'chatModelCapacity' or 'embeddingModelCapacity' variables"
        echo "    to fit within your available quota."
        echo
    else
        info "Run with ${BOLD}--fix${NC} for suggested remediation commands."
        echo
    fi

    exit 1
}

main "$@"
