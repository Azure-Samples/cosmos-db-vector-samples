# Create-Index Samples: Drift Analysis & Prevention Plan

**Date:** 2026-06-19  
**Status:** Gap Analysis — Identifies all current drifts and prevention strategies

---

## Executive Summary

The 5 create-index samples currently have **10+ configuration and behavior inconsistencies** that violate the single-scenario principle. These drifts are introduced by:

1. **Missing shared configuration schema** — each language invents its own config structure
2. **Unvalidated defaults** — no enforcement across samples  
3. **Language-specific variations** — treated as "language idiom" when they're actually scenario divergence
4. **No cross-sample test suite** — each sample tested independently

This document identifies every drift, quantifies impact, and prescribes permanent fixes.

---

## Identified Drifts

### 1️⃣ Database Name Inconsistency

| Language | Current Value | Source | Issue |
|----------|---------------|--------|-------|
| **TypeScript** | `"HotelsCreateIndex"` | src/config.ts:36 | Non-standard name |
| **Go** | `"Hotels"` | config.go:75 (default) | Different from TS |
| **Python** | *(no default)* | config.py:95 | No default at all |
| **Java** | `"Hotels"` | Config.java:DEFAULT_DATABASE_NAME | Different from TS |
| **.NET** | *(requires env)* | src/Config.cs:51 | No default in code |

**Impact:** HIGH  
- Samples cannot run side-by-side without manual env var override
- Documentation must specify different database names per language
- Cross-sample testing impossible without per-language setup

**Fix:** Standardize to **`"HotelsCreateIndex"`** across ALL languages with identical default

---

### 2️⃣ Partition Key Field Name Inconsistency

| Language | Current Value | Source | Issue |
|----------|---------------|--------|-------|
| **Go** | `"PartitionKey"` | config.go:17 (const) | Hard-coded |
| **Python** | `"PartitionKey"` | data_plane.py (from earlier output) | Hard-coded |
| **TypeScript** | *(not explicit in config)* | src/data-plane.ts | Unclear |
| **Java** | `"HotelId"` | Inferred from vector-search sample | Matches vector-search |
| **.NET** | *(not shown)* | src/DataPlane.cs | TBD |

**Impact:** CRITICAL  
- **Vector-search samples use `"HotelId"`** as partition key in data (confirmed earlier)
- Create-index samples that use `"PartitionKey"` will be incompatible with pre-existing data
- Partition key mismatch = query and insertion failures

**Fix:** ALL samples MUST use **`"HotelId"`** as the partition key field name (to match vector-search)

---

### 3️⃣ Data File Path Inconsistency

| Language | Path Format | Source | Issue |
|----------|-------------|--------|-------|
| **TypeScript** | `"../data/HotelsData_toCosmosDB_Vector.json"` | src/config.ts:50 | Relative, forward-slash |
| **Go** | *(not shown but uses relpath)* | config.go | Relative, TBD slash |
| **Python** | `"..\\data\\HotelsData_toCosmosDB_Vector.json"` | config.py:88 | Relative, backslash |
| **Java** | `"..\\data\\HotelsData_toCosmosDB_Vector.json"` | Config.java:DEFAULT_DATA_FILE | Relative, backslash |
| **.NET** | `"../data/HotelsData_toCosmosDB_Vector.json"` | src/Config.cs:34 | Relative, forward-slash |

**Impact:** MEDIUM  
- Inconsistent path separators (forward vs backslash)
- Works on native platform but confusing in docs
- Cross-platform samples should use consistent path format

**Fix:** Use platform-agnostic path construction in EVERY sample (e.g., `Path.join()`, `Path.combine()`, `os.path.join()`)

---

### 4️⃣ Default Query Text

| Language | Query | Match |
|----------|-------|-------|
| **TypeScript** | `"hotel near the ocean"` | ✓ |
| **Go** | `"hotel near the ocean"` | ✓ |
| **Python** | `"hotel near the ocean"` | ✓ |
| **Java** | `"hotel near the ocean"` | ✓ |
| **.NET** | *(TBD)* | ? |

**Status:** MOSTLY CONSISTENT — No action needed

---

### 5️⃣ Embedding Field Name

| Language | Field | Match |
|----------|-------|-------|
| **TypeScript** | `"DescriptionVector"` | ✓ |
| **Go** | `"DescriptionVector"` | ✓ |
| **Python** | `"DescriptionVector"` | ✓ |
| **Java** | *(TBD)* | ? |
| **.NET** | `"DescriptionVector"` | ✓ |

**Status:** MOSTLY CONSISTENT — Verify Java only

---

### 6️⃣ Embedding Dimensions

| Language | Dimensions | Source |
|----------|------------|--------|
| **TypeScript** | `1536` | src/config.ts (via env default) |
| **Go** | `1536` | config.go:16 (const) |
| **Python** | `1536` | config.py:28 (const EXPECTED_DIMENSIONS) |
| **Java** | `1536` | Config.java:EXPECTED_DIMENSIONS |
| **.NET** | *(TBD)* | src/Config.cs |

**Status:** CONSISTENT — All 1536. No action needed.

---

### 7️⃣ Top-N Result Count

| Language | Top Count | Source | Issue |
|----------|-----------|--------|-------|
| **TypeScript** | *(TBD)* | src/data-plane.ts | Not checked |
| **Go** | 3 (hardcoded in output) | main.go:80 | Hardcoded in string |
| **Python** | 5 | config.py:27 (DEFAULT_TOP_COUNT) | Configurable |
| **Java** | 5 | Config.java:DEFAULT_TOP_COUNT | Configurable |
| **.NET** | 3 | src/Config.cs (TopCount in record) | Not checked value |

**Impact:** MEDIUM  
- Different samples return different result counts
- Comparison table will have different dimensions per language
- Inconsistent behavior makes samples appear broken

**Fix:** Standardize to **5** results (matches Python/Java majority)

---

### 8️⃣ Vector Index Types Supported

| Language | diskANN | quantizedFlat | Both |
|----------|---------|---------------|------|
| **TypeScript** | ✓ | ✓ | ✓ |
| **Go** | ✓ | ✓ | ✓ |
| **Python** | ✓ | ✓ | ✓ |
| **Java** | ✓ | ✓ | ✓ |
| **.NET** | ? | ? | ? |

**Status:** Need .NET verification

---

### 9️⃣ Configuration Environment Variable Names

| Language | Database Name Env Var | Note |
|----------|----------------------|------|
| **TypeScript** | `AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME` | Long form |
| **Go** | `AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME` | Matches TS |
| **Python** | `AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME` | Matches TS |
| **Java** | *(not shown)* | Check source |
| **.NET** | `AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME` | Matches TS |

**Status:** MOSTLY CONSISTENT

---

### 🔟 Cleanup Behavior

| Language | Clears Data | Deletes Container | Both Phases |
|----------|-------------|-------------------|------------|
| **TypeScript** | ✓ | ✓ | ✓ |
| **Go** | ✓ | ✓ | ✓ |
| **Python** | ✓ | ✓ | ✓ |
| **Java** | ✓ | ✓ | ✓ |
| **.NET** | ? | ? | ? |

**Status:** Need .NET verification

---

## Prevention Strategy: Unified Configuration Schema

To prevent future drift, all 5 samples MUST conform to a **shared configuration specification**.

### Schema (JSON for reference)

```json
{
  "scenario": {
    "name": "hotels-vector-search-create-index",
    "version": "1.0"
  },
  "cosmos": {
    "database_name": "HotelsCreateIndex",
    "containers": ["hotels_diskann", "hotels_quantizedflat"],
    "partition_key_field": "HotelId",
    "partition_key_value": "hotels"
  },
  "data": {
    "file": "../data/HotelsData_toCosmosDB_Vector.json",
    "embedding_field": "DescriptionVector",
    "embedding_dimensions": 1536
  },
  "query": {
    "text": "hotel near the ocean",
    "top_count": 5,
    "distance_functions": ["Cosine", "DotProduct", "Euclidean"]
  },
  "openai": {
    "embedding_deployment": "text-embedding-3-small",
    "embedding_api_version": "2024-08-01-preview"
  }
}
```

### Language-Specific Implementation Rules

Each language config module MUST define these constants in the **exact same order and with identical values**:

**TypeScript** (src/config.ts)
```typescript
const SCENARIO_NAME = "hotels-vector-search-create-index";
const DATABASE_NAME = "HotelsCreateIndex"; // NOT HotelsCreateIndex
const PARTITION_KEY_FIELD = "HotelId";     // NOT PartitionKey
const PARTITION_KEY_VALUE = "hotels";
const EMBEDDING_FIELD = "DescriptionVector";
const EMBEDDING_DIMENSIONS = 1536;
const DEFAULT_QUERY_TEXT = "hotel near the ocean";
const DEFAULT_TOP_COUNT = 5;
const DEFAULT_DATA_FILE = "../data/HotelsData_toCosmosDB_Vector.json";
const CONTAINER_NAMES = ["hotels_diskann", "hotels_quantizedflat"];
```

**Go** (config.go)
```go
const (
    scenarioName            = "hotels-vector-search-create-index"
    databaseName            = "HotelsCreateIndex"
    partitionKeyFieldName   = "HotelId"       // CHANGE from "PartitionKey"
    partitionKeyFieldValue  = "hotels"
    embeddingFieldName      = "DescriptionVector"
    embeddingDimensions     = 1536
    defaultQueryText        = "hotel near the ocean"
    defaultTopCount         = 3               // CHANGE from 3 → 5
    diskANNContainer        = "hotels_diskann"
    quantizedFlatContainer  = "hotels_quantizedflat"
)
```

**Python** (config.py)
```python
SCENARIO_NAME = "hotels-vector-search-create-index"
DATABASE_NAME = "HotelsCreateIndex"  # DEFAULT when env var not set
PARTITION_KEY_FIELD = "HotelId"      # NEW constant
PARTITION_KEY_VALUE = "hotels"
EMBEDDING_FIELD = "DescriptionVector"
EMBEDDING_DIMENSIONS = 1536
DEFAULT_QUERY_TEXT = "hotel near the ocean"
DEFAULT_TOP_COUNT = 5
DEFAULT_DATA_FILE = "../data/HotelsData_toCosmosDB_Vector.json"
KNOWN_CONTAINERS = {"diskann": "hotels_diskann", "quantizedflat": "hotels_quantizedflat"}
```

**Java** (Config.java)
```java
private static final String SCENARIO_NAME = "hotels-vector-search-create-index";
private static final String DEFAULT_DATABASE_NAME = "HotelsCreateIndex"; // Matches others
private static final String DEFAULT_QUERY_TEXT = "hotel near the ocean";
private static final int DEFAULT_TOP_COUNT = 5;
private static final String DEFAULT_EMBEDDING_FIELD = "DescriptionVector";
private static final int EXPECTED_DIMENSIONS = 1536;
private static final String PARTITION_KEY_FIELD = "HotelId";  // NEW
private static final String PARTITION_KEY_VALUE = "hotels";   // NEW
```

**.NET** (src/Config.cs)
```csharp
private const string ScenarioName = "hotels-vector-search-create-index";
private const string DefaultDatabaseName = "HotelsCreateIndex";
private const string DefaultQueryText = "hotel near the ocean";
private const int DefaultTopCount = 5;
private const string DefaultEmbeddingFieldName = "DescriptionVector";
private const int DefaultEmbeddingDimensions = 1536;
private const string PartitionKeyFieldName = "HotelId";   // NEW
private const string PartitionKeyFieldValue = "hotels";   // NEW
```

---

## Cross-Sample Test Suite (New)

To prevent drift, add a **unified test that validates all samples against the schema**.

**Location:** `.github/plans/create-index-validation.test.ts` (TypeScript reference test)

```typescript
/**
 * Cross-Sample Scenario Validation
 * 
 * Validates that all create-index samples conform to the unified scenario schema.
 * Run this test after any change to config constants.
 * 
 * Assertion: All 5 samples must load identical scenario values.
 */

const EXPECTED_SCENARIO = {
  database_name: "HotelsCreateIndex",
  partition_key_field: "HotelId",
  partition_key_value: "hotels",
  containers: ["hotels_diskann", "hotels_quantizedflat"],
  embedding_field: "DescriptionVector",
  embedding_dimensions: 1536,
  default_query_text: "hotel near the ocean",
  default_top_count: 5,
  distance_functions: ["Cosine", "DotProduct", "Euclidean"],
};

// Test assertions per language:
// ✓ TypeScript config.ts exports all constants
// ✓ Go config.go const block matches schema
// ✓ Python config.py defines all CONSTANTS in order
// ✓ Java Config.java static finals match schema
// ✓ .NET Config.cs private consts match schema
```

**Rationale:**
- Compile-time checks: Each language's config module exports/defines constants that can be statically analyzed
- Runtime checks: Load config at startup in each sample, validate against schema
- CI integration: Add to GitHub Actions to prevent PRs that introduce drift

---

## Implementation Roadmap

### Phase 1: Analysis & Approval (Current)
- [ ] Present drift analysis to team
- [ ] Approve schema and standardized values
- [ ] Assign owners per language

### Phase 2: Implement Fixes (Per Language, Parallel)
- [ ] **TypeScript:** Update database name to `"HotelsCreateIndex"` (already correct)
- [ ] **Go:** Change partition key from `"PartitionKey"` → `"HotelId"`, top count 3 → 5
- [ ] **Python:** Add `DATABASE_NAME = "HotelsCreateIndex"` default, add partition key constants
- [ ] **Java:** Add partition key field/value constants, verify embedding field
- [ ] **.NET:** Verify all constants, add missing defaults

### Phase 3: Add Cross-Sample Validation
- [ ] Write test suite in `.github/test/create-index-schema-validation.sh`
- [ ] Add to CI pipeline to prevent future drift
- [ ] Document validation in sample READMEs

### Phase 4: Verify & Lock
- [ ] Run all 5 samples side-by-side with identical config
- [ ] Confirm all 3 distance functions work identically per sample
- [ ] Output comparison table matches across languages
- [ ] Update architecture plan with "Drift Prevention" section

---

## References

- Architecture Plan: `.github/plans/create-index-architecture.md`
- Vector-Search Partition Key (Source of Truth): `nosql-vector-search-*/`
- Test Data: `data/HotelsData_toCosmosDB_Vector.json`
