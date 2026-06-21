# Phase 3 Execution Guide: Validation & Testing

**Date:** 2026-06-21  
**Status:** Ready to execute Tasks 2 & 3

---

## Phase 3 Completion Status

| Task | Requirement | Status | Evidence |
|------|-------------|--------|----------|
| Task 1 | Add region distribution logging to all 5 languages | ✅ COMPLETE | Commit: f4fc8b5 |
| Task 2 | Execute end-to-end tests across all 5 languages | ⏳ READY | See execution steps below |
| Task 3 | Cross-language query validation (identical results) | ⏳ READY | See verification steps below |

---

## Task 2: End-to-End Testing Checklist

### Prerequisites Check
- [ ] Python environment set up (venv created, requirements.txt installed)
- [ ] TypeScript environment set up (npm install complete)
- [ ] Go environment set up (go mod ready)
- [ ] Java environment set up (Maven pom.xml configured)
- [ ] .NET environment set up (project restored)
- [ ] `.env` file populated with Azure credentials (✅ CONFIRMED in all 5 samples)
- [ ] Data file present: `data/HotelsData_toCosmosDB_Vector.json` (✅ CONFIRMED in all 5 samples)

### Execution Steps

#### Python E2E Test
```bash
cd nosql-create-index-python
python -m src.index 2>&1 | tee ../../.github/plans/phase3-results/e2e-python.txt
```

**Expected output contains:**
- ✅ Configuration validation messages
- ✅ "Region 'Northeast': N documents" (and other regions)
- ✅ "RU" or "Request Units" cost tracking
- ✅ "Successfully upserted" or similar ingestion confirmation

---

#### TypeScript E2E Test
```bash
cd nosql-create-index-typescript
npm install (if not done)
npm start 2>&1 | tee ../../.github/plans/phase3-results/e2e-typescript.txt
```

**Expected output contains:**
- ✅ Configuration validation
- ✅ "Region 'Northeast': N documents" (and other regions)
- ✅ RU cost information
- ✅ Query results with vector distance scores

---

#### Go E2E Test
```bash
cd nosql-create-index-go
go run . 2>&1 | tee ../../.github/plans/phase3-results/e2e-go.txt
```

**Expected output contains:**
- ✅ Configuration validation
- ✅ "Region 'Northeast': N documents" (and other regions)
- ✅ RU consumption details
- ✅ Vector query results

---

#### Java E2E Test
```bash
cd nosql-create-index-java
mvn clean compile exec:java -Dexec.mainClass="com.azure.cosmos.createindex.App" 2>&1 | tee ../../.github/plans/phase3-results/e2e-java.txt
```

**Expected output contains:**
- ✅ Configuration validation
- ✅ "Region 'Northeast': N documents" (and other regions)
- ✅ RU metrics
- ✅ Query results

---

#### .NET E2E Test
```bash
cd nosql-create-index-dotnet
dotnet run 2>&1 | tee ../../.github/plans/phase3-results/e2e-dotnet.txt
```

**Expected output contains:**
- ✅ Configuration validation
- ✅ "Region 'Northeast': N documents" (and other regions)
- ✅ RU cost tracking
- ✅ Query results

---

### Verification for Task 2

After running all 5 E2E tests, verify:

```bash
# Check all output files were created
ls -la .github/plans/phase3-results/e2e-*.txt

# Verify region distribution logging in each
for file in .github/plans/phase3-results/e2e-*.txt; do
  echo "=== $(basename $file) ==="
  grep "Region.*:" "$file" || echo "❌ NO REGION DISTRIBUTION FOUND"
done

# Verify RU cost tracking in each
for file in .github/plans/phase3-results/e2e-*.txt; do
  echo "=== $(basename $file) RU Tracking ==="
  grep -i "RU\|request unit" "$file" || echo "⚠️ RU tracking not found"
done
```

---

## Task 3: Cross-Language Query Validation

### Goal
Verify that all 5 SDKs return IDENTICAL query results when querying the same Cosmos DB container.

### Why This Matters
- The database itself returns one answer
- All 5 SDKs querying the same data must get the same results
- Differences would indicate SDK implementation bugs or data inconsistencies

### Verification Steps

1. **Extract Query Results from Each E2E Output**

Each sample prints query results in the following format:

```
VectorDistance query results:
  Hotel: "Hotel Name" (distance: 0.XXXX)
  Hotel: "Hotel Name" (distance: 0.XXXX)
  ...
```

2. **Capture Results to Separate Files**

```bash
# Extract query results from each language's output
for lang in python typescript go java dotnet; do
  INPUT=".github/plans/phase3-results/e2e-$lang.txt"
  OUTPUT=".github/plans/phase3-results/query-results-$lang.txt"
  
  if [ -f "$INPUT" ]; then
    # Extract the query results section (everything from first "Hotel:" to end)
    grep -A 50 "VectorDistance query" "$INPUT" > "$OUTPUT" || echo "No query results found in $lang output"
  fi
done
```

3. **Compare All Results**

```bash
# All results should be IDENTICAL
echo "=== Cross-Language Query Results Comparison ==="

# Method 1: diff all against Python (baseline)
BASELINE=".github/plans/phase3-results/query-results-python.txt"
for lang in typescript go java dotnet; do
  FILE=".github/plans/phase3-results/query-results-$lang.txt"
  if diff -u "$BASELINE" "$FILE" > /dev/null 2>&1; then
    echo "✅ $lang matches Python"
  else
    echo "❌ $lang DIFFERS from Python"
    echo "Diff:"
    diff -u "$BASELINE" "$FILE" | head -20
  fi
done
```

### Expected Verification Result

```
✅ typescript matches Python
✅ go matches Python
✅ java matches Python
✅ dotnet matches Python
```

If any language produces DIFFERENT results, that indicates:
1. SDK implementation issue
2. Data consistency problem
3. Embedding or query dimension mismatch
4. Cosmos DB configuration issue

---

## Completing Phase 3

Once all verification steps pass:

1. ✅ Task 1: Region distribution logging complete (DONE)
2. ✅ Task 2: E2E tests execute successfully on all 5 languages
3. ✅ Task 3: All 5 SDKs return identical query results
4. ✅ Task 4: Document results and commit evidence

Then Phase 3 is VERIFIED COMPLETE.

---

## Quick Command Summary

Run all E2E tests and capture output:

```bash
mkdir -p .github/plans/phase3-results

# Python
cd nosql-create-index-python && python -m src.index > ../.github/plans/phase3-results/e2e-python.txt 2>&1 && cd ..

# TypeScript
cd nosql-create-index-typescript && npm install && npm start > ../.github/plans/phase3-results/e2e-typescript.txt 2>&1 && cd ..

# Go
cd nosql-create-index-go && go run . > ../.github/plans/phase3-results/e2e-go.txt 2>&1 && cd ..

# Java
cd nosql-create-index-java && mvn clean compile exec:java -Dexec.mainClass="com.azure.cosmos.createindex.App" > ../.github/plans/phase3-results/e2e-java.txt 2>&1 && cd ..

# .NET
cd nosql-create-index-dotnet && dotnet run > ../.github/plans/phase3-results/e2e-dotnet.txt 2>&1 && cd ..

# Verify all tests ran
ls -la .github/plans/phase3-results/
```

---

## Notes

- All tests require valid Azure credentials (via `DefaultAzureCredential`)
- `.env` file must be populated with correct Cosmos DB and OpenAI endpoints
- Tests access live Azure resources; expect network latency
- Each test should complete in 30-60 seconds depending on network
- Query results are dependent on the exact dataset and query; outputs should be deterministic across runs
