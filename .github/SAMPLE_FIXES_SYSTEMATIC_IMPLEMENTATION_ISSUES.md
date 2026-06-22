# TypeScript Sample Implementation Issues

## Current Implementation Status (VERIFIED)

### Goal 1: ARM SDK Control Plane ✅ WORKING
- **Status:** COMPLETE and VERIFIED
- Container creation: ✅ Both DiskANN and QuantizedFlat created successfully
- Vector index creation: ✅ Immutable indexes created per spec
- Document ingestion: ✅ Bulk operations work (50 docs ingested, ~14,796 RUs)

### Goal 2: Data-Plane Distance Function Queries ✅ WORKING
- **Status:** COMPLETE and VERIFIED
- Document ingestion: ✅ Works correctly
- Embedding generation: ✅ Works correctly (1536-dim vectors)
- VectorDistance queries (all 3 distance functions): ✅ All working and returning correct results

### C# Implementation Status (2026-06-21)
- **Status:** Phase 1 ARM SDK control plane added for `.NET`
- Added `nosql-create-index-dotnet/src/ControlPlane.cs` using `Azure.ResourceManager.CosmosDB` 1.4.0 and `Azure.Identity` 1.18.0
- `Program.cs` now calls `ControlPlane.CreateContainersAsync()` before data-plane ingestion/query steps
- ARM container definitions use `/Region` partition key, 1536-dimension `/embedding` vector policy, cosine distance, and a vector index policy that includes both `diskANN` and `quantizedFlat`
- Cross-language note: the .NET control-plane flow now mirrors the TypeScript/Python ARM sequence (delete existing container, recreate, then continue with data-plane operations), but the .NET sample still depends on management-plane permissions that differ from the repo-level passwordless data-plane guidance

### Reverification Update (2026-06-21)
- **Static 2-part goal check:** Goal 1 ✅ pass, Goal 2 ✅ pass (static) — see `.github/plans/TYPESCRIPT_REVERIFICATION_REPORT.md`.
- **New issue:** Cross-language parity is only partial because TypeScript hardcodes `partitionKeyValue = "West"` in `src/data-plane.ts:299-320`, while Python defaults to `Northeast` in `nosql-create-index-python/src/config.py:26`.
- **New issue:** The existing TypeScript test suite is stale/brittle. `npm test` currently exits 1 because `test/live.integration.test.ts:72-81` requires `AZURE_USER_PRINCIPAL_ID`, and the same test still references RBAC helpers (`createRbacAccess`, `ROLE_ASSIGNMENT_GUID`, `ROLE_DEFINITION_GUID`) that are not exported by the current `src/control-plane.ts:1-151`.

### Key Finding: ARM SDK Status Across Languages

Based on current branch state:
- **TypeScript:** ✅ Goal 1 COMPLETE (control-plane.ts exists, verified working)
- **Python:** ⚠️ Goal 1 PRESENT BUT NEEDS REVERIFICATION (`src/control_plane.py` exists; `QuantizedFlat` index-type spelling differs from TypeScript/spec)
- **Go:** ❌ Goal 1 MISSING (no control_plane.go with ARM SDK)
- **Java:** ❌ Goal 1 MISSING (no ControlPlane.java with ARM SDK)
- **.NET:** ✅ Goal 1 COMPLETE (`src/ControlPlane.cs` now uses `Azure.ResourceManager.CosmosDB`)

**Note:** The current branch now contains Phase 1 control-plane code in TypeScript, Python, and .NET. Python still needs follow-up reverification because its `QuantizedFlat` index-type spelling does not match the TypeScript sample/spec. Go and Java still appear to be missing Phase 1 code in this branch snapshot.

---

## Issues Encountered During 2-Part Goal Implementation

### Issue 1: Bulk Operation Requires `id` Field [RESOLVED ✅]
**Category:** ARM SDK / Data Plane Integration  
**Severity:** CRITICAL  
**Status:** FIXED  
**Symptom:** Batch ingestion fails with error: `"Operation resource body must have an 'id' for Create operations."`

**Root Cause:**
- Azure Cosmos DB bulk operations require all documents to have an `id` field
- The data file contains documents with `HotelId` but no `id` field
- The TypeScript @azure/cosmos SDK enforces this validation

**Solution:**
- Map `HotelId` to `id` during resource body transformation before bulk operations
- Changed line in `insertDocuments()`:
  ```typescript
  resourceBody: {
    ...item,
    id: item.HotelId || randomUUID(), // Map HotelId to id (required for Cosmos bulk ops)
  },
  ```
- This preserves `HotelId` in the document while satisfying the bulk operation requirement

**Files Modified:**
- `src/data-plane.ts` (lines 181-186)
- Added `import { randomUUID } from "node:crypto";` for fallback ID generation

**Impact:** Goal 2 Data Plane — Document ingestion now works correctly for both index types.

---

### Issue 2: VectorDistance Query Syntax Invalid [RESOLVED ✅]
**Category:** Data Plane Query / Cosmos DB SQL Syntax  
**Severity:** CRITICAL  
**Status:** FIXED  
**Symptom:** All distance function queries failed with: `"One of the input values is invalid."` AND `"Specifying a sorting order (ASC or DESC) with VectorDistance function is not supported"`

**Root Cause (IDENTIFIED):**
There were THREE issues with the initial VectorDistance query:

1. **ORDER BY Not Allowed with VectorDistance**
   - VectorDistance automatically sorts results by similarity (most-to-least similar)
   - Adding `ORDER BY ... DESC` or `ORDER BY ... ASC` after VectorDistance causes Cosmos DB to reject the query
   - Error code: SC2210 — "Specifying a sorting order... is not supported. VectorDistance will always sort..."
   
2. **Missing Partition Key in WHERE Clause**
   - Python implementation includes: `WHERE c.HotelId = @partitionKey` 
   - TypeScript was missing this filter
   - Without partition key specification, @azure/cosmos SDK may not properly target the query
   
3. **Missing Distance Function Parameter**
   - VectorDistance requires 4 parameters: field, embedding, useScalarProjection (boolean), options (object with distanceFunction)
   - Initial query only provided 3 parameters: `VectorDistance(c.field, @embedding, false)`
   - Correct: `VectorDistance(c.field, @embedding, false, {'distanceFunction': 'Cosine'})`

**Solution:**
1. **Remove ORDER BY clause entirely** — VectorDistance handles sorting automatically
2. **Add partition key WHERE filter** — Match Python implementation pattern:
   ```typescript
   query: `SELECT TOP 5 ... 
           FROM c
           WHERE c.Region = @partitionKey
   ```
   And pass partition key in parameters:
   ```typescript
   parameters: [
     { name: "@embedding", value: queryEmbedding },
     { name: "@partitionKey", value: "West" }
   ]
   ```
3. **Include distance function options** — Pass distance function as 4th VectorDistance parameter:
   ```typescript
   VectorDistance(c.${embeddingField}, @embedding, false, {'distanceFunction': '${distanceFunction}'})
   ```
4. **Pass partition key to query execution** — Include in query options:
   ```typescript
   await container.items.query(querySpec, { partitionKey: partitionKeyValue }).fetchAll()
   ```

**Results After Fix:**
- ✅ Cosine: 0.2628 (similarity metric, higher = better)
- ✅ DotProduct: 0.2630 (similarity metric, higher = better)
- ✅ Euclidean: 1.2145 (distance metric, lower = better — NOTE: results are REVERSED in ordering)
- ✅ Both index types (DiskANN, QuantizedFlat) produce nearly identical results
- ✅ All 3 distance functions now return DIFFERENT values as expected
- ✅ RU cost: ~9.90 RUs per query (efficient)

**Files Modified:**
- `src/data-plane.ts` (lines 300-333)
  - Removed ORDER BY logic (lines 314-319 in original)
  - Added partition key WHERE clause (line 315)
  - Added partition key parameter (line 320)
  - Added distance function to VectorDistance call (line 309)
  - Added partitionKey to query execution (line 334)

---

### Issue 3: Error Reporting Gaps
**Category:** Code Quality / Debugging  
**Severity:** MEDIUM  
**Status:** ADDRESSED (partially)  
**Symptom:** Generic error messages without actionable details

**Changes Made:**
- Added try-catch around query execution with detailed logging
- Logs now include:
  - Full error code and message
  - Query text excerpt
  - Embedding length and type validation
  - ActivityId from Cosmos DB for support tickets

**Remaining Gaps:**
- Still no breakdown of which parameter failed validation
- Cosmos DB error messages are generic (inherited from .NET SDK)
- No diagnostic query available to inspect vector index structure

**Files Modified:**
- `src/data-plane.ts` (lines 307-356)

---

## Issues NOT Encountered (Validated OK)

### ✓ ARM SDK Container Creation
- Both DiskANN and QuantizedFlat vector indexes created successfully
- Vector index immutability warning displayed correctly
- Container cleanup works as expected
- Performance: ~8.3s per container creation

### ✓ Bulk Ingestion Logic
- Region grouping and validation works correctly
- Batch operations execute without timeout
- Conflict detection (409) works as expected
- RU reporting accurate (~14,796 RUs for 50 documents)

### ✓ Embedding Generation
- Azure OpenAI integration functional
- text-embedding-3-small deployment generates 1536-dim vectors
- Embedding formatting (array of numbers) correct

### ✓ Cross-Language Consistency
- Shared dataset, Region batching, and distance-function names align with Python
- Direct result-ranking comparison is still blocked by the TypeScript hardcoded `"West"` query partition vs Python default `"Northeast"`

---

## 2-Part Goal Status After Implementation

| Goal | Task | Status | Blocker |
|------|------|--------|---------|
| **Goal 1** | Create containers with ARM SDK | ✅ Complete | None |
| **Goal 1** | Create DiskANN index | ✅ Complete | None |
| **Goal 1** | Create QuantizedFlat index | ✅ Complete | None |
| **Goal 2** | Generate embedding for query | ✅ Complete | None |
| **Goal 2** | Query with Cosine distance | ✅ Complete | None |
| **Goal 2** | Query with DotProduct distance | ✅ Complete | None |
| **Goal 2** | Query with Euclidean distance | ✅ Complete | None |
| **Goal 2** | Compare results across all languages | ⚠️ Partial | Align TypeScript query partition value with Python before claiming ranking parity |

---

## Recommendations for Moving Forward

1. **Priority 1: Resolve VectorDistance Syntax**
   - Compare working Python queries side-by-side with failing TypeScript queries
   - Test with simplified query (no options parameter)
   - Review Cosmos DB SQL grammar documentation for VectorDistance function

2. **Priority 2: Add Diagnostic Queries**
   - Query system tables to inspect vector index structure
   - Verify index is queryable and contains expected dimensions

3. **Priority 3: Cross-Validate with Python**
   - Run Python sample with identical embedding
   - Compare query syntax and results
   - Identify any language-specific SDK differences

4. **Priority 4: Documentation Updates**
   - Record VectorDistance syntax requirements per language
   - Add troubleshooting section to plan document

---

## Environment Details
- **TypeScript Version:** ES2020 (tsc compiled)
- **@azure/cosmos:** 4.9.1
- **@azure/arm-cosmosdb:** 16.4.0
- **@azure/identity:** Latest (DefaultAzureCredential)
- **Data:** 50 hotel documents, 1536-dimensional vectors
- **Azure Region:** eastus2
- **Cosmos DB Account:** db-dib-cos-4bpmnkpp4662v4

---

## Python Implementation Status

### Python Sample Fixes Applied (VERIFIED)

**Session Date:** 2026-06-21  
**Branch:** `diberry/article-2`  
**Target Language:** Python (nosql-create-index-python sample)

#### Issue: Wrong Partition Key in VectorDistance Query [FIXED ✅]
**Category:** Data Plane Query / Partition Key Mismatch  
**Severity:** CRITICAL  
**Status:** FIXED  

**Problem:**
- Container created with `/Region` as partition key (control_plane.py line 112)
- Query used `WHERE c.HotelId = @partitionKey` instead of `WHERE c.Region = @partitionKey`
- Query included `ORDER BY VectorDistance(...)` which violates Cosmos DB constraints
- Config default `partition_key_value = "hotels"` doesn't match any Region value

**Root Cause:**
1. Partition key is defined as `/Region` in container creation
2. Valid Region values are: "Northeast", "Midwest", "South", "West"
3. Query code and config were inconsistent with this design

**Solution Applied:**
1. **Fixed prepare_document()** (data_plane.py line 73-77):
   - Removed artificial setting of HotelId as partition key
   - Let Region field pass through as-is from data

2. **Fixed query_top_matches()** (data_plane.py line 161-204):
   - Removed `ORDER BY VectorDistance(...)` clause (lines 169-174 original)
   - Changed WHERE clause from `c.HotelId = @partitionKey` to `c.Region = @partitionKey`
   - Query now correctly targets Region partition key
   - Added comment explaining the VectorDistance constraint

3. **Fixed config defaults** (config.py line 22-28):
   - Changed `DEFAULT_PARTITION_KEY_VALUE` from "hotels" to "Northeast"
   - Added comment noting valid values are Region names

**Files Modified:**
- `src/data_plane.py` (lines 73-77, 161-204)
- `src/config.py` (line 26)

**Verification:**
- [OK] Imports successful
- [OK] Field validation passed  
- [OK] Document preparation works (id and region fields correct)
- [OK] Default partition key is now valid Region value
- [OK] Data file loads correctly (50 documents, 4 regions)

**Next Steps for Python E2E Verification:**
- Phase 1: Verify ARM SDK container creation
- Phase 2: Verify data ingestion with Region partition key
- Phase 3: Run queries with all 3 distance functions
- Phase 4: Compare results with TypeScript implementation

---

### Python Cross-Language Consistency Notes

| Aspect | TypeScript | Python | Status |
|--------|-----------|--------|--------|
| Control Plane (ARM SDK) | ✅ control-plane.ts | ✅ control_plane.py | COMPLETE |
| Partition Key | `/Region` | `/Region` | CONSISTENT |
| Partition Key Filter | `c.Region = @partitionKey` | `c.Region = @partitionKey` | CONSISTENT |
| Distance Function Call | `VectorDistance(..., false, {'distanceFunction': 'X'})` | `VectorDistance(..., false, {'distanceFunction': 'X'})` | CONSISTENT |
| ORDER BY Constraint | Removed ✅ | Removed ✅ | CONSISTENT |
| Embedding Field Name | `embedding` | `embedding` | CONSISTENT |
| Index Types | DiskANN, QuantizedFlat | DiskANN, `quantizedflat` | NEEDS ALIGNMENT |

#### Reverification Addendum (2026-06-21)

- **Offline test execution:** ✅ `python test_vectordistance_fixes.py` passed with exit code `0` and printed `13 [PASS]` checks.
- **Goal 2 query constraints:** ✅ Reverified in `src/data_plane.py`:
  - no `ORDER BY`
  - `WHERE c.Region = @partitionKey`
  - `partition_key=config.partition_key_value`
  - `{'distanceFunction': 'Cosine'|'DotProduct'|'Euclidean'}`
- **New finding - Goal 1 still needs follow-up:** ⚠️ `src/control_plane.py` uses `quantizedflat` for the second vector index type, while the TypeScript sample uses `quantizedFlat` and the plan refers to `QuantizedFlat`.
- **New finding - cross-language ranking comparison is not yet apples-to-apples:** ⚠️ Python defaults to `DEFAULT_PARTITION_KEY_VALUE = "Northeast"` (`src/config.py`), but TypeScript hardcodes `partitionKeyValue = "West"` for its query path.
- **New finding - Python quickstart is stale:** ⚠️ `nosql-create-index-python/quickstart-create-index-python.md` still references the old data file, the `"hotels"` partition key, and an `ORDER BY VectorDistance(...)` query, so docs no longer match the reverified code.

---

## C# Implementation Status

### .NET Sample Fixes Applied (VERIFIED OFFLINE)

**Session Date:** 2026-06-21  
**Branch:** `diberry/article-2`  
**Target Language:** .NET (`nosql-create-index-dotnet`)

#### Phase 1: ARM SDK Control Plane [FIXED ✅]
**Status:** COMPLETE (offline verified)  

**Changes Applied:**
- Added `nosql-create-index-dotnet\src\ControlPlane.cs`
- Added `Azure.ResourceManager.CosmosDB` 1.4.0 and updated `Azure.Identity` to 1.18.0
- `Program.cs` now calls `ControlPlane.CreateContainersAsync()` before data-plane ingestion/query
- ARM container definitions use `/Region` partition key, `/embedding` vector field, `1536` dimensions, `cosine` distance, and a vector index policy that includes both `diskANN` and `quantizedFlat`
- Existing containers are deleted and recreated so immutable vector index settings are refreshed consistently with the TypeScript/Python sample flow

**Known Runtime Risk:**
- This .NET flow now intentionally uses management-plane permissions, which conflicts with the repo-level data-plane-only guidance. Build/test verification passed offline, but live execution still depends on the caller having ARM access in addition to Cosmos DB data-plane access.

#### Phase 2: Region-Based Ingestion [FIXED ✅]
**Status:** COMPLETE  

**Changes Applied:**
- Switched ingestion to `TransactionalBatch` grouped by `/Region`
- Added `GroupDocumentsByRegion()` helper for deterministic region batching
- Preserved `Region` while continuing to map `HotelId` to `id`
- Updated defaults to use `HotelsData_toCosmosDB_Vector_byRegion.json`

#### Phase 3: VectorDistance Query Fixes [FIXED ✅]
**Status:** COMPLETE  

**Changes Applied:**
- Removed `ORDER BY` from the query
- Added `WHERE c.Region = @partitionKey`
- Added `QueryRequestOptions.PartitionKey = new PartitionKey(config.PartitionKeyValue)`
- Added the required 4th `VectorDistance` argument: `{'distanceFunction': 'Cosine'|'DotProduct'|'Euclidean'}`
- Added reusable helpers so the query shape can be validated offline

#### Phase 4: Offline Verification [ADDED ✅]
**Status:** COMPLETE  

**Added:**
- `nosql-create-index-dotnet\tests\test_vectordistance_fixes\test_vectordistance_fixes.csproj`
- `nosql-create-index-dotnet\tests\test_vectordistance_fixes\Program.cs`

**Validation Coverage:**
1. Partition key default is a valid `Region`
2. Data file contains `Northeast`, `Midwest`, `South`, `West`
3. Document preparation preserves `Region`
4. Region grouping counts match the shared dataset
5. Field-name validation and supported distance functions are correct
6. Query text and query options satisfy the VectorDistance constraints

#### Additional .NET-Specific Issues Found
- `appsettings.json` still pointed to the old non-region dataset
- `ClearContainerDataAsync()` deleted with the wrong partition key (`"hotels"`)
- `quickstart-create-index-dotnet.md` still documented `/HotelId`, `DescriptionVector`, and an invalid `ORDER BY VectorDistance(...)` query pattern
