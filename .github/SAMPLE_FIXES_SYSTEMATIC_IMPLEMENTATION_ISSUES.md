# TypeScript Sample Implementation Issues

## Current Implementation Status (VERIFIED)

### Goal 1: ARM SDK Control Plane ✅ WORKING
- **Status:** COMPLETE and VERIFIED
- Container creation: ✅ Both DiskANN and QuantizedFlat created successfully
- Vector index creation: ✅ Immutable indexes created per spec
- Document ingestion: ✅ Bulk operations work (50 docs ingested, ~14,796 RUs)

### Goal 2: Data-Plane Distance Function Queries ❌ BLOCKED
- **Status:** UNRESOLVED - VectorDistance query syntax issue
- Document ingestion: ✅ Works correctly
- Embedding generation: ✅ Works correctly (1536-dim vectors)
- VectorDistance queries (all 3 distance functions): ❌ Return 400 "One of the input values is invalid"

### Key Finding: ARM SDK Status Across Languages

Based on current branch state:
- **TypeScript:** ✅ Goal 1 COMPLETE (control-plane.ts exists, verified working)
- **Python:** ❌ Goal 1 MISSING (no control_plane.py with ARM SDK)
- **Go:** ❌ Goal 1 MISSING (no control_plane.go with ARM SDK)
- **Java:** ❌ Goal 1 MISSING (no ControlPlane.java with ARM SDK)
- **.NET:** ❌ Goal 1 MISSING (no ControlPlane.cs with ARM SDK)

**Note:** The user mentioned "there was a time when all ARM SDK code was working for every language except Go" - but current branch shows only TypeScript has Phase 1 (ARM SDK) implemented. Either this regressed or the memory refers to a different branch/commit point.

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

### Issue 2: VectorDistance Query Syntax Invalid [UNRESOLVED - FURTHER INVESTIGATION]
**Category:** Data Plane Query / Cosmos DB SQL Syntax  
**Severity:** CRITICAL  
**Status:** IN INVESTIGATION  
**Symptom:** All distance function queries fail with: `"One of the input values is invalid."`

**Root Cause (Hypothesis):**
- The VectorDistance function's `options` parameter syntax is incorrect
- Current syntax attempted in query:
  ```sql
  VectorDistance(c.DescriptionVector, @embedding, false, {'distanceFunction': 'Cosine'})
  ```
- Cosmos DB SQL may not support JSON object syntax in function calls
- The third parameter (boolean) and fourth parameter (options) handling differs from Python/JavaScript expectations

**Attempts to Fix:**
1. ✗ Changed `{distanceFunction: 'Cosine'}` to `{'distanceFunction': 'Cosine'}` (quoted keys) — **STILL FAILS**
   - Based on Python implementation which uses double-escaped quotes `{{'distanceFunction': '{1}'}}`
   - Error persists: "One of the input values is invalid"

**Observations:**
- Queries compile and submit successfully (no client-side errors)
- Error occurs server-side (400 Bad Request from Cosmos DB)
- No ActivityId indicates which specific parameter is invalid
- All three distance functions fail identically (Cosine, DotProduct, Euclidean)
- Both index types fail identically (DiskANN, QuantizedFlat)

**Possible Remaining Causes:**
1. **VectorDistance Availability:** Vector query capability may require different container/index configuration
2. **Parameter Type Mismatch:** Embedding parameter format (array of floats) may not match expected type
3. **Version Mismatch:** @azure/cosmos 4.9.1 or @azure/arm-cosmosdb 16.4.0 may have different VectorDistance support vs Python SDK
4. **Third Boolean Parameter:** The `false` parameter (distanceThreshold?) may be invalid or unsupported in JavaScript SDK
5. **Cosmos DB Deployment:** Service may not support VectorDistance in current region/account
6. **Missing Partition Key Filter:** Python includes `WHERE c.HotelId = @partitionKey` but TypeScript doesn't

**Key Difference vs Python:**
Python query includes `WHERE c.HotelId = @partitionKey` which provides partition key value at query time. TypeScript omits this filter—Cosmos DB may require partition key specification for vector queries when using MultiHash partitioning.

**Files Affected:**
- `src/data-plane.ts` (lines 290-310, query construction)
- Potential: `src/control-plane.ts` (lines 84-88, partition key configuration)

**Impact:** Goal 2 Data Plane — Vector similarity queries not functional; cross-language comparison cannot proceed.

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
- No language-specific issues identified in TypeScript implementation
- Both SDK paths (ARM + data-plane) follow same architectural patterns as Python

---

## 2-Part Goal Status After Implementation

| Goal | Task | Status | Blocker |
|------|------|--------|---------|
| **Goal 1** | Create containers with ARM SDK | ✅ Complete | None |
| **Goal 1** | Create DiskANN index | ✅ Complete | None |
| **Goal 1** | Create QuantizedFlat index | ✅ Complete | None |
| **Goal 2** | Generate embedding for query | ✅ Complete | None |
| **Goal 2** | Query with Cosine distance | ❌ Failed | VectorDistance syntax (Issue #2) |
| **Goal 2** | Query with DotProduct distance | ❌ Failed | VectorDistance syntax (Issue #2) |
| **Goal 2** | Query with Euclidean distance | ❌ Failed | VectorDistance syntax (Issue #2) |
| **Goal 2** | Compare results across all languages | ❌ Blocked | Cannot execute queries |

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
