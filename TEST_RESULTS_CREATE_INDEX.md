# CREATE-INDEX Parameterization Test Results

**Test Date:** 2026-08-13
**Objective:** Validate dual-layer parameterization fixes across all 5 CREATE-INDEX language samples

---

## Summary: 3 of 5 Samples Validated ✓

| Language  | Status | Container Names | Data Insertion | Queries | Cleanup | Exit Code |
|-----------|--------|-----------------|-----------------|---------|---------|-----------|
| **TypeScript** | ✓ PASS | ✓ Non-language-specific | ✓ 50 docs | ✓ All 3 distance functions | ✓ Complete | 0 |
| **Python** | ✓ PASS | ✓ Non-language-specific | ✓ 50 docs (diskANN + quantizedflat) | ✓ All 3 distance functions | ✓ Complete | 0 |
| **Java** | ✓ PASS | ✓ Non-language-specific | ✓ 50 docs (diskANN + quantizedflat) | ✓ All 3 distance functions | ✓ Complete | 0 |
| **Go** | ⚠ PARTIAL | ✓ Non-language-specific | ✓ hotels_diskann: 50 docs | ✗ hotels_quantizedflat: Access error | ⚠ Incomplete | 1 |
| **.NET** | ⚠ PARTIAL | ✗ Language-specific suffixes | ✗ Parameterization not applied | ✗ Config mismatch | ⚠ Incomplete | 1 |

---

## Detailed Results

### ✓ TypeScript — PASS (Exit 0)
- **Containers Created:** hotels_diskann, hotels_quantizedflat (non-language-specific) ✓
- **Container Creation Time:** ~50s (DiskANN + QuantizedFlat)
- **Data Insertion:** 50 documents successfully inserted to both containers (5243.73 RUs + 2621.86 RUs)
- **Queries:** All 3 distance functions (Cosine, DotProduct, Euclidean) executed successfully on both containers
- **Cleanup:** Both containers deleted successfully
- **Validation:** Complete end-to-end success; demonstrates correct parameterization strategy
- **Log:** \output2/typescript-run.log\

### ✓ Python — PASS (Exit 0)
- **Issue Fixed:** NameError in control_plane.py (missing import of config module)
- **Fix Applied:** Added \rom . import config as config_module\ at module level in control_plane.py
- **Containers Created:** hotels_diskann, hotels_quantizedflat (non-language-specific) ✓
- **Container Creation Time:** ~2s total (ARM SDK, very fast)
- **Data Insertion:** 50 documents successfully inserted to both containers (5243.72 RUs + 2621.86 RUs)
- **Queries:** All 3 distance functions executed successfully on both containers
- **Cleanup:** Both containers deleted successfully
- **Validation:** Complete end-to-end success; parameterization strategy validated for Python
- **Log:** \output2/python-run.log\

### ✓ Java — PASS (Exit 0)
- **Containers Created:** hotels_diskann, hotels_quantizedflat (non-language-specific) ✓
- **Container Creation Time:** ~62s (DiskANN 31.2s + QuantizedFlat 31.1s)
- **Data Insertion:** 50 documents successfully inserted to both containers (5243.73 RUs + 2621.86 RUs)
- **Queries:** All 3 distance functions executed successfully on both containers
- **Result Comparison:** Query results identical across index types (top hotel: City Center Summer Wind, score consistency ±0.0025)
- **Cleanup:** Both containers deleted successfully
- **Validation:** Complete end-to-end success; ARM SDK-based cleanup works correctly with parameterized names
- **Log:** \output2/java-run.log\

### ⚠ Go — PARTIAL (Exit 1)
- **Containers Created:** hotels_diskann, hotels_quantizedflat (non-language-specific) ✓
- **Container Creation Time:** DiskANN 11.56s + QuantizedFlat 6.69s ✓
- **Data Insertion:** hotels_diskann: 50 docs inserted successfully ✓
- **Failure Point:** hotels_quantizedflat insertion failed
- **Error:** \ailed to insert 50 documents. Verify that the database and containers were provisioned already and that your identity has Azure Cosmos DB data-plane access.\
- **Root Cause:** Access/permissions issue during second container insert, NOT a parameterization issue (container was created correctly)
- **Parameterization Status:** ✓ Correctly using env vars for container names (verified in creation logs)
- **Log:** \output2/go-run.log\
- **Action:** Investigate Go data-plane access; parameterization itself is correct

### ⚠ .NET — PARTIAL (Exit 1)
- **Issue:** Containers created with language-specific suffixes (\hotels_diskann_dotnet\, \hotels_quantizedflat_dotnet\)
- **Root Cause:** Config.cs not reading env vars for container names; using fallback with language suffix
- **Evidence:** \Container: hotels_diskann_dotnet\ in output, but env vars \AZURE_COSMOSDB_CREATE_INDEX_DISKANN_CONTAINER_NAME=hotels_diskann\ are set
- **Failure Point:** Tried to insert into \hotels_diskann\ (from env var) but container was created as \hotels_diskann_dotnet\ (from code fallback)
- **Error:** \NotFound (404)\ on hotels_quantizedflat lookup
- **Action:** Debug .NET Config.Load() method; verify env var reading logic
- **Log:** \output2/dotnet-run.log\

---

## Parameterization Fix Strategy — Validation Summary

**Three Standardized Environment Variables (Non-Language-Specific):**
\\\
AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME = "HotelsCreateIndex"
AZURE_COSMOSDB_CREATE_INDEX_DISKANN_CONTAINER_NAME = "hotels_diskann"
AZURE_COSMOSDB_CREATE_INDEX_QUANTIZEDFLAT_CONTAINER_NAME = "hotels_quantizedflat"
\\\

**Validation Status by Language:**
- ✓ **TypeScript:** Correctly reads and uses all three env vars (index.ts line 67)
- ✓ **Python:** Correctly reads and uses env vars via config.KNOWN_CONTAINERS (control_plane.py with fixed import)
- ✓ **Java:** Correctly reads and uses env vars via Config.java accessors (ControlPlane.java method parameters)
- ✓ **Go:** Correctly reads and uses env vars via config globals (dataplane.go references parameterized names)
- ⚠ **.NET:** NOT correctly reading env vars for container names (Config.cs showing fallback behavior)

---

## Lessons Learned

1. **Python TYPE_CHECKING Import Gotcha:** Imports wrapped in \if TYPE_CHECKING:\ are not available at runtime. Must use direct import for modules needed at runtime.

2. **Language-Specific Mismatch in Data Plane:** Go and .NET show data-plane failures even when containers are created correctly. Indicates that parameterization alone is not sufficient; the entire data insertion pipeline must use env vars consistently.

3. **Config Pattern Matters:** 
   - TypeScript (config object): Simple, direct property access ✓
   - Python (module-level dict): Requires careful import management ✓
   - Java (accessor methods): Verbose but reliable ✓
   - Go (module globals): Works but requires explicit initialization ✓
   - .NET (config record): Needs verification of env var reading logic ⚠

4. **.NET Fallback Behavior:** .NET Config appears to be using a fallback pattern (language suffix) when env vars are not read. Need to verify:
   - Is \Config.Load()\ actually being called?
   - Are env vars being set before .NET runs?
   - Is the resilient pattern matching in \AlgorithmLabel()\ interfering with container name resolution?

---

## Next Steps

### Immediate (Blocking)
1. **Debug .NET Config.Load():** Add logging to verify env vars are read; confirm non-language-specific names used
2. **Debug Go Data-Plane Access:** Investigate hotels_quantizedflat insertion failure; verify permissions/access

### After Resolution
1. Update all README files with deployment table (PowerShell and Bash env var setup)
2. Document the three standardized environment variables and their default values
3. Create unified commit with all parameterization fixes

---

## File Locations

Test logs saved to output2/ subdirectories in each sample:
- \
osql-create-index-typescript/output2/typescript-run.log\ ✓
- \
osql-create-index-python/output2/python-run.log\ ✓
- \
osql-create-index-java/output2/java-run.log\ ✓
- \
osql-create-index-go/output2/go-run.log\ ⚠
- \
osql-create-index-dotnet/output2/dotnet-run.log\ ⚠

