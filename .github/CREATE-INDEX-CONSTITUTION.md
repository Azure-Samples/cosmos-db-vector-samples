# CREATE-INDEX Samples Constitution

**Effective:** August 2026  
**Scope:** All CREATE-INDEX language samples (Python, TypeScript, Java, Go, .NET)  
**Authority:** Established through systematic bug fixes and reference implementation alignment (cosmos-db-vector-samples commit history)

---

## Preamble

The CREATE-INDEX samples demonstrate how to programmatically create Cosmos DB containers with vector indexes using language-specific SDKs and Azure Resource Manager (ARM) control plane operations. This constitution establishes the architectural requirements, validation standards, and consistency rules that all samples must follow.

**Core Principle:** *Control plane operations (creating/deleting containers and indexes) are a featured capability of these samples. Any configuration variable required to make control plane operations work MUST be validated, documented, and treated as mandatory — not optional.*

---

## I. Parameterization Requirements

### 1.1 Container and Index Names Must Come From Environment Variables

**Rule:** All container names and index names used in control plane operations MUST be read from environment variables at runtime. Hard-coded language-specific container names (e.g., `hotels_diskann_py`, `hotels_diskann_js`) are forbidden.

**Rationale:** Hard-coded names break the contract between URI path and request body, causing Cosmos DB HTTP 400 BadRequest errors ("Resource name in request-uri does not match Resource name in request-body"). Hard-coded names also prevent reuse of samples across different deployment scenarios.

**Implementation:**
- Define `COSMOSDB_CONTAINER_NAME` environment variable
- Define `COSMOSDB_INDEX_NAME` (if applicable to the language's index configuration)
- Read these variables at startup and pass consistently to all control plane operations (both URI paths and JSON request bodies)
- Validate these variables are not empty or null before use

**Example (Python config.py):**
```python
REQUIRED_ENV_VARS = [
    "COSMOSDB_ENDPOINT",
    "COSMOSDB_DATABASE_NAME",
    "COSMOSDB_CONTAINER_NAME",
]
```

---

## II. Control Plane (ARM SDK) Variable Requirements

### 2.1 ARM SDK Variables Are Mandatory — Managed Identity Is the Default

**Rule:** Control plane operations require the Azure Resource Manager SDK and the following 4 environment variables. These variables MUST be validated before any control plane operations are attempted.

**Authentication Model:** 
- **Default & Production Scenario:** Managed identity (enabled by infrastructure/deployment platform)
- **Local Development:** Azure CLI cached credentials or explicit service principal environment variables
- **All samples must support managed identity** as the primary authentication path, enforced by the hosting infrastructure

**Mandatory ARM SDK Variables:**
- `AZURE_SUBSCRIPTION_ID` — Azure subscription ID (e.g., `12345678-1234-1234-1234-123456789abc`)
- `AZURE_RESOURCE_GROUP` — Resource group name where Cosmos DB account is deployed
- `AZURE_COSMOSDB_ACCOUNT_NAME` — Cosmos DB account name (NOT the full endpoint URL)
- `AZURE_LOCATION` — Azure region code (e.g., `eastus`, `westeurope`, `southeastasia`)

**Rationale:** The ARM SDK uses these variables to:
1. Construct the Cosmos DB account resource URI in Azure Resource Manager
2. Authenticate requests using managed identity (default in Azure—AKS, App Service, Functions, VMs with managed identities)
3. Fall back to local development credentials (Azure CLI, service principal env vars) when managed identity is not available
4. Create, delete, and update containers and indexes using the control plane API
5. Provide clear diagnostics if authentication credentials or required variables are missing

Missing any one of these variables prevents control plane operations and should cause immediate, clear validation failure. Managed identity is the assumed default; samples do NOT require explicit credential configuration when running in Azure infrastructure.

### 2.2 Validation Model: Go Reference Implementation

**Rule:** All samples MUST validate ARM SDK variables using the **Go sample as the reference implementation** (see `nosql-create-index-go/src/config.go`).

**Validation Principles:**
- **Fail Fast:** Validate ALL required variables upfront before attempting any control plane operations
- **List Missing Variables:** When validation fails, output should clearly list WHICH variables are missing, not just say "configuration invalid"
- **No Empty Strings:** Empty or whitespace-only values are treated as missing (e.g., `AZURE_SUBSCRIPTION_ID=""` is an error)
- **Consistent Behavior:** All 5 samples must reject invalid configs in the same way

**Reference Implementation:**
```go
// Go sample validates 9 variables (3 data plane + 4 ARM SDK + 2 OpenAI)
// and outputs clear error listing which ones are missing
var required = []string{
    "COSMOSDB_ENDPOINT",
    "COSMOSDB_DATABASE_NAME", 
    "COSMOSDB_CONTAINER_NAME",
    "AZURE_SUBSCRIPTION_ID",
    "AZURE_RESOURCE_GROUP",
    "AZURE_COSMOSDB_ACCOUNT_NAME",
    "AZURE_LOCATION",
    "OPENAI_ENDPOINT",
    "OPENAI_KEY",
}
```

### 2.3 Language-Specific Configuration Patterns

**Rule:** Each language MUST use its native, conventional configuration pattern. Do NOT force all languages to use .env files.

**Approved Patterns:**

| Language | Config Source | Example | Notes |
|----------|---------------|---------|-------|
| **Python** | `.env` file + environment variables | `python-dotenv` library | Environment variables override .env |
| **TypeScript** | `.env` file + environment variables | `dotenv` npm package | Node.js standard |
| **Java** | `application.properties` or environment variables | Spring-style property files | JVM convention |
| **Go** | Environment variables only | Direct `os.Getenv()` calls | Go stdlib convention |
| **.NET** | `appsettings.json` + `ConfigurationBuilder` | `Microsoft.Extensions.Configuration` | .NET standard pattern; .env files are NOT appropriate for .NET |

**Special Case — .NET:** .NET samples MUST use `IConfiguration` with `ConfigurationBuilder` (reads appsettings.json, then environment variables in precedence order). Do NOT use .env files in .NET samples — this violates .NET conventions and confuses developers.

---

## III. Documentation Requirements

### 3.1 README Must Document Control Plane Requirements and Managed Identity

**Rule:** Every CREATE-INDEX sample's README MUST include a clearly labeled "⚠️ **Control Plane Requirement**" section that:
1. Explains that the sample uses ARM SDK for control plane operations
2. Lists all 4 mandatory ARM SDK variables (`AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`, `AZURE_COSMOSDB_ACCOUNT_NAME`, `AZURE_LOCATION`)
3. Clearly states that **managed identity is the default authentication method** when running in Azure infrastructure (AKS, App Service, Functions, VMs with managed identities)
4. Explains authentication fallback for local development (Azure CLI, service principal credentials)
5. Shows the language-specific configuration pattern (how to set these variables for that language)

**Example README Section:**

```markdown
### ⚠️ **Control Plane Requirement**

This sample uses the Azure Resource Manager (ARM) SDK to create containers and indexes at runtime (control plane operations). To run this sample, you MUST provide these environment variables:

- `AZURE_SUBSCRIPTION_ID` — Your Azure subscription ID
- `AZURE_RESOURCE_GROUP` — Resource group where your Cosmos DB account is deployed  
- `AZURE_COSMOSDB_ACCOUNT_NAME` — Your Cosmos DB account name
- `AZURE_LOCATION` — Azure region (e.g., `eastus`)

Without these variables, control plane operations will fail immediately with a clear error listing which variables are missing.

**In Azure (production):** Managed identity will automatically authenticate using these variables — no credential configuration required.

**Locally (development):** Set these in your `.env` file (or language-specific config file). You'll also need Azure CLI logged in (`az login`) or service principal credentials.
```

### 3.2 README Must Document Data Plane vs Control Plane

**Rule:** README MUST clearly distinguish between data plane variables (Cosmos DB endpoint, database name, container name) and control plane variables (ARM SDK variables).

**Data Plane Variables:**
- `COSMOSDB_ENDPOINT` — Cosmos DB account endpoint URL
- `COSMOSDB_DATABASE_NAME` — Database name
- `COSMOSDB_CONTAINER_NAME` — Container name to create or use

**Control Plane Variables:**
- `AZURE_SUBSCRIPTION_ID` — Required for ARM SDK operations
- `AZURE_RESOURCE_GROUP` — Required for ARM SDK operations
- `AZURE_COSMOSDB_ACCOUNT_NAME` — Required for ARM SDK operations
- `AZURE_LOCATION` — Required for ARM SDK operations

---

## IV. Runtime Behavior Standards

### 4.1 Container and Index Names Must Not Include Language Name

**Rule:** Container names and index names read from environment variables MUST NOT include the programming language name (e.g., `py`, `ts`, `js`, `go`, `net`).

**Rationale:** Container names are infrastructure resources, not language-specific artifacts. Including language names in container names couples the container identity to implementation details, violating separation of concerns.

**Correct:**
```
COSMOSDB_CONTAINER_NAME=hotels_diskann
COSMOSDB_INDEX_NAME=vectorIndex
```

**Incorrect:**
```
COSMOSDB_CONTAINER_NAME=hotels_diskann_py  # Language name embedded
COSMOSDB_CONTAINER_NAME=hotels_diskann_ts  # Language name embedded
```

### 4.2 Deletion of Existing Containers

**Rule:** If a sample deletes an existing container before creating a new one, this MUST be:
1. Explicitly logged in diagnostic output
2. Only performed if the user has explicitly set an environment variable (e.g., `DELETE_EXISTING_CONTAINER=true`)
3. Not the default behavior

**Rationale:** Unexpected container deletion in production is catastrophic. Samples must make this behavior explicit and require opt-in.

### 4.3 Diagnostic Output Standards

**Rule:** All samples MUST output a diagnostic check section at startup that includes:
1. Cosmos DB endpoint URL (confirm connectivity)
2. Database name and existence status (confirm database is accessible)
3. Container count in the database (alert if 0 containers exist)
4. Summary of control plane operations (what will be created)
5. Clear error messages listing missing variables if validation fails

**Example Output:**
```
=== Diagnostic Check ===
Cosmos DB Endpoint: https://db-account.documents.azure.com:443/
Database name: HotelsCreateIndex
✓ Database 'HotelsCreateIndex' exists
  Containers found: 0
  ⚠ WARNING: Database exists but has NO containers.

=== Control Plane ===
Will create container: hotels_diskann
Will create index: vectorIndex (diskANN, 1536 dimensions, cosine metric)

=== Starting operations ===
```

---

## V. Testing and Validation Standards

### 5.1 All Samples Must Run to Completion

**Rule:** After implementing changes, all 5 CREATE-INDEX samples (Python, TypeScript, Java, Go, .NET) MUST be executed end-to-end and validated to:
1. Complete without errors (exit code 0)
2. Successfully create containers with vector indexes
3. Successfully load sample data
4. Produce diagnostic output confirming operations completed

**Test Command (per language):**
```
# Python
python -m src.index

# TypeScript
npm install && npm run build && npm start

# Java
mvn clean compile exec:java -Dexec.mainClass="com.azure.cosmos.createindex.Program"

# Go
go run ./src

# .NET
dotnet run
```

### 5.2 Validation Failure Must Produce Clear Error Messages

**Rule:** When any required variable is missing, the sample MUST:
1. Exit with non-zero code
2. Output an error message that CLEARLY LISTS which variables are missing (not just "Configuration validation failed")
3. NOT attempt any control plane operations

**Example Error Output:**
```
Configuration validation failed. Missing required environment variables:
  - AZURE_SUBSCRIPTION_ID
  - AZURE_LOCATION
Please set these variables before running the sample.
```

---

## VI. Code Pattern Standards

### 6.1 TYPE_CHECKING Import Gotcha (Python)

**Rule:** Python samples using static type hints with `TYPE_CHECKING` imports MUST NOT assume TYPE_CHECKING imports are available at runtime.

**Pattern:** If a module imports something inside `if TYPE_CHECKING:`, any function that uses that import MUST re-import it at function scope:

```python
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from azure.identity import DefaultAzureCredential

def delete_containers():
    from azure.identity import DefaultAzureCredential  # Function-level import
    # Now safe to use DefaultAzureCredential
```

**Rationale:** `TYPE_CHECKING` is `False` at runtime, so those imports are never executed. Code that references them fails with NameError.

### 6.2 Strict Null/Empty Checks

**Rule:** All configuration validation must treat empty strings, None/null, and whitespace-only values identically — as missing configuration.

**Correct Pattern:**
```python
if not subscription_id or not subscription_id.strip():
    raise ValueError("AZURE_SUBSCRIPTION_ID is required")
```

**Incorrect Pattern:**
```python
subscription_id = os.getenv("AZURE_SUBSCRIPTION_ID") or ""  # Allows empty strings to pass
```

---

## VII. Governance and Review

### 7.1 Configuration Changes Require Coordination

**Rule:** Any change to environment variable names, configuration patterns, or validation logic across CREATE-INDEX samples MUST:
1. Be applied consistently to ALL 5 samples
2. Be tested end-to-end on all 5 samples
3. Include README updates documenting the change
4. Be bundled in a single commit or PR

**Rationale:** Inconsistency across samples confuses users and violates the contract that all samples demonstrate the same best practices.

### 7.2 Reference Implementation Authority

**Rule:** When resolving disputes about validation behavior, configuration patterns, or error messages, the **Go sample is the reference implementation**. All other samples MUST align to Go's behavior.

**Why Go:** Go has the strictest validation, clearest error messages, and uses the most conventional configuration pattern (environment variables only, no files).

---

## VIII. Change Log and Versioning

### 8.1 Constitution Updates

**Date** | **Change** | **Rationale**
---|---|---
Aug 2026 | Initial constitution (v1.0) | Established from systematic validation enforcement and reference implementation alignment

---

## Appendix: Quick Reference

### Required Environment Variables (All Samples)

```bash
# Data Plane (Cosmos DB connectivity)
export COSMOSDB_ENDPOINT=https://db-account.documents.azure.com:443/
export COSMOSDB_DATABASE_NAME=HotelsCreateIndex
export COSMOSDB_CONTAINER_NAME=hotels_diskann

# Control Plane (ARM SDK — MANDATORY)
export AZURE_SUBSCRIPTION_ID=12345678-1234-1234-1234-123456789abc
export AZURE_RESOURCE_GROUP=my-resource-group
export AZURE_COSMOSDB_ACCOUNT_NAME=db-account
export AZURE_LOCATION=eastus

# OpenAI (if using embeddings in this sample)
export OPENAI_ENDPOINT=https://api.openai.com/
export OPENAI_KEY=sk-...
```

### Sample Execution Checklist

- [ ] All 4 ARM SDK variables set and non-empty
- [ ] `COSMOSDB_ENDPOINT` accessible (can curl/ping it)
- [ ] Database exists in Cosmos DB account
- [ ] Container name does NOT include language name
- [ ] Run sample to completion (exit 0)
- [ ] Verify containers created in Cosmos DB portal
- [ ] Verify vector indexes exist on containers
- [ ] Check diagnostic output for warnings or errors

---

## Ratification

This constitution is ratified based on the systematic bug fixes and validation enforcement applied across all CREATE-INDEX samples in the cosmos-db-vector-samples repository. It represents the architectural decisions and best practices established through hands-on validation and reference implementation alignment.

**By maintaining this constitution, we ensure:**
- Consistency across all language samples
- Clear requirements for control plane operations
- Fail-fast validation with clear error messages
- Proper separation of data plane (connectivity) and control plane (ARM SDK) concerns
- Language-native configuration patterns that respect each language's conventions
