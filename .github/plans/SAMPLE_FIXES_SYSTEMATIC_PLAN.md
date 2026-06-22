# Systematic Plan: Complete 2-Part Goal Across All 5 Create-Index Samples

**Date:** 2026-06-21  
**Goal:** Systematically update every create-index sample to fully implement both goals:
1. **Goal 1 (Control Plane):** Use ARM SDK to programmatically create containers + vector indexes
2. **Goal 2 (Data Plane):** Implement identical distance function queries across all 5 languages

---

## Executive Summary

This plan provides a **step-by-step workflow** to fix each sample in the correct order, with clear verification criteria. The approach:
1. Analyze current state of each sample (what's working, what's missing)
2. Decompose work into **5 synchronized phases** (config, control plane, data plane, output, tests)
3. Use Python (baseline ✅) as the reference implementation
4. Apply identical patterns to TypeScript, Go, Java, .NET in parallel
5. Verify both goals are complete for each language before moving to next phase

---

## Phase Overview

| Phase | Focus | Deliverable | Goal(s) |
|-------|-------|-------------|---------|
| **Phase 1: Analysis & Mapping** | Understand current state | Gap analysis doc + code mapping | Foundation |
| **Phase 2: Control Plane (ARM SDK)** | Implement container + index creation | All 5 samples use ARM SDK | Goal 1 |
| **Phase 3: Data Plane (Distance Functions)** | Implement queries with 3 distance functions | All 5 samples query with Cosine, DotProduct, Euclidean | Goal 2 |
| **Phase 4: Output Formatting** | Standardize results across languages | Identical table format, cross-language consistency | Goal 2 |
| **Phase 5: Verification & Documentation** | Test end-to-end, document results | Updated README, verified outputs per language | Both |

---

## Phase 1: Analysis & Mapping

### 1.1 Current State Analysis

#### Python (✅ BASELINE — Both Goals Complete)
- **Structure:** `src/{config, control_plane, data_plane, index}.py`
- **Goal 1 (Control Plane):** ✅ Uses ARM? NO — Uses Bicep pre-provisioning + data plane SDK
- **Goal 2 (Data Plane):** ✅ Distance functions? YES — Cosine, DotProduct, Euclidean all implemented
- **Dependencies:** `azure-cosmos`, `azure-identity`, `openai`
- **Status:** Data plane verified; control plane uses Bicep (pre-provisioned containers)

#### TypeScript (⏳ PARTIAL — Goal 1 Complete, Goal 2 Pending)
- **Structure:** `src/{config, control_plane, data_plane, index}.ts` + `package.json`
- **Goal 1 (Control Plane):** ✅ Uses ARM? YES — Has ARM SDK code for container/index creation
- **Goal 2 (Data Plane):** ⏳ Distance functions? PARTIAL — Needs full implementation of all 3
- **Dependencies:** `@azure/cosmos`, `@azure/arm-cosmosdb`, `@azure/identity`, `openai`
- **Status:** Control plane done; data plane needs work

#### Go (❌ INCOMPLETE — Both Goals Missing)
- **Structure:** `{config, control_plane, dataplane}.go` + `go.mod`
- **Goal 1 (Control Plane):** ❌ Uses ARM? NO — No ARM SDK usage detected
- **Goal 2 (Data Plane):** ❌ Distance functions? NO — Needs implementation
- **Dependencies:** Missing `armcosmos` package; data plane queries incomplete
- **Status:** Skeleton exists; both goals need full implementation

#### Java (❌ INCOMPLETE — Both Goals Missing)
- **Structure:** `src/main/java/.../` + `pom.xml`
- **Goal 1 (Control Plane):** ❌ Uses ARM? NO — No ARM SDK usage detected
- **Goal 2 (Data Plane):** ❌ Distance functions? NO — Needs implementation
- **Dependencies:** Missing `azure-resourcemanager-cosmos`; data plane incomplete
- **Status:** Skeleton exists; both goals need full implementation

#### .NET (❌ INCOMPLETE — Both Goals Missing)
- **Structure:** `src/` + `nosql-create-index-dotnet.csproj`
- **Goal 1 (Control Plane):** ❌ Uses ARM? NO — No ARM SDK usage detected
- **Goal 2 (Data Plane):** ❌ Distance functions? NO — Needs implementation
- **Dependencies:** Missing `Azure.ResourceManager.CosmosDB`; data plane incomplete
- **Status:** Skeleton exists; both goals need full implementation

### 1.2 Work Order Matrix

| Sample | Phase 1 (ARM SDK) | Phase 2 (Distance Funcs) | Phase 3 (Output) | Parallel? | Priority |
|--------|-------------------|--------------------------|------------------|-----------|----------|
| Python | ✅ SKIP | ✅ SKIP | ✅ SKIP | — | Reference |
| TypeScript | ✅ SKIP | 🔴 TODO | ✅ REVIEW | Yes | 1 |
| Go | 🔴 TODO | 🔴 TODO | 🔴 TODO | Yes | 1 |
| Java | 🔴 TODO | 🔴 TODO | 🔴 TODO | Yes | 1 |
| .NET | 🔴 TODO | 🔴 TODO | 🔴 TODO | Yes | 1 |

---

## Phase 2: Control Plane — ARM SDK Implementation

### 2.1 Goal 1 Requirement

Each language must use its ARM SDK to **programmatically create**:
1. **Database container** with specified name and partition key
2. **Vector indexes** (DiskANN + QuantizedFlat) with all 3 distance functions

### 2.2 ARM SDK to Use (Per Language)

| Language | ARM SDK | Import | Client Class |
|----------|---------|--------|--------------|
| Python | `azure-mgmt-cosmosdb` | `from azure.mgmt.cosmosdb import CosmosDBManagementClient` | `CosmosDBManagementClient` |
| TypeScript | `@azure/arm-cosmosdb` | `import { CosmosDBManagementClient } from "@azure/arm-cosmosdb"` | `CosmosDBManagementClient` |
| Go | `github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/cosmos/armcosmos` | `import "github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/cosmos/armcosmos"` | `DatabaseAccountsClient`, etc. |
| Java | `com.azure.resourcemanager:azure-resourcemanager-cosmos` | Maven dependency + import | `AzureResourceManager.cosmosDBAccounts()` |
| .NET | `Azure.ResourceManager.CosmosDB` | `using Azure.ResourceManager.CosmosDB` | `CosmosDBAccountResource` |

### 2.3 Implementation Checklist (Per Sample)

For each sample (TypeScript, Go, Java, .NET):

- [ ] **Add ARM SDK to dependencies**
  - Python: Update `requirements.txt` → add `azure-mgmt-cosmosdb`
  - TypeScript: Update `package.json` → add `@azure/arm-cosmosdb`
  - Go: Update `go.mod` → add `github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/cosmos/armcosmos`
  - Java: Update `pom.xml` → add `com.azure.resourcemanager:azure-resourcemanager-cosmos`
  - .NET: Update `.csproj` → add `Azure.ResourceManager.CosmosDB`

- [ ] **Create ARM SDK client** in `control_plane.*`
  - Initialize with subscription ID + credentials (DefaultAzureCredential)
  - Authenticate once at startup

- [ ] **Implement container creation**
  - Use ARM SDK to create container with:
    - Name: `hotels` (or per config)
    - Partition key: `/Region`
    - Throughput: 400 RU/s (shared)

- [ ] **Implement vector index creation**
  - Use ARM SDK to create composite index with:
    - **DiskANN index:**
      - Field: `vector`
      - Type: Vector
      - Dimensions: 1536
      - Distance function: DiskANN (default)
    - **QuantizedFlat index:**
      - Field: `vector`
      - Type: Vector
      - Dimensions: 1536
      - Distance function: QuantizedFlat

- [ ] **Handle immutability** (vector indexes cannot be modified after creation)
  - Check if indexes already exist before creating
  - Add defensive "get or create" logic

- [ ] **Test ARM SDK portion**
  - Verify container is created with correct partition key
  - Verify both vector indexes are created with correct types

### 2.4 Phase 2 Verification

Run for each language:
```bash
# 1. Check container exists with correct partition key
az cosmosdb sql container show --resource-group <rg> --account-name <account> --database-name <db> --name hotels

# 2. Check vector indexes exist
az cosmosdb sql container throughput show --resource-group <rg> --account-name <account> --database-name <db> --name hotels
```

---

## Phase 3: Data Plane — Distance Function Implementation

### 3.1 Goal 2 Requirement

Each language must implement **identical data plane operations**:
1. **Ingest:** Insert 50 hotel documents with embeddings
2. **Query:** Execute search queries using all 3 distance functions:
   - Cosine similarity
   - DotProduct similarity
   - Euclidean distance
3. **Verify:** All 5 languages return **identical results** for same query

### 3.2 Implementation Checklist (Per Sample)

For each sample (TypeScript, Go, Java, .NET):

- [ ] **Data plane SDK** (client for documents, not management)
  - Verify data plane SDK is in dependencies (NOT ARM SDK)
  - Python: `azure-cosmos` (data plane only)
  - TypeScript: `@azure/cosmos` (data plane only)
  - Go: `github.com/Azure/azure-sdk-for-go/sdk/data/azcosmos`
  - Java: `com.azure:azure-cosmos` (data plane only)
  - .NET: `Microsoft.Azure.Cosmos` (data plane only)

- [ ] **Implement ingestion** in `data_plane.*`
  - Read 50 hotel documents from `../data/hotels.json`
  - Generate embeddings via OpenAI API (same as Python)
  - Upsert documents to Cosmos DB container
  - Verify all 50 documents inserted

- [ ] **Implement Cosine distance query**
  - SELECT with WHERE clause using `VectorDistance()` function
  - Distance function: `"cosine"`
  - Query: `SELECT TOP 2 c.name, VectorDistance(c.vector, @embedding) as score FROM c WHERE VectorDistance(c.vector, @embedding, true) < 0.8 ORDER BY score DESC`
  - Verify results match Python baseline

- [ ] **Implement DotProduct distance query**
  - SELECT with WHERE clause using `VectorDistance()` function
  - Distance function: `"dotproduct"`
  - Query: `SELECT TOP 2 c.name, VectorDistance(c.vector, @embedding) as score FROM c WHERE VectorDistance(c.vector, @embedding, false) > 0.5 ORDER BY score DESC`
  - Verify results match Python baseline

- [ ] **Implement Euclidean distance query**
  - SELECT with WHERE clause using `VectorDistance()` function
  - Distance function: `"euclidean"`
  - Query: `SELECT TOP 2 c.name, VectorDistance(c.vector, @embedding) as score FROM c ORDER BY score ASC`
  - Verify results match Python baseline (note: euclidean is inverted — lower = better)

- [ ] **Test data plane queries**
  - Run all 3 queries for same embedding
  - Verify results are identical to Python output
  - Verify score values match (within floating point precision)

### 3.3 Phase 3 Verification

Run for each language:
```bash
# 1. Check ingestion count
# Output should show: "Inserted 50 documents"

# 2. Run each query and compare to Python baseline
# Execute: Cosine, DotProduct, Euclidean
# Compare TOP 2 results + scores
```

---

## Phase 4: Output Formatting & Consistency

### 4.1 Output Requirement

All 5 languages must produce **identical table format** for results:

```
Index Type: DiskANN
Distance Function: Cosine
Query: "hotel near the ocean"

Top Results:
| Rank | Hotel Name | Score |
|------|------------|-------|
| 1    | Windy Ocean Motel | 0.5268 |
| 2    | Ocean Water Resort & Spa | 0.5177 |
```

### 4.2 Implementation Checklist

For each sample (TypeScript, Go, Java, .NET):

- [ ] **Create output table formatter** in `index.*`
  - Accept: index type, distance function, query, results
  - Format as ASCII table (no Unicode, no fancy borders)
  - Include: Rank, Hotel Name, Score columns
  - Round scores to 4 decimal places

- [ ] **Capture output to file**
  - Write results to `output/{language}_results.txt`
  - Include all 6 scenarios (2 index types × 3 distance functions)

- [ ] **Cross-language comparison**
  - After all 5 samples complete, diff output files
  - Verify top 2 results are identical
  - Verify scores match (within 0.0001 tolerance for floating point)

### 4.3 Phase 4 Verification

```bash
# 1. Check output files exist
ls output/

# 2. Compare across languages
diff output/python_results.txt output/typescript_results.txt
diff output/python_results.txt output/go_results.txt
# ... (all pairwise diffs)

# 3. Verify each language has all 6 scenarios
grep -c "Index Type:" output/*.txt
# Should show: 6 per file
```

---

## Phase 5: Verification & Documentation

### 5.1 End-to-End Verification

For each language sample:

- [ ] **Run full sample end-to-end**
  ```bash
  cd nosql-create-index-{language}
  # Python: python -m pytest src/
  # TypeScript: npm test
  # Go: go test ./...
  # Java: mvn test
  # .NET: dotnet test
  ```

- [ ] **Verify Goal 1 (Control Plane)**
  - [ ] Container created via ARM SDK
  - [ ] Vector indexes created via ARM SDK
  - [ ] DiskANN index present
  - [ ] QuantizedFlat index present

- [ ] **Verify Goal 2 (Data Plane)**
  - [ ] 50 documents ingested
  - [ ] Cosine query returns correct results
  - [ ] DotProduct query returns correct results
  - [ ] Euclidean query returns correct results
  - [ ] Results match Python baseline

- [ ] **Verify Output**
  - [ ] Output file created with all 6 scenarios
  - [ ] Table format consistent across languages
  - [ ] Cross-language diffs show identical results

### 5.2 Documentation Updates

- [ ] **Update README.md** in each sample folder
  - Document ARM SDK usage
  - Document distance functions implemented
  - Add link to verified output

- [ ] **Update quickstart articles** (`quickstart-create-index-{language}.md`)
  - Explain ARM SDK control plane setup
  - Show example of creating container + indexes
  - Show example queries for each distance function

- [ ] **Create VERIFICATION_REPORT.md**
  - Summary table: 5 languages × 2 goals
  - Verification commands run
  - Output file comparison results
  - Sign-off timestamp

### 5.3 Phase 5 Verification

```bash
# 1. Run full end-to-end test for all languages
bash verify-phase-4.sh

# 2. Confirm both goals complete for all samples
grep -r "Goal 1" output/ && grep -r "Goal 2" output/

# 3. Compare cross-language outputs
bash scripts/compare-outputs.sh
```

---

## Execution Strategy

### Recommended Parallel Execution

**Phase 1 (Analysis):** Sequential
- Run 1.1 + 1.2 to understand current state and prioritize

**Phase 2 (Control Plane — ARM SDK):** Parallel
- **Batch 1:** TypeScript + Go (independent, can run simultaneously)
- **Batch 2:** Java + .NET (independent, can run simultaneously)
- Reason: Each language's ARM SDK is independent; no cross-language dependencies

**Phase 3 (Data Plane — Distance Functions):** Parallel
- All 5 samples can work simultaneously
- Each references the same Python baseline for comparison
- Reason: Data plane queries are independent per language

**Phase 4 (Output Formatting):** Parallel
- All 5 samples format output independently
- Comparison step is sequential (after all produce output)

**Phase 5 (Verification):** Mostly Sequential
- Per-language tests can run in parallel
- Cross-language diff must run after all languages complete

### Timeline Estimate

| Phase | Activity | Duration | Notes |
|-------|----------|----------|-------|
| Phase 1 | Analysis + code mapping | 30 min | One-time setup |
| Phase 2 | Implement ARM SDK in 4 languages | 4-6 hours | Parallel: 2 hours effective |
| Phase 3 | Implement data plane queries in 4 languages | 4-6 hours | Parallel: 2 hours effective |
| Phase 4 | Format output, capture results | 1-2 hours | Parallel: 30 min effective |
| Phase 5 | Test, verify, document | 2-3 hours | Mostly parallel, final verification sequential |
| **Total** | | **11-20 hours** | **~7 hours with full parallelization** |

---

## Dependencies & Blockers

### Hard Dependencies
- Python baseline must remain stable (reference implementation)
- OpenAI API key required for embedding generation (same for all languages)
- Cosmos DB container must exist before running Phase 3+

### Soft Dependencies (Nice to Have)
- Pre-created Cosmos DB account (if using ARM SDK, not needed)
- Pre-provisioned containers (ARM SDK creates these)

### Known Risks
1. **Floating-point precision:** Cross-language score comparison may have rounding differences
   - **Mitigation:** Use 0.0001 tolerance for comparison
2. **Azure credentials:** Each language must authenticate correctly
   - **Mitigation:** Test `DefaultAzureCredential` separately per language
3. **Vector index immutability:** Cannot modify indexes after creation
   - **Mitigation:** Check existence before creating; use idempotent logic

---

## Verification Checkpoints

| Checkpoint | Verification Command | Expected Result |
|------------|----------------------|-----------------|
| Phase 2A (Deps) | Check requirements files for ARM SDK | All 5 have ARM SDK in dependencies |
| Phase 2B (Clients) | Run ARM client initialization | All 5 authenticate without error |
| Phase 2C (Container) | Query Cosmos DB for container | Container exists with partition key `/Region` |
| Phase 2D (Indexes) | Query Cosmos DB for vector indexes | 2 indexes present (DiskANN + QuantizedFlat) |
| Phase 3A (Ingestion) | Check document count | 50 documents in container |
| Phase 3B (Cosine) | Run Cosine query, compare to Python | Top 2 results match Python baseline |
| Phase 3C (DotProduct) | Run DotProduct query, compare to Python | Top 2 results match Python baseline |
| Phase 3D (Euclidean) | Run Euclidean query, compare to Python | Top 2 results match Python baseline |
| Phase 4A (Output) | Check output file | All 6 scenarios in output file |
| Phase 4B (Format) | Compare table formats | All 5 languages use identical format |
| Phase 5A (E2E Test) | Run full end-to-end test | No errors, all goals verified |
| Phase 5B (Cross-Lang) | Diff output files | Results match across all languages |

---

## Success Criteria

✅ **Phase 2 Complete:** All 5 samples use ARM SDK for container + index creation
- [ ] TypeScript: ARM SDK in use
- [ ] Go: ARM SDK in use
- [ ] Java: ARM SDK in use
- [ ] .NET: ARM SDK in use

✅ **Phase 3 Complete:** All 5 samples implement distance functions with identical results
- [ ] TypeScript: Cosine, DotProduct, Euclidean queries return identical results to Python
- [ ] Go: Cosine, DotProduct, Euclidean queries return identical results to Python
- [ ] Java: Cosine, DotProduct, Euclidean queries return identical results to Python
- [ ] .NET: Cosine, DotProduct, Euclidean queries return identical results to Python

✅ **Phase 5 Complete:** All documentation updated, end-to-end verified
- [ ] All 5 README files updated with Goal 1 + Goal 2 status
- [ ] All 5 quickstart articles document ARM SDK + distance functions
- [ ] Cross-language output comparison shows identical results
- [ ] Verification report signed off

---

## Next Steps

1. **Confirm this plan** with PM/stakeholder
2. **Assign work** per language + phase
3. **Start Phase 1** (Analysis) to validate current state assumptions
4. **Begin Phase 2** (ARM SDK) for TypeScript + Go in parallel
5. **Track progress** against verification checkpoints
