#!/bin/bash

# Master test script for all create-index samples
# Usage: ./test-all-create-index.sh [build|lint|all]

set -e

COMMAND="${1:-all}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to run a script and report results
run_check() {
    local check_name=$1
    local script=$2
    
    echo -e "\n${YELLOW}═══════════════════════════════════════${NC}"
    echo -e "${YELLOW}Running: $check_name${NC}"
    echo -e "${YELLOW}═══════════════════════════════════════${NC}\n"
    
    if bash "$script"; then
        echo -e "${GREEN}✅ $check_name passed${NC}\n"
        return 0
    else
        echo -e "${RED}❌ $check_name failed${NC}\n"
        return 1
    fi
}

# Track results
declare -a RESULTS
RESULTS_INDEX=0

echo -e "${YELLOW}Cosmos DB Vector Samples - Create Index Tests${NC}"
echo -e "${YELLOW}Command: $COMMAND${NC}\n"

# Go sample
if [[ "$COMMAND" == "build" || "$COMMAND" == "all" ]]; then
    run_check "Go Build" "$SCRIPT_DIR/build-go.sh" && RESULTS[$RESULTS_INDEX]="✅ Go Build" || RESULTS[$RESULTS_INDEX]="❌ Go Build"
    ((RESULTS_INDEX++))
fi

if [[ "$COMMAND" == "lint" || "$COMMAND" == "all" ]]; then
    run_check "Go Lint" "$SCRIPT_DIR/lint-go.sh" && RESULTS[$RESULTS_INDEX]="✅ Go Lint" || RESULTS[$RESULTS_INDEX]="❌ Go Lint"
    ((RESULTS_INDEX++))
fi

# Python sample
if [[ "$COMMAND" == "build" || "$COMMAND" == "all" ]]; then
    run_check "Python Build" "$SCRIPT_DIR/build-python.sh" && RESULTS[$RESULTS_INDEX]="✅ Python Build" || RESULTS[$RESULTS_INDEX]="❌ Python Build"
    ((RESULTS_INDEX++))
fi

if [[ "$COMMAND" == "lint" || "$COMMAND" == "all" ]]; then
    run_check "Python Lint" "$SCRIPT_DIR/lint-python.sh" && RESULTS[$RESULTS_INDEX]="✅ Python Lint" || RESULTS[$RESULTS_INDEX]="❌ Python Lint"
    ((RESULTS_INDEX++))
fi

# Java sample
if [[ "$COMMAND" == "build" || "$COMMAND" == "all" ]]; then
    run_check "Java Build" "$SCRIPT_DIR/build-java.sh" && RESULTS[$RESULTS_INDEX]="✅ Java Build" || RESULTS[$RESULTS_INDEX]="❌ Java Build"
    ((RESULTS_INDEX++))
fi

# .NET sample
if [[ "$COMMAND" == "build" || "$COMMAND" == "all" ]]; then
    run_check ".NET Build" "$SCRIPT_DIR/build-dotnet.sh" && RESULTS[$RESULTS_INDEX]="✅ .NET Build" || RESULTS[$RESULTS_INDEX]="❌ .NET Build"
    ((RESULTS_INDEX++))
fi

# TypeScript sample
if [[ "$COMMAND" == "build" || "$COMMAND" == "all" ]]; then
    run_check "TypeScript Build" "$SCRIPT_DIR/build-typescript.sh" && RESULTS[$RESULTS_INDEX]="✅ TypeScript Build" || RESULTS[$RESULTS_INDEX]="❌ TypeScript Build"
    ((RESULTS_INDEX++))
fi

if [[ "$COMMAND" == "lint" || "$COMMAND" == "all" ]]; then
    run_check "TypeScript Lint" "$SCRIPT_DIR/lint-typescript.sh" && RESULTS[$RESULTS_INDEX]="✅ TypeScript Lint" || RESULTS[$RESULTS_INDEX]="❌ TypeScript Lint"
    ((RESULTS_INDEX++))
fi

# Print summary
echo -e "\n${YELLOW}═══════════════════════════════════════${NC}"
echo -e "${YELLOW}Summary${NC}"
echo -e "${YELLOW}═══════════════════════════════════════${NC}\n"

for result in "${RESULTS[@]}"; do
    echo -e "$result"
done

echo ""
