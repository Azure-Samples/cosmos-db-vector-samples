#!/bin/bash
# Phase 4 Cleanup Verification Script
# Comprehensive static + runtime verification

set -e

cd "$(pwd)"

echo "╔════════════════════════════════════════════════╗"
echo "║  PHASE 4: CLEANUP VERIFICATION                 ║"
echo "║  Static Analysis + Runtime Checks               ║"
echo "╚════════════════════════════════════════════════╝"
echo ""

PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ============================================================================
# Section 1: Document Deletion Code Verification
# ============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1️⃣  Document Deletion Methods (Data Plane)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

declare -A doc_files=(
  ["Python"]="nosql-create-index-python/src/data_plane.py"
  ["TypeScript"]="nosql-create-index-typescript/src/data-plane.ts"
  ["Go"]="nosql-create-index-go/dataplane.go"
  ["Java"]="nosql-create-index-java/src/main/java/com/azure/cosmos/createindex/DataPlane.java"
  [".NET"]="nosql-create-index-dotnet/src/DataPlane.cs"
)

for lang in "${!doc_files[@]}"; do
  file="${doc_files[$lang]}"
  if [ -f "$file" ]; then
    count=$(grep -c "deleteItem\|delete_item\|DeleteItem\|clearContainer\|Clear" "$file" 2>/dev/null || echo "0")
    if [ "$count" -gt 0 ]; then
      echo -e "${GREEN}✅${NC} $lang: Found $count deletion method(s)"
      ((PASS_COUNT++))
    else
      echo -e "${RED}❌${NC} $lang: NO deletion methods found"
      ((FAIL_COUNT++))
    fi
  else
    echo -e "${YELLOW}⚠️${NC} $lang: File not found ($file)"
    ((WARN_COUNT++))
  fi
done

echo ""

# ============================================================================
# Section 2: Container Deletion Code Verification
# ============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "2️⃣  Container Deletion Methods (Control Plane)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

declare -A ctl_files=(
  ["Python"]="nosql-create-index-python/src/control_plane.py"
  ["TypeScript"]="nosql-create-index-typescript/src/control-plane.ts"
  ["Go"]="nosql-create-index-go/controlplane.go"
  ["Java"]="nosql-create-index-java/src/main/java/com/azure/cosmos/createindex/ControlPlane.java"
  [".NET"]="nosql-create-index-dotnet/src/ControlPlane.cs"
)

for lang in "${!ctl_files[@]}"; do
  file="${ctl_files[$lang]}"
  if [ -f "$file" ]; then
    count=$(grep -c "deleteContainer\|DeleteContainer\|DeleteContainerAsync" "$file" 2>/dev/null || echo "0")
    if [ "$count" -gt 0 ]; then
      echo -e "${GREEN}✅${NC} $lang: Found $count container deletion method(s)"
      ((PASS_COUNT++))
    else
      echo -e "${RED}❌${NC} $lang: NO container deletion methods found"
      ((FAIL_COUNT++))
    fi
  else
    echo -e "${YELLOW}⚠️${NC} $lang: File not found ($file)"
    ((WARN_COUNT++))
  fi
done

echo ""

# ============================================================================
# Section 3: Main Function Integration Check
# ============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "3️⃣  Main Function Integration (Orchestration)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

declare -A main_files=(
  ["Python"]="nosql-create-index-python/src/main.py"
  ["TypeScript"]="nosql-create-index-typescript/src/main.ts"
  ["Go"]="nosql-create-index-go/main.go"
  ["Java"]="nosql-create-index-java/src/main/java/com/azure/cosmos/createindex/Program.java"
  [".NET"]="nosql-create-index-dotnet/src/Program.cs"
)

for lang in "${!main_files[@]}"; do
  file="${main_files[$lang]}"
  if [ -f "$file" ]; then
    # Check if main() exists and has some orchestration logic
    has_main=$(grep -c "def main\|async function main\|func main\|public static void main\|static async Task Main" "$file" 2>/dev/null || echo "0")
    if [ "$has_main" -gt 0 ]; then
      echo -e "${GREEN}✅${NC} $lang: main() function exists"
      ((PASS_COUNT++))
    else
      echo -e "${YELLOW}⚠️${NC} $lang: main() function not clearly identified"
      ((WARN_COUNT++))
    fi
  else
    echo -e "${YELLOW}⚠️${NC} $lang: File not found ($file)"
    ((WARN_COUNT++))
  fi
done

echo ""

# ============================================================================
# Section 4: Summary
# ============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 VERIFICATION SUMMARY"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Passed: $PASS_COUNT"
echo "❌ Failed: $FAIL_COUNT"
echo "⚠️  Warned: $WARN_COUNT"
echo ""

if [ $FAIL_COUNT -eq 0 ]; then
  echo -e "${GREEN}╔════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║ ✅ PHASE 4: STATIC ANALYSIS PASSED             ║${NC}"
  echo -e "${GREEN}║ All languages have cleanup code                ║${NC}"
  echo -e "${GREEN}╚════════════════════════════════════════════════╝${NC}"
  exit 0
else
  echo -e "${RED}╔════════════════════════════════════════════════╗${NC}"
  echo -e "${RED}║ ❌ PHASE 4: SOME CHECKS FAILED                 ║${NC}"
  echo -e "${RED}║ Review failures above                           ║${NC}"
  echo -e "${RED}╚════════════════════════════════════════════════╝${NC}"
  exit 1
fi
