# Phase 3 Work Plan: Validation & Testing

**Start Date:** 2026-06-20T16:35:05Z  
**Target Completion:** Phase 3 requirements fully verified and executable

---

## 🎯 Phase 3 Requirements

From PHASE_3_VERIFICATION.md, 4 requirements to complete:

| # | Requirement | Status | Effort | Blocking |
|---|-------------|--------|--------|----------|
| 1 | Region distribution logging | ✅ COMPLETE (All 5 languages) | — | — |
| 2 | RU cost tracking | ✅ Complete | — | — |
| 3 | End-to-end testing | ⏳ Ready to verify | 20 min | No |
| 4 | Cross-language validation | ⏳ Code ready | 45 min | No |

---

## 📋 Work Items

### Task 1: Add Per-Region Logging to Go, Java, .NET
**Status:** ⏳ READY TO START  
**Blocking:** No (can happen in parallel with other tasks)

#### 1a. Go: Add region count logging (dataplane.go)

**Current State (Line ~77):**
```go
// Current: Just prints validation message
fmt.Printf("✓ Region validation passed. Found regions: %v\n", regionSet)
```

**Target (Add after validation):**
```go
// New: Add per-region count logging
regionCounts := make(map[string]int)
for _, doc := range docs {
  region := doc["Region"].(string)
  regionCounts[region]++
}
for _, region := range []string{"Northeast", "Midwest", "South", "West"} {
  if count, exists := regionCounts[region]; exists {
    fmt.Printf("  Region '%s': %d documents\n", region, count)
  }
}
```

**File:** `nosql-create-index-go/dataplane.go` (around line 77-80)  
**Pattern:** Loop through each region, print count (match Python/TypeScript output)

---

#### 1b. Java: Add region count logging (DataPlane.java)

**Current State (Line ~115):**
```java
// Current: Just prints validation message
System.out.println("✓ Region validation passed. Found regions: " + regionSet);
```

**Target (Add after validation):**
```java
// New: Add per-region count logging
Map<String, Integer> regionCounts = new HashMap<>();
for (CosmosItemProperties doc : docs) {
  String region = (String) doc.get("Region");
  regionCounts.put(region, regionCounts.getOrDefault(region, 0) + 1);
}
for (String region : Arrays.asList("Northeast", "Midwest", "South", "West")) {
  if (regionCounts.containsKey(region)) {
    System.out.println("  Region '" + region + "': " + regionCounts.get(region) + " documents");
  }
}
```

**File:** `nosql-create-index-java/src/main/java/com/azure/cosmos/createindex/DataPlane.java` (around line 115)  
**Pattern:** Build region count map, loop and print (match Python/TypeScript output)

---

#### 1c. .NET: Add region count logging (DataPlane.cs)

**Current State (Line ~90):**
```csharp
// Current: Just prints validation message
Console.WriteLine("✓ Region validation passed. Found regions: " + string.Join(", ", regionSet));
```

**Target (Add after validation):**
```csharp
// New: Add per-region count logging
var regionCounts = new Dictionary<string, int>();
foreach (var doc in docs)
{
  string region = (string)doc["Region"];
  if (regionCounts.ContainsKey(region))
    regionCounts[region]++;
  else
    regionCounts[region] = 1;
}
foreach (string region in new[] { "Northeast", "Midwest", "South", "West" })
{
  if (regionCounts.ContainsKey(region))
    Console.WriteLine($"  Region '{region}': {regionCounts[region]} documents");
}
```

**File:** `nosql-create-index-dotnet/src/DataPlane.cs` (around line 90)  
**Pattern:** Build region count dictionary, loop and print (match Python/TypeScript output)

---

### Task 2: Execute End-to-End Tests
**Status:** ⏳ READY TO START (after Task 1)  
**Blocking:** No (can run in parallel)

Create test script `test-phase3-e2e.sh`:

```bash
#!/bin/bash
set -e

# Execute all 5 samples with region-based data file
# Capture output to verify:
# 1. All 50 documents ingest
# 2. Region counts printed
# 3. RU costs logged

echo "=== Phase 3 End-to-End Testing ==="
echo ""

RESULTS_DIR=".github/plans/phase3-results"
mkdir -p "$RESULTS_DIR"

for lang in python typescript go java dotnet; do
  echo "Testing $lang..."
  SAMPLE_DIR="nosql-create-index-$lang"
  OUTPUT_FILE="$RESULTS_DIR/e2e-$lang.txt"
  
  # Run sample (exact command depends on language)
  case $lang in
    python)
      cd "$SAMPLE_DIR"
      python -m src.main > "$OUTPUT_FILE" 2>&1 || true
      cd ..
      ;;
    typescript)
      cd "$SAMPLE_DIR"
      npm run build && npm start > "$OUTPUT_FILE" 2>&1 || true
      cd ..
      ;;
    go)
      cd "$SAMPLE_DIR"
      go run . > "$OUTPUT_FILE" 2>&1 || true
      cd ..
      ;;
    java)
      cd "$SAMPLE_DIR"
      mvn clean compile exec:java > "$OUTPUT_FILE" 2>&1 || true
      cd ..
      ;;
    dotnet)
      cd "$SAMPLE_DIR"
      dotnet run > "$OUTPUT_FILE" 2>&1 || true
      cd ..
      ;;
  esac
  
  # Verify output
  if grep -q "Region.*:" "$OUTPUT_FILE"; then
    echo "  ✓ Region distribution logged"
  else
    echo "  ⚠️ Region distribution NOT found"
  fi
  
  if grep -q "documents ingested\|Total documents\|items inserted" "$OUTPUT_FILE"; then
    echo "  ✓ Ingestion message found"
  else
    echo "  ⚠️ Ingestion message NOT found"
  fi
  
  echo ""
done

echo "=== End-to-end test complete ==="
echo "Results saved to: $RESULTS_DIR"
```

**Expected Output:**
```
=== Phase 3 End-to-End Testing ===

Testing python...
  ✓ Region distribution logged
  ✓ Ingestion message found

Testing typescript...
  ✓ Region distribution logged
  ✓ Ingestion message found

Testing go...
  ✓ Region distribution logged
  ✓ Ingestion message found

Testing java...
  ✓ Region distribution logged
  ✓ Ingestion message found

Testing dotnet...
  ✓ Region distribution logged
  ✓ Ingestion message found

=== End-to-end test complete ===
Results saved to: .github/plans/phase3-results
```

**Acceptance Criteria:**
- All 5 samples run without crashing
- All 5 samples print region distribution
- Output files contain ingestion confirmation
- No uncommitted files left after test

---

### Task 3: Cross-Language Query Validation
**Status:** ⏳ READY TO START (after Task 1+2)  
**Blocking:** No (can run last)

**Expectation:** All 5 SDKs querying the same Cosmos DB container return **identical** results.

Create validation script `test-phase3-validation.sh`:

```bash
#!/bin/bash
set -e

echo "=== Phase 3 Cross-Language Query Validation ==="
echo ""

RESULTS_DIR=".github/plans/phase3-results"
mkdir -p "$RESULTS_DIR"

# All 5 samples query the SAME container with the SAME query
# Results MUST be identical (same documents, same similarity scores, same order)

echo "Comparing query results across all 5 languages..."
echo "Expected: IDENTICAL results (same documents, same similarity scores)"
echo ""

# Execute each sample and extract query results
for lang in python typescript go java dotnet; do
  SAMPLE_DIR="nosql-create-index-$lang"
  QUERY_OUTPUT="$RESULTS_DIR/query-results-$lang.txt"
  
  echo "Capturing $lang query results..."
  
  case $lang in
    python)
      cd "$SAMPLE_DIR"
      python -m src.main 2>&1 | grep -A 50 "Query results\|Top hotels" > "$QUERY_OUTPUT" || echo "No results" > "$QUERY_OUTPUT"
      cd ..
      ;;
    typescript)
      cd "$SAMPLE_DIR"
      npm start 2>&1 | grep -A 50 "Query results\|Top hotels" > "$QUERY_OUTPUT" || echo "No results" > "$QUERY_OUTPUT"
      cd ..
      ;;
    go)
      cd "$SAMPLE_DIR"
      go run . 2>&1 | grep -A 50 "Query results\|Top hotels" > "$QUERY_OUTPUT" || echo "No results" > "$QUERY_OUTPUT"
      cd ..
      ;;
    java)
      cd "$SAMPLE_DIR"
      mvn exec:java 2>&1 | grep -A 50 "Query results\|Top hotels" > "$QUERY_OUTPUT" || echo "No results" > "$QUERY_OUTPUT"
      cd ..
      ;;
    dotnet)
      cd "$SAMPLE_DIR"
      dotnet run 2>&1 | grep -A 50 "Query results\|Top hotels" > "$QUERY_OUTPUT" || echo "No results" > "$QUERY_OUTPUT"
      cd ..
      ;;
  esac
done

echo ""
echo "Comparing results..."
echo ""

COMPARISON_FILE="$RESULTS_DIR/cross-language-validation.txt"

echo "Cross-Language Query Result Validation" > "$COMPARISON_FILE"
echo "=======================================" >> "$COMPARISON_FILE"
echo "" >> "$COMPARISON_FILE"
echo "Expectation: All 5 SDKs return IDENTICAL results (same documents, same similarity scores)" >> "$COMPARISON_FILE"
echo "" >> "$COMPARISON_FILE"

# Compare outputs
PYTHON_OUTPUT="$RESULTS_DIR/query-results-python.txt"
TYPESCRIPT_OUTPUT="$RESULTS_DIR/query-results-typescript.txt"
GO_OUTPUT="$RESULTS_DIR/query-results-go.txt"
JAVA_OUTPUT="$RESULTS_DIR/query-results-java.txt"
DOTNET_OUTPUT="$RESULTS_DIR/query-results-dotnet.txt"

echo "Results by language:" >> "$COMPARISON_FILE"
echo "" >> "$COMPARISON_FILE"

for lang in python typescript go java dotnet; do
  case $lang in
    python) OUTPUT="$PYTHON_OUTPUT" ;;
    typescript) OUTPUT="$TYPESCRIPT_OUTPUT" ;;
    go) OUTPUT="$GO_OUTPUT" ;;
    java) OUTPUT="$JAVA_OUTPUT" ;;
    dotnet) OUTPUT="$DOTNET_OUTPUT" ;;
  esac
  
  if [ -f "$OUTPUT" ] && [ -s "$OUTPUT" ] && ! grep -q "No results" "$OUTPUT"; then
    LINE_COUNT=$(wc -l < "$OUTPUT")
    echo "✓ $lang: Query results captured ($LINE_COUNT lines)" >> "$COMPARISON_FILE"
  else
    echo "⚠️ $lang: Query results NOT found" >> "$COMPARISON_FILE"
  fi
done

echo "" >> "$COMPARISON_FILE"
echo "Comparison:" >> "$COMPARISON_FILE"
echo "" >> "$COMPARISON_FILE"

# Simple diff check - all outputs should be identical
if diff -q "$PYTHON_OUTPUT" "$TYPESCRIPT_OUTPUT" > /dev/null 2>&1; then
  echo "✓ Python == TypeScript" >> "$COMPARISON_FILE"
else
  echo "⚠️ Python != TypeScript (differences detected)" >> "$COMPARISON_FILE"
fi

if diff -q "$PYTHON_OUTPUT" "$GO_OUTPUT" > /dev/null 2>&1; then
  echo "✓ Python == Go" >> "$COMPARISON_FILE"
else
  echo "⚠️ Python != Go (differences detected)" >> "$COMPARISON_FILE"
fi

if diff -q "$PYTHON_OUTPUT" "$JAVA_OUTPUT" > /dev/null 2>&1; then
  echo "✓ Python == Java" >> "$COMPARISON_FILE"
else
  echo "⚠️ Python != Java (differences detected)" >> "$COMPARISON_FILE"
fi

if diff -q "$PYTHON_OUTPUT" "$DOTNET_OUTPUT" > /dev/null 2>&1; then
  echo "✓ Python == .NET" >> "$COMPARISON_FILE"
else
  echo "⚠️ Python != .NET (differences detected)" >> "$COMPARISON_FILE"
fi

echo ""
cat "$COMPARISON_FILE"
echo ""
echo "Detailed results saved to: $RESULTS_DIR"
echo "Individual outputs:"
ls -1 "$RESULTS_DIR"/query-results-*.txt 2>/dev/null | xargs -I {} sh -c 'echo ""; echo "=== {} ==="; head -20 {}'
```

**Acceptance Criteria:**
- Query results captured from all 5 languages ✅
- All 5 outputs are **identical** ✅
- If outputs differ: capture the diff and investigate why
- Generate comparison report documenting result validation

---

## 📊 Checklist Format

As work progresses, mark items complete:

```
Task 1: Add Per-Region Logging
  [ ] 1a. Go: Add region count logging
  [ ] 1b. Java: Add region count logging
  [ ] 1c. .NET: Add region count logging
  [ ] Commit changes with message "feat: add region distribution logging to Go/Java/.NET"
  [ ] Verify: Run grep commands from PHASE_3_VERIFICATION.md for all 5 languages

Task 2: Execute End-to-End Tests
  [ ] Create test-phase3-e2e.sh
  [ ] Run test script (or manual runs)
  [ ] Verify all 5 samples execute without error
  [ ] Verify region distribution output for all 5
  [ ] Capture output to phase3-results/

Task 3: Cross-Language Validation
  [ ] Create test-phase3-validation.sh
  [ ] Run validation script
  [ ] Compare similarity scores across languages
  [ ] Verify results within ±0.01 tolerance (or document variance)
  [ ] Generate cross-language validation report

Final: Update Phase 3 Status
  [ ] Update PHASE_3_VERIFICATION.md with completion evidence
  [ ] Commit all changes
  [ ] Update VERIFICATION_BY_PHASE.md with Phase 3 execution results
  [ ] Clean working tree (no uncommitted files)
```

---

## 🔗 Related Documents

- **PHASE_3_VERIFICATION.md** — Detailed requirement definitions and current status
- **VERIFICATION_BY_PHASE.md** — Master verification guide with replicable commands
- **CODE_REVIEW_FINDINGS.md** — Original Phase 3 scope definition

---

## 🚀 Next Action

Ready to begin Task 1 (Add Per-Region Logging):
1. Modify 3 files: Go, Java, .NET
2. Add region count dictionary/map
3. Loop through regions and print counts
4. Commit with detailed message
5. Verify with grep commands

