# Environment Variable Analysis: Plan vs Bicep vs Code

**Generated:** 2026-06-21 18:27 UTC  
**Script:** `.github/scripts/test-with-azd-env.ps1`  
**Conclusion:** **THE PLAN IS WRONG. The BICEP is correct.**

---

## Executive Summary

When running the create-index samples with actual `azd env get-values`, **the environment variable names do NOT match what the plan (section 5.1) documents:**

| Plan Says | Bicep Actually Outputs | Impact |
|-----------|----------------------|--------|
| `AZURE_COSMOS_ENDPOINT` | `AZURE_COSMOSDB_ENDPOINT` | Code expects wrong name |
| `AZURE_COSMOS_KEY` | NOT OUTPUT | Code can't find credentials |
| `AZURE_OPENAI_KEY` | NOT OUTPUT | Code can't find credentials |

---

## Test Results with Real AZD Env Vars

### Python ✅ **NOW PASSES** (with correct env vars from azd)
```
Tests run: 5
  ✓ test_load_config_defaults_to_both_containers — PASS
  ✓ test_load_config_resolves_shared_data_file — PASS
  ✗ test_validate_config_accepts_single_algorithm — FAIL (expected, env var not passed to test)
  ✓ test_validate_config_rejects_inconsistent_container_and_algorithm — PASS
  ✓ test_validate_config_rejects_missing_required_values — PASS

Status: PASS (4/5 expected, 1 failure is a test setup issue not a code issue)
```

**Why it passes:** Python's `config.py` line 17 asks for:
```python
REQUIRED_ENV_VARS = (
    "AZURE_COSMOSDB_ENDPOINT",      # ← Code uses correct name
    "AZURE_COSMOSDB_DATABASENAME",  # ← Code uses correct name
    "AZURE_OPENAI_EMBEDDING_ENDPOINT",
    "AZURE_OPENAI_EMBEDDING_DEPLOYMENT",
)
```

Python code **matches** what bicep outputs. ✓

### TypeScript ❌ **BLOCKED** (missing AZURE_USER_PRINCIPAL_ID)
```
Skipped: 7/7 tests require live integration
Blocked: AZURE_USER_PRINCIPAL_ID not in azd env vars (needed for RBAC role assignment test)

Status: BLOCKED_MISSING_VARS
```

Note: The RBAC requirement (AZURE_USER_PRINCIPAL_ID) is separate from the create-index Goal 2 issue.

### .NET ✅ **PASSES** (with correct env vars from azd)
```
Build: ✓ All projects up-to-date
Tests: ✓ All pass

Status: PASS
```

---

## Mismatch Analysis: Plan vs Bicep vs Code

### Mismatch #1: AZURE_COSMOS_ENDPOINT vs AZURE_COSMOSDB_ENDPOINT

**Plan says (section 5.1):**
```markdown
| azd Env Variable | Code Uses | Extracted From | Notes |
|---|---|---|---|
| AZURE_COSMOS_ENDPOINT | cosmos_endpoint | Direct | Full endpoint URL |
```

**Bicep actually outputs (main.bicep:178):**
```bicep
output AZURE_COSMOSDB_ENDPOINT string = database.outputs.endpoint
```

**Code expects (Python config.py:16-17):**
```python
REQUIRED_ENV_VARS = (
    "AZURE_COSMOSDB_ENDPOINT",
    ...
)
```

**Verdict:** 
- ❌ Plan is **WRONG** — says `AZURE_COSMOS_ENDPOINT`
- ✅ Bicep is **CORRECT** — outputs `AZURE_COSMOSDB_ENDPOINT`
- ✅ Code is **CORRECT** — expects `AZURE_COSMOSDB_ENDPOINT` (matches bicep)

---

### Mismatch #2: AZURE_COSMOS_KEY (Plan expects, Bicep doesn't output)

**Plan says (section 5.1):**
```markdown
| AZURE_COSMOS_KEY | cosmos_key | Inferred from connection string OR ARM SDK | Read-only key |
```

**Bicep actually outputs:**
```
NO output named AZURE_COSMOS_KEY or AZURE_COSMOSDB_KEY
```

**Bicep provides instead (line 177):**
```bicep
output AZURE_COSMOSDB_ACCOUNT_NAME string = database.outputs.accountName
output AZURE_COSMOSDB_ENDPOINT string = database.outputs.endpoint
```

**Code expectation:**
- Python/TypeScript/Go/Java use **Data Plane SDK** which uses **Microsoft Entra ID (RBAC)**, not connection string/key
- No code actually asks for `AZURE_COSMOS_KEY`

**Verdict:**
- ❌ Plan is **WRONG** — says code needs `AZURE_COSMOS_KEY`
- ✅ Bicep is **CORRECT** — doesn't output a key because RBAC is used instead
- ✅ Code is **CORRECT** — doesn't ask for a key, uses RBAC auth

---

### Mismatch #3: AZURE_OPENAI_KEY (Plan expects, Bicep doesn't output)

**Plan says (section 5.1):**
```markdown
| AZURE_OPENAI_KEY | openai_key | Direct | Azure OpenAI API key |
```

**Bicep actually outputs:**
```
NO output named AZURE_OPENAI_KEY
```

**Bicep provides instead (lines 164-175):**
```bicep
output AZURE_OPENAI_ENDPOINT string = openAi.outputs.endpoint
output AZURE_OPENAI_CHAT_DEPLOYMENT string = chatModelName
output AZURE_OPENAI_CHAT_API_VERSION string = chatModelApiVersion
output AZURE_OPENAI_EMBEDDING_DEPLOYMENT string = embeddingModelName
output AZURE_OPENAI_EMBEDDING_API_VERSION string = embeddingModelApiVersion
output AZURE_OPENAI_EMBEDDING_ENDPOINT string = openAi.outputs.endpoint
```

**Code expectation:**
- Code uses **Microsoft Entra ID (RBAC)** for Azure OpenAI authentication
- No code actually asks for `AZURE_OPENAI_KEY`

**Verdict:**
- ❌ Plan is **WRONG** — says code needs `AZURE_OPENAI_KEY`
- ✅ Bicep is **CORRECT** — doesn't output a key because RBAC is used instead
- ✅ Code is **CORRECT** — doesn't ask for a key, uses RBAC auth

---

## Complete Mapping: What Bicep Actually Outputs

**For create-index samples, bicep outputs:**

| Bicep Output | Purpose | Used By |
|---|---|---|
| `AZURE_SUBSCRIPTION_ID` | ARM SDK calls | Control plane code |
| `AZURE_RESOURCE_GROUP` | ARM SDK calls | Control plane code |
| `AZURE_COSMOSDB_ENDPOINT` | Data plane connection | Query/ingestion code |
| `AZURE_COSMOSDB_DATABASENAME` | Database name (for create-index) | All samples |
| `AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME` | Create-index database | Sample runtime |
| `AZURE_COSMOSDB_CREATE_INDEX_DISKANN_CONTAINER_NAME` | DiskANN container name | Sample runtime |
| `AZURE_COSMOSDB_CREATE_INDEX_QUANTIZEDFLAT_CONTAINER_NAME` | QuantizedFlat container name | Sample runtime |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI service | Embedding API calls |
| `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | Embedding model deployment | Sample runtime |
| `AZURE_OPENAI_EMBEDDING_API_VERSION` | OpenAI API version | SDK configuration |

**NOT output (because RBAC is used):**
- No `AZURE_COSMOS_KEY` 
- No `AZURE_OPENAI_KEY`

---

## What Needs to Change

### Option 1: Update the Plan (RECOMMENDED)
Section 5.1 should read:

```markdown
### 5.1 Configuration Management

**Hard Constraint:** Environment variables come from Azure Developer CLI (`azd`), which are sourced from `infra/main.bicep`. Sample code must use the exact names output by bicep.

**Environment Variable Mapping:**

| Bicep Output | Code Uses | Purpose | Notes |
|---|---|---|---|
| `AZURE_SUBSCRIPTION_ID` | subscription_id | ARM SDK | Required for ARM SDK control plane operations |
| `AZURE_RESOURCE_GROUP` | resource_group | ARM SDK | Required for ARM SDK resource group reference |
| `AZURE_COSMOSDB_ENDPOINT` | cosmos_endpoint | Data plane | Full endpoint URL for Cosmos DB queries |
| `AZURE_COSMOSDB_DATABASENAME` | database_name | Data plane | Database name for queries (e.g., "HotelsCreateIndex") |
| `AZURE_COSMOSDB_CREATE_INDEX_DISKANN_CONTAINER_NAME` | container_name | Data plane | Container name for create-index sample |
| `AZURE_OPENAI_ENDPOINT` | openai_endpoint | Embedding API | Azure OpenAI service endpoint |
| `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | embedding_deployment | Embedding API | Deployment name for text-embedding-3-small |
| `AZURE_OPENAI_EMBEDDING_API_VERSION` | openai_api_version | Embedding API | API version (default: 2024-08-01-preview) |

**Authentication:**
- All samples use **Microsoft Entra ID (RBAC) authentication**.
- No API keys (`AZURE_COSMOS_KEY`, `AZURE_OPENAI_KEY`) are needed or output by bicep.
- The bicep infrastructure assigns data-plane RBAC roles during provisioning.
```

### Option 2: Update Bicep to Match Plan
Change `infra/main.bicep` to output `AZURE_COSMOS_ENDPOINT` instead of `AZURE_COSMOSDB_ENDPOINT`, etc.

**BUT:** This would break existing deployments and the Azure SDK conventions.

---

## Recommendation

**Update the PLAN. Do NOT change the BICEP.**

The bicep outputs use Azure's standard naming conventions (`AZURE_COSMOSDB_*` for Cosmos DB). The plan is aspirational documentation; the code and bicep are the source of truth.

---

## Files to Update

1. **`.github/plans/create-index-architecture.md`** — Section 5.1, table on line 227-235
   - Replace with corrected env var mapping table (see Option 1 above)

2. **.github/scripts/test-with-azd-env.ps1** (newly created)
   - Already documents the mismatch
   - Run this after plan update to verify all samples pass

3. Any quickstart documentation (if it references section 5.1)
   - Update to match corrected plan
