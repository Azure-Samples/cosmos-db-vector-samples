# Vector-search scenario constitution

**Effective:** August 2026

**Scope:** `nosql-vector-search-python`, `nosql-vector-search-typescript`, `nosql-vector-search-java`, `nosql-vector-search-go`, and `nosql-vector-search-dotnet`

**Authority & Extension:** This document is the scenario constitution for all `nosql-vector-search-*` quickstarts. It **extends and augments** the shared [Quickstart Base Constitution](../QUICKSTART-CONSTITUTION.md). It does not replace the Base Constitution.

---

## I. Scenario Purpose & Infrastructure Model

### 1.1 Data-Plane-Only Scope
The `nosql-vector-search-*` quickstarts demonstrate end-to-end vector similarity search for developers operating on pre-provisioned Azure Cosmos DB infrastructure.
- ✅ Assumes database (`Hotels`) and containers (`hotels_diskann`, `hotels_quantizedflat`) are pre-created via `azd up` / Bicep / Azure Portal.
- 🚫 Sample code MUST NOT perform management-plane operations, MUST NOT create databases or containers (`createIfNotExists`), and MUST NOT delete or drop containers.

### 1.2 Two-Phase Execution Model
1. **Infrastructure Phase (`azd up` / Bicep):** Account, database (`Hotels`), containers (`hotels_diskann`, `hotels_quantizedflat` with MultiHash partition key `/HotelId`), vector embedding policies (`/DescriptionVector`, 1536 dims, `cosine`), vector indexing policies (`diskANN`, `quantizedflat`), and data-plane RBAC roles are provisioned.
2. **Application Runtime Phase:** Sample initializes clients, validates config, loads data, bulk-inserts/upserts documents, generates query embeddings via Azure OpenAI, executes `VectorDistance()` SQL query, displays results with RU cost, and performs document-level cleanup (`delete_all`).

---

## II. Configuration & Algorithm Selection

### 2.1 Required & Optional Environment Variables

All `nosql-vector-search-*` samples require or support the following environment variables:

| Variable | Default | Purpose | Example |
|---|---|---|---|
| `AZURE_COSMOSDB_ENDPOINT` | Required | Cosmos DB NoSQL account endpoint | `https://myaccount.documents.azure.com:443/` |
| `AZURE_COSMOSDB_DATABASENAME` | `Hotels` | Database name | `Hotels` |
| `VECTOR_ALGORITHM` | `diskann` | Algorithm selector (`diskann` or `quantizedflat`) | `diskann` |
| `DATA_FILE_WITH_VECTORS` | `../data/HotelsData_toCosmosDB_Vector.json` | Path to JSON embedding dataset | `./data/HotelsData_toCosmosDB_Vector.json` |
| `EMBEDDED_FIELD` | `DescriptionVector` | Vector field name | `DescriptionVector` |
| `EMBEDDING_DIMENSIONS` | `1536` | Vector dimensions | `1536` |
| `VECTOR_DISTANCE_FUNCTION` | `cosine` | Distance function (`cosine`, `euclidean`, `dotproduct`) | `cosine` |
| `AZURE_OPENAI_EMBEDDING_ENDPOINT` | Required | Azure OpenAI endpoint | `https://myoai.openai.azure.com/` |
| `AZURE_OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model deployment name | `text-embedding-3-small` |
| `AZURE_OPENAI_EMBEDDING_API_VERSION` | `2024-08-01-preview` | API version | `2024-08-01-preview` |

### 2.2 Algorithm Selection & Container Mapping
Vector search samples MUST support runtime algorithm selection via `VECTOR_ALGORITHM`:
- `diskann` -> maps to pre-existing container `hotels_diskann`
- `quantizedflat` -> maps to pre-existing container `hotels_quantizedflat`

Input MUST be trimmed and case-insensitive. Invalid values MUST fail IMMEDIATELY with a clear error listing valid options (`diskann`, `quantizedflat`).

---

## III. Shared Dataset & Workflow Execution

### 3.1 Data Source — Shared JSON File
- **File:** `../data/HotelsData_toCosmosDB_Vector.json` (shared across all 5 vector search samples).
- **Structure:** Array of hotel document objects containing `HotelId` (MultiHash partition key), text metadata, and `DescriptionVector` (1536-dimensional pre-computed float array).

### 3.2 Data Loading & Bulk Insert
- Data loading MUST read the shared JSON file and validate document fields.
- Ingestion MUST use bulk insert/upsert APIs (`executeBulkOperations()` in TypeScript/Java/.NET, `container.upsert_item()` loop in Python, item-by-item insert in Go).
- Samples MUST track and report Request Units (RU) consumed during ingestion and query operations.

### 3.3 Query Execution & Output Display
- Generate query embedding via Azure OpenAI.
- Execute `VectorDistance()` SQL query against selected container.
- Display ranked search results with distance/similarity scores and total RU cost.

### 3.4 Document-Level Cleanup Safeguards
- Vector search samples MUST perform document-level cleanup only (e.g. `delete_all` scripts removing inserted documents).
- Containers, vector policies, and the database are infrastructure and MUST NOT be deleted by application code.

---

## IV. README Documentation Requirements

Every `nosql-vector-search-*` README MUST include:
1. Overview explaining data-plane-only vector search workflow.
2. Statement that containers and database are pre-provisioned via `azd up`.
3. Complete environment variable table with defaults.
4. Getting Started section with command syntax for both `diskann` and `quantizedflat`.
5. Explanation of RU cost and distance metrics.
6. Reference to `docs/CREATE-INDEX-CONSTITUTION.md` for control-plane container provisioning guidance.

---

## V. Testing & Validation Checklist

- [ ] Uses `DefaultAzureCredential` for passwordless auth.
- [ ] Connects to pre-existing `Hotels` database and `hotels_diskann`/`hotels_quantizedflat` containers.
- [ ] Does NOT call `createIfNotExists()` or delete containers.
- [ ] Loads `../data/HotelsData_toCosmosDB_Vector.json`.
- [ ] Performs bulk insert/upsert with RU tracking.
- [ ] Generates query embedding via Azure OpenAI.
- [ ] Executes `VectorDistance()` query and prints ranked results.
- [ ] Performs document-level cleanup without dropping infrastructure.
- [ ] Produces identical ranking across all 5 language implementations.
