# Quickstart Samples Constitution

## Scope

This document establishes the architectural requirements, code patterns, and consistency standards for all **Vector Search (Quickstart)** samples in the cosmos-db-vector-samples repository. 

**Scope:** All quickstart language samples (Python, TypeScript, Java, Go, .NET)

**Related:** See `CREATE-INDEX-CONSTITUTION.md` for control plane (container/index creation) samples. Quickstart samples focus on the data plane (loading data and querying with vector similarity).

---

## I. Quickstart Sample Purpose & Scope

### 1.1 Definition

A **Quickstart sample** demonstrates end-to-end vector search workflow for developers who already have Cosmos DB containers pre-provisioned (via `CREATE-INDEX` samples or Azure Portal). The quickstart assumes:
- ✅ Containers already exist with vector indexes configured
- ✅ Partition keys already set (MultiHash on `/HotelId`)
- ✅ Vector index policies (DiskANN or QuantizedFlat) already applied
- 🚫 Sample does NOT create containers or indexes—only data plane operations

### 1.2 Two-Step Learning Path

1. **CREATE-INDEX samples** — Learn how to create containers and indexes with control plane APIs
2. **QUICKSTART samples** — Learn how to load data and run vector similarity queries with data plane APIs

This allows developers to:
- Use quickstarts as standalone demonstrations (if containers are pre-provisioned)
- Chain samples together for full end-to-end provisioning + querying

---

## II. Data Plane Workflow Requirements

### 2.1 Core Workflow

Every quickstart sample MUST execute these steps in order:

1. **Initialize clients** — Connect to Cosmos DB and Azure OpenAI using passwordless auth (with fallback to key-based)
2. **Validate configuration** — Ensure all required environment variables are set and non-empty
3. **Load data** — Read pre-computed embedding vectors from JSON data file (shared across all samples)
4. **Bulk insert** — Insert documents into the selected container (DiskANN or QuantizedFlat) with RU tracking
5. **Query execution** — Generate a query embedding via Azure OpenAI, then execute a `VectorDistance()` SQL query
6. **Display results** — Show ranked results with similarity scores and RU cost (request units consumed)

### 2.2 Data Source — Shared JSON File

**File:** `../data/HotelsData_toCosmosDB_Vector.json` (shared across all 5 quickstart samples)

**Structure:**
- Array of hotel document objects
- Each document MUST include:
  - `HotelId` (used as MultiHash partition key value)
  - Text fields (description, name, etc.)
  - `DescriptionVector` field containing pre-computed embedding (array of floats, 1536 dimensions by default)

**Rationale:** Using a shared data file ensures all samples demonstrate identical results and behavior—same documents, same embeddings, same vector index structure. Avoids language-specific variations in data loading or embedding generation.

### 2.3 Algorithm Selection

**Rule:** Quickstart samples MUST support BOTH vector algorithms and allow runtime selection:

- **DiskANN** — Large-scale datasets, high recall with low latency
  - Container name: `hotels_diskann` (hardcoded, parameterized from environment variable)
  - Index type: DiskANN
  - Use case: Production-grade similarity search

- **QuantizedFlat** — Smaller datasets, simpler indexing
  - Container name: `hotels_quantizedflat` (hardcoded, parameterized from environment variable)
  - Index type: QuantizedFlat
  - Use case: Quick prototyping, small datasets

**Runtime Selection:**
- Environment variable: `VECTOR_ALGORITHM` (default: `diskann`)
- Valid values: `diskann`, `quantizedflat` (case-insensitive, trimmed)
- Invalid values must fail IMMEDIATELY with clear error message listing valid options

---

## III. Authentication & Client Initialization

### 3.1 Passwordless Authentication (Primary)

**Rule:** All quickstart samples MUST attempt passwordless authentication first using `DefaultAzureCredential`:

**For Cosmos DB:**
- Use SDK's credential provider with `DefaultAzureCredential` (or language equivalent)
- Automatically tries: managed identity, Azure CLI credentials, Visual Studio credentials, etc.
- Works in Azure (production) and local development (with `az login`)

**For Azure OpenAI:**
- Use SDK's token provider with `DefaultAzureCredential` and token provider pattern (language-specific)
- Scope: `https://cognitiveservices.azure.com/.default`

**Rationale:** Passwordless auth aligns with security best practices and avoids embedding credentials in configuration files.

### 3.2 Key-Based Fallback (Development/Testing)

**Rule:** If passwordless auth fails, fall back to key-based authentication using environment variables.

**For Cosmos DB:**
- Environment variables: `AZURE_COSMOSDB_ENDPOINT`, `AZURE_COSMOSDB_KEY`
- Fallback pattern: Try passwordless first, then check for these variables, return None/null if both fail

**For Azure OpenAI:**
- Environment variables: `AZURE_OPENAI_EMBEDDING_ENDPOINT`, `AZURE_OPENAI_EMBEDDING_KEY`, `AZURE_OPENAI_EMBEDDING_API_VERSION`, `AZURE_OPENAI_EMBEDDING_MODEL`
- Fallback pattern: Try passwordless first, then check for these variables, return None/null if both fail

**Rationale:** Fallback allows local development, testing, and CI/CD scenarios where managed identity is not available.

### 3.3 Graceful Degradation

**Rule:** If EITHER Cosmos DB OR Azure OpenAI client initialization fails, the application MUST fail IMMEDIATELY with a clear error message indicating which client is missing and why.

Example:
```
ERROR: Azure OpenAI client is not configured.
Please check your environment variables:
  - AZURE_OPENAI_EMBEDDING_ENDPOINT
  - AZURE_OPENAI_EMBEDDING_API_VERSION
  - AZURE_OPENAI_EMBEDDING_MODEL

And either:
  - Run 'az login' for passwordless authentication
  - OR provide AZURE_OPENAI_EMBEDDING_KEY for key-based auth
```

---

## IV. Environment Variable Requirements & Validation

### 4.1 Data Plane Variables

**Optional but recommended (have sensible defaults):**

| Variable | Default | Purpose | Example |
|----------|---------|---------|---------|
| `AZURE_COSMOSDB_DATABASENAME` | `Hotels` | Database name | `Hotels` |
| `VECTOR_ALGORITHM` | `diskann` | Algorithm: diskann or quantizedflat | `diskann` |
| `DATA_FILE_WITH_VECTORS` | `../data/HotelsData_toCosmosDB_Vector.json` | Path to embedding data | `./data/HotelsData_toCosmosDB_Vector.json` |
| `EMBEDDED_FIELD` | `DescriptionVector` | Field name containing vector embeddings | `DescriptionVector` |
| `EMBEDDING_DIMENSIONS` | `1536` | Number of dimensions in vector | `1536` |
| `VECTOR_DISTANCE_FUNCTION` | `cosine` | Distance metric: cosine, euclidean, dotproduct | `cosine` |
| `AZURE_OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model deployment name | `text-embedding-3-small` |

### 4.2 Validation Timing

**Rule:** All configuration MUST be validated upfront before ANY client operations or business logic executes.

**Validation Checks:**
1. ✅ Cosmos DB endpoint is provided and non-empty
2. ✅ Azure OpenAI endpoint is provided and non-empty
3. ✅ Azure OpenAI API version is provided and non-empty
4. ✅ Azure OpenAI embedding model deployment name is provided and non-empty
5. ✅ Database name is provided and non-empty (or use default)
6. ✅ Algorithm is valid (diskann or quantizedflat)
7. ✅ Data file exists and is readable
8. ✅ Embedded field name is provided and non-empty

**Failure Behavior:** If ANY validation fails, print clear error message and exit with non-zero code. Do NOT attempt to continue or work around missing configuration.

---

## V. Code Patterns & Structure

### 5.1 Configuration Module

**Rule:** Every quickstart sample MUST have a configuration module that:
1. Reads all environment variables
2. Applies defaults where appropriate
3. Validates all configuration upfront
4. Returns a configuration object/dict/map that is passed to the main workflow

**Rationale:** Centralizes configuration logic, ensures validation happens once, makes testing easier.

**Example interface (language-agnostic):**

```
Config {
  database_name: str
  algorithm: str  // validated to diskann or quantizedflat
  data_file: str  // validated for existence
  embedded_field: str
  embedding_dimensions: int
  distance_function: str  // validated to cosine, euclidean, dotproduct
  azure_openai_deployment: str
  azure_openai_api_version: str
  azure_cosmosdb_endpoint: str
}
```

### 5.2 Client Initialization Module

**Rule:** Every quickstart sample MUST have a separate client initialization module that:
1. Attempts passwordless auth first
2. Falls back to key-based auth if passwordless fails
3. Returns a client object or dict with both Cosmos DB and Azure OpenAI clients
4. Allows caller to check if each client is None/null and handle gracefully

**Rationale:** Separates authentication concerns from business logic, makes fallback logic reusable across samples.

### 5.3 Data Loading & Bulk Insert

**Rule:** Data loading MUST:
1. Read JSON data file containing documents with pre-computed embeddings
2. Validate that documents contain required fields (HotelId, embedding field)
3. Use language SDK's bulk insert API when available (Java, .NET, Python) or batch operations
4. Track and report Request Units (RU) consumed during insert
5. Print progress/status to user (e.g., "Inserted 20 documents, 1250 RU consumed")

**Rationale:** Bulk operations are more efficient than single inserts; RU tracking teaches developers about Azure Cosmos DB cost model.

### 5.4 Query Execution & Results Display

**Rule:** Query execution MUST:
1. Generate an embedding for the search query via Azure OpenAI (same model used for data embeddings)
2. Execute a `VectorDistance()` SQL query with configurable distance function
3. Include ORDER BY and TOP clauses to get ranked results
4. Return similarity scores and RU cost
5. Display results in human-readable format with ranks

**Example SQL pattern:**
```sql
SELECT 
  TOP 3 
  c.id, 
  c.name, 
  c.description, 
  VectorDistance(c.DescriptionVector, @queryVector) AS distance
FROM c
ORDER BY VectorDistance(c.DescriptionVector, @queryVector)
```

**Result Display:** Show document ranking, distance/similarity score, and total RU cost for query execution.

### 5.5 Field Name Validation (Injection Safety)

**Rule:** Any field name that comes from configuration or user input MUST be validated against a whitelist before being interpolated into SQL queries.

**Validation:**
- Field name must match pattern: `[a-zA-Z_][a-zA-Z0-9_]*` (alphanumeric + underscore, starts with letter or underscore)
- Reject any field name containing special characters, spaces, SQL keywords

**Rationale:** Prevents SQL injection via field name interpolation.

**Example:**
```python
def validate_field_name(field_name: str) -> bool:
    """Ensure field name is safe for SQL interpolation."""
    if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", field_name):
        raise ValueError(f"Invalid field name: {field_name}")
    return True
```

---

## VI. Shared Resources

### 6.1 Data File Location & Format

**File:** `/data/HotelsData_toCosmosDB_Vector.json` (relative to repo root)

**Shared across:** All 5 quickstart samples (Python, TypeScript, Java, Go, .NET)

**Format:**
```json
[
  {
    "HotelId": "3",
    "name": "Relaxation Hotel",
    "description": "A serene retreat focusing on spa and wellness amenities...",
    "DescriptionVector": [0.0123, 0.0456, ..., 0.9999]  // 1536 dimensions
  },
  ...
]
```

**Rationale:** Shared data ensures all samples produce identical query results and demonstrates cross-language consistency.

### 6.2 Container Names & Partition Key

**Container 1 — DiskANN:**
- Name: `hotels_diskann`
- Partition key: `/HotelId` (MultiHash)
- Vector index policy: DiskANN
- Configured by: CREATE-INDEX samples OR Azure Portal

**Container 2 — QuantizedFlat:**
- Name: `hotels_quantizedflat`
- Partition key: `/HotelId` (MultiHash)
- Vector index policy: QuantizedFlat
- Configured by: CREATE-INDEX samples OR Azure Portal

**Rationale:** Quickstart samples assume containers pre-exist; they only perform data plane operations (insert, query).

---

## VII. README Documentation

### 7.1 Required Sections

Every quickstart sample README MUST include:

1. **Overview/Description** — What this quickstart demonstrates, who it's for
2. **Features list** — Key capabilities (passwordless auth, bulk insert, vector search, etc.)
3. **Prerequisites** — Required tools, SDK versions, Azure services, containers that must exist
4. **Architecture diagram or narrative** — How components connect (App → Cosmos DB, App → OpenAI)
5. **Getting Started** — Step-by-step instructions to configure and run
6. **Vector Search Algorithms** — Explanation of DiskANN vs QuantizedFlat with table
7. **Distance Functions** — Explanation of cosine, euclidean, dotproduct with examples
8. **Environment Variables** — Complete list of variables, defaults, fallback behavior
9. **Project Structure** — File/directory layout with brief explanations
10. **Running the Sample** — Command syntax for different algorithms
11. **Understanding Results** — How to interpret output (RU cost, distance scores, etc.)
12. **Troubleshooting** — Common errors and solutions
13. **Resources** — Links to Azure Cosmos DB docs, vector search overview, language SDK docs

### 7.2 Configuration Documentation

READMEs MUST clearly document:
1. That containers must be pre-provisioned (reference CREATE-INDEX samples if needed)
2. That passwordless auth is preferred (managed identity in Azure)
3. How to set environment variables (copy `sample.env` to `.env`, use language-specific setup)
4. Fallback to key-based auth and required keys
5. How to select vector algorithm at runtime
6. How to customize distance function

---

## VIII. Testing & Validation

### 8.1 End-to-End Test Requirements

**Rule:** All 5 quickstart samples MUST be executed end-to-end and validated to:

1. ✅ Successfully connect to Cosmos DB using passwordless auth (when infrastructure supports it)
2. ✅ Successfully connect to Azure OpenAI using passwordless auth
3. ✅ Load all documents from shared data file without errors
4. ✅ Bulk-insert documents into the selected container
5. ✅ Generate query embedding via Azure OpenAI API call
6. ✅ Execute VectorDistance() query and get top-k results
7. ✅ Display results with scores and RU cost
8. ✅ Exit with code 0 (success)

**Failure Criteria:**
- Non-zero exit code
- Missing or empty output
- SQL errors
- Network timeouts
- Authentication failures

### 8.2 Cross-Language Consistency Testing

**Rule:** When running all 5 samples against the same data and query, they MUST:
- Insert the same set of documents
- Produce the same ranked result order
- Report similar RU costs (accounting for language SDK overhead)
- Display identical hotel recommendations

**Rationale:** Proves implementations are equivalent and interchangeable.

---

## IX. Version Pinning & Dependencies

### 9.1 SDK Version Requirements

**Cosmos DB SDKs:**
- Python: `azure-cosmos >= 4.0.0`
- TypeScript/Node.js: `@azure/cosmos >= 3.0.0`
- Java: `com.azure:azure-cosmos >= 4.0.0`
- Go: `github.com/Azure/azure-sdk-for-go/sdk/data/azcosmos >= 0.3.0`
- .NET: `Azure.Cosmos >= 3.0.0`

**Azure OpenAI SDKs:**
- Python: `openai >= 1.0.0`
- TypeScript/Node.js: `@azure/openai >= 1.0.0`
- Java: `com.azure:azure-ai-openai >= 1.0.0-beta.3`
- Go: `github.com/Azure/azure-sdk-for-go/sdk/ai/azopenai >= 0.1.0`
- .NET: `Azure.AI.OpenAI >= 1.0.0`

**Authentication SDKs:**
- Python: `azure-identity >= 1.13.0`
- TypeScript/Node.js: `@azure/identity >= 3.0.0`
- Java: `com.azure:azure-identity >= 1.9.0`
- Go: `github.com/Azure/azure-sdk-for-go/sdk/azidentity >= 1.3.0`
- .NET: `Azure.Identity >= 1.9.0`

**Rationale:** Ensures all samples use compatible versions and benefit from latest security patches.

---

## X. Reference Implementation Authority

### 10.1 Go as Reference for Patterns

The **Go quickstart sample** (`nosql-vector-search-go`) serves as the reference implementation for:
- Configuration validation patterns
- Error messaging and diagnostic output
- Client initialization logic
- Bulk insert operation patterns
- Query execution and result formatting

**Usage:** If implementation details are ambiguous, refer to the Go sample for the authoritative pattern.

---

## XI. Governance & Future Changes

### 11.1 Change Control

Any changes to quickstart samples that affect:
- Configuration requirements (new env vars, removal of vars)
- Algorithm support or container names
- Authentication patterns
- Data format or shared data file structure
- Bulk insert or query patterns

MUST update this constitution AND all 5 sample implementations in the same commit/PR.

### 11.2 Addition of New Samples

If a new language is added to the quickstart suite:
1. Use this constitution as the specification
2. Follow the Go reference implementation patterns
3. Include all required README sections
4. Add to the managed identity testing requirement (Section VII)
5. Update this constitution to reference the new sample count (currently 5)

---

## XII. Appendix: Sample Checklist

Use this checklist when creating or maintaining a quickstart sample:

**Configuration & Validation:**
- [ ] Configuration module reads all environment variables
- [ ] All configuration validated upfront before client initialization
- [ ] Sensible defaults provided for optional variables
- [ ] Clear error messages for missing/invalid configuration

**Authentication:**
- [ ] Passwordless auth attempted first via DefaultAzureCredential
- [ ] Falls back to key-based auth with required env vars
- [ ] Graceful failure if both methods unavailable

**Data Plane Workflow:**
- [ ] Loads shared JSON data file from `../data/HotelsData_toCosmosDB_Vector.json`
- [ ] Validates documents contain required fields (HotelId, embedding field)
- [ ] Bulk-inserts into selected container (DiskANN or QuantizedFlat)
- [ ] Tracks and reports RU consumed during insert
- [ ] Generates query embedding via Azure OpenAI
- [ ] Executes VectorDistance() SQL query with configurable distance function
- [ ] Displays ranked results with scores and RU cost

**Code Quality:**
- [ ] Field names validated before SQL interpolation (injection safety)
- [ ] All algorithm and distance function values validated upfront
- [ ] Clear error messages for any failures
- [ ] Exit with code 0 on success, non-zero on failure

**Documentation:**
- [ ] README includes all required sections
- [ ] Environment variables documented with defaults
- [ ] Getting Started section is clear and actionable
- [ ] Containers described as pre-provisioned (not created by sample)
- [ ] References to CREATE-INDEX samples for provisioning guidance
- [ ] Links to relevant Azure SDK and Cosmos DB documentation

**Testing:**
- [ ] Sample executes end-to-end without errors
- [ ] Produces same results as other language samples
- [ ] Handles missing environment variables gracefully
- [ ] Handles invalid algorithm/distance function values gracefully
