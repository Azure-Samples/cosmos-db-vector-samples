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
| **Goal 2** | Query with Cosine distance | ✅ Complete | None |
| **Goal 2** | Query with DotProduct distance | ✅ Complete | None |
| **Goal 2** | Query with Euclidean distance | ✅ Complete | None |
| **Goal 2** | Compare results across all languages | 🔄 Ready for cross-language validation | None |

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
