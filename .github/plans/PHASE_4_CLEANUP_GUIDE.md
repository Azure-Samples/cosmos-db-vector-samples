# Phase 4: Cleanup Verification & Execution Guide

**Generated:** 2026-06-21T07:19:20Z  
**Phase:** 4 (Cleanup — Clear Documents + Delete Containers)

---

## Overview: Phase 4 Requirements

| Requirement | Description | Status |
|-------------|-------------|--------|
| 4.1 | Document deletion code exists in all 5 languages | 🔍 To verify |
| 4.2 | Container deletion code exists in all 5 languages | 🔍 To verify |
| 4.3 | Cleanup functions are callable from main() | 🔍 To verify |
| 4.4 | Main function orchestrates full cleanup flow | 🔍 To verify |

---

## 1. Code-Level Verification (Static Analysis)

### 1.1 Document Deletion Methods

**Expected:** All 5 languages have document deletion capability

**Verification Script:**
```bash
echo "=== 1.1: Document Deletion Methods ==="

for lang in python typescript go java dotnet; do
  case $lang in
    python)
      echo -n "Python: "
      grep -c "delete_item\|deleteItem\|delete.*item" nosql-create-index-python/src/data_plane.py 2>/dev/null || echo "0" 
      ;;
    typescript)
      echo -n "TypeScript: "
      grep -c "deleteItem\|delete.*Item" nosql-create-index-typescript/src/data-plane.ts 2>/dev/null || echo "0"
      ;;
    go)
      echo -n "Go: "
      grep -c "DeleteItem\|deleteItem" nosql-create-index-go/dataplane.go 2>/dev/null || echo "0"
      ;;
    java)
      echo -n "Java: "
      grep -c "deleteItem\|delete" nosql-create-index-java/src/main/java/com/azure/cosmos/createindex/DataPlane.java 2>/dev/null || echo "0"
      ;;
    dotnet)
      echo -n ".NET: "
      grep -c "DeleteItemAsync\|DeleteAsync" nosql-create-index-dotnet/src/DataPlane.cs 2>/dev/null || echo "0"
      ;;
  esac
done
```

**Expected Result:** All 5 should show count >= 1

### 1.2 Container Deletion Methods

**Expected:** All 5 languages have container deletion capability

**Verification Script:**
```bash
echo "=== 1.2: Container Deletion Methods ==="

for lang in python typescript go java dotnet; do
  case $lang in
    python)
      echo -n "Python: "
      grep -c "delete.*container\|deleteContainer" nosql-create-index-python/src/control_plane.py 2>/dev/null || echo "0"
      ;;
    typescript)
      echo -n "TypeScript: "
      grep -c "deleteContainer\|delete.*Container" nosql-create-index-typescript/src/control-plane.ts 2>/dev/null || echo "0"
      ;;
    go)
      echo -n "Go: "
      grep -c "DeleteContainer" nosql-create-index-go/controlplane.go 2>/dev/null || echo "0"
      ;;
    java)
      echo -n "Java: "
      grep -c "deleteContainer\|DeleteContainer\|delete" nosql-create-index-java/src/main/java/com/azure/cosmos/createindex/ControlPlane.java 2>/dev/null || echo "0"
      ;;
    dotnet)
      echo -n ".NET: "
      grep -c "DeleteContainerAsync\|DeleteAsync" nosql-create-index-dotnet/src/ControlPlane.cs 2>/dev/null || echo "0"
      ;;
  esac
done
```

**Expected Result:** All 5 should show count >= 1

### 1.3 Main Function Orchestration

**Expected:** main() orchestrates cleanup sequence

**Verification Script:**
```bash
echo "=== 1.3: Main Function Orchestration ==="

# Check if main() calls cleanup functions
echo "Checking main() structure:"

# Python: main() should call cleanup
echo -n "Python main() imports/calls cleanup: "
grep -l "def main\|from.*cleanup\|delete\|cleanup" nosql-create-index-python/src/main.py 2>/dev/null && echo "✓" || echo "✗"

# TypeScript: main() should call cleanup
echo -n "TypeScript main() calls cleanup: "
grep -l "async function main\|deleteContainer\|cleanup" nosql-create-index-typescript/src/main.ts 2>/dev/null && echo "✓" || echo "✗"

# Go: main() should call cleanup
echo -n "Go main() calls cleanup: "
grep -l "func main\|DeleteContainer\|cleanup" nosql-create-index-go/main.go 2>/dev/null && echo "✓" || echo "✗"

# Java: main() should call cleanup
echo -n "Java main() calls cleanup: "
grep -l "public static void main\|deleteContainer\|cleanup" nosql-create-index-java/src/main/java/com/azure/cosmos/createindex/Program.java 2>/dev/null && echo "✓" || echo "✗"

# .NET: Main() should call cleanup
echo -n ".NET Main() calls cleanup: "
grep -l "static async Task Main\|DeleteContainerAsync\|cleanup" nosql-create-index-dotnet/src/Program.cs 2>/dev/null && echo "✓" || echo "✗"
```

**Expected Result:** All 5 main functions should show ✓

---

## 2. Runtime Verification (Execution)

Phase 4 runtime verification requires:
1. Running cleanup operations
2. Verifying Cosmos DB state changes
3. Confirming containers are deleted

**Safety Note:** Only run cleanup if:
- All prior phases have been verified
- You have access to Azure CLI (`az cosmosdb sql container delete`)
- Test data can be safely deleted

### 2.1 Pre-Cleanup State Check

```bash
echo "=== PRE-CLEANUP: Verify containers exist ==="

# List containers before cleanup
az cosmosdb sql container list \
  --resource-group $RESOURCE_GROUP \
  --account-name $COSMOS_DB_ACCOUNT \
  --database-name $DATABASE_NAME \
  --query "[].name" -o table
```

**Expected:** Output shows `hotels_diskann` and `hotels_quantizedflat`

### 2.2 Execute Cleanup (All Languages)

```bash
#!/bin/bash

# Python cleanup
echo "Running Python cleanup..."
cd nosql-create-index-python
python -m src.main cleanup 2>&1 | tail -10
cd ..

# TypeScript cleanup
echo "Running TypeScript cleanup..."
cd nosql-create-index-typescript
npm run cleanup 2>&1 | tail -10
cd ..

# Go cleanup
echo "Running Go cleanup..."
cd nosql-create-index-go
go run . cleanup 2>&1 | tail -10
cd ..

# Java cleanup
echo "Running Java cleanup..."
cd nosql-create-index-java
mvn exec:java@cleanup 2>&1 | tail -10
cd ..

# .NET cleanup
echo "Running .NET cleanup..."
cd nosql-create-index-dotnet
dotnet run -- cleanup 2>&1 | tail -10
cd ..
```

### 2.3 Post-Cleanup State Check

```bash
echo "=== POST-CLEANUP: Verify containers deleted ==="

# List containers after cleanup
az cosmosdb sql container list \
  --resource-group $RESOURCE_GROUP \
  --account-name $COSMOS_DB_ACCOUNT \
  --database-name $DATABASE_NAME \
  --query "[].name" -o table
```

**Expected:** Output is empty or shows no `hotels_*` containers

---

## 3. Acceptance Criteria

| Criterion | Description | Pass Condition |
|-----------|-------------|-----------------|
| 4.1.1 | Document deletion code exists in all 5 languages | grep count >= 1 for each language |
| 4.1.2 | Container deletion code exists in all 5 languages | grep count >= 1 for each language |
| 4.2.1 | main() calls cleanup functions | All 5 languages show ✓ |
| 4.3.1 | Cleanup executes without errors | Exit code 0 for all 5 |
| 4.3.2 | Post-cleanup state verified | Containers no longer exist in Cosmos DB |

---

## 4. Verification Results

### Static Analysis Results (Code-Level)

**Status:** To be filled after running verification

```
Document Deletion Methods:
  [ ] Python: _count_ matches
  [ ] TypeScript: _count_ matches
  [ ] Go: _count_ matches
  [ ] Java: _count_ matches
  [ ] .NET: _count_ matches

Container Deletion Methods:
  [ ] Python: _count_ matches
  [ ] TypeScript: _count_ matches
  [ ] Go: _count_ matches
  [ ] Java: _count_ matches
  [ ] .NET: _count_ matches

Main Function Orchestration:
  [ ] Python: Calls cleanup functions
  [ ] TypeScript: Calls cleanup functions
  [ ] Go: Calls cleanup functions
  [ ] Java: Calls cleanup functions
  [ ] .NET: Calls cleanup functions
```

### Runtime Results (Execution)

**Status:** To be filled after running cleanup

```
Pre-Cleanup Containers:
  [ ] hotels_diskann: exists
  [ ] hotels_quantizedflat: exists

Cleanup Execution:
  [ ] Python: Exit code 0
  [ ] TypeScript: Exit code 0
  [ ] Go: Exit code 0
  [ ] Java: Exit code 0
  [ ] .NET: Exit code 0

Post-Cleanup Containers:
  [ ] hotels_diskann: deleted
  [ ] hotels_quantizedflat: deleted
```

---

## 5. Programmatic Verification Summary

Create `verify-phase-4.sh`:

```bash
#!/bin/bash

echo "╔════════════════════════════════════════╗"
echo "║  PHASE 4: CLEANUP VERIFICATION          ║"
echo "╚════════════════════════════════════════╝"
echo ""

PASS_COUNT=0
FAIL_COUNT=0

# Test 1: Document deletion code exists
echo "Test 1: Document deletion methods..."
for file in \
  nosql-create-index-python/src/data_plane.py \
  nosql-create-index-typescript/src/data-plane.ts \
  nosql-create-index-go/dataplane.go \
  nosql-create-index-java/src/main/java/com/azure/cosmos/createindex/DataPlane.java \
  nosql-create-index-dotnet/src/DataPlane.cs; do
  if grep -q "deleteItem\|delete_item\|DeleteItem\|DeleteAsync" "$file" 2>/dev/null; then
    echo "  ✓ $(basename $(dirname $file)): Found deletion method"
    ((PASS_COUNT++))
  else
    echo "  ✗ $(basename $(dirname $file)): NO deletion method"
    ((FAIL_COUNT++))
  fi
done

echo ""

# Test 2: Container deletion code exists
echo "Test 2: Container deletion methods..."
for file in \
  nosql-create-index-python/src/control_plane.py \
  nosql-create-index-typescript/src/control-plane.ts \
  nosql-create-index-go/controlplane.go \
  nosql-create-index-java/src/main/java/com/azure/cosmos/createindex/ControlPlane.java \
  nosql-create-index-dotnet/src/ControlPlane.cs; do
  if grep -q "deleteContainer\|DeleteContainer\|DeleteContainerAsync" "$file" 2>/dev/null; then
    echo "  ✓ $(basename $(dirname $file)): Found container deletion"
    ((PASS_COUNT++))
  else
    echo "  ✗ $(basename $(dirname $file)): NO container deletion"
    ((FAIL_COUNT++))
  fi
done

echo ""
echo "═══════════════════════════════════════"
echo "Results: $PASS_COUNT passed, $FAIL_COUNT failed"
echo "═══════════════════════════════════════"

if [ $FAIL_COUNT -eq 0 ]; then
  echo "✅ PHASE 4: ALL CHECKS PASSED"
  exit 0
else
  echo "⚠️ PHASE 4: SOME CHECKS FAILED"
  exit 1
fi
```

Run with: `bash verify-phase-4.sh`

---

## Next Steps

1. **Execute static analysis** (code-level verification)
2. **Run cleanup operations** (if safe)
3. **Verify Cosmos DB state** (confirm containers deleted)
4. **Document results** in this file
5. **Commit verification** to branch

