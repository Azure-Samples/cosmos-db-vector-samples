---
applyTo: "nosql-*/**"
---
# Execution Patterns — Cosmos DB NoSQL Vector Search Samples

## Two-Phase Execution Model

Cosmos DB NoSQL vector samples use an **infra-first** pattern. Infrastructure and application code have completely separate responsibilities.

### Phase 1: Infrastructure Deployment (`azd up`)

Handled entirely by Bicep/ARM templates. The application code NEVER performs any of these steps:

| Step | What Happens | Immutable? |
|------|-------------|-----------|
| 1. Create Cosmos DB account | Serverless, `disableKeyBasedAuth: true` | Account settings mutable |
| 2. Create database | `Hotels` database for all containers | — |
| 3. Create containers | `hotels_diskann`, `hotels_quantizedflat` with partition key `/HotelId` | Container name immutable |
| 4. Set vector embedding policy | `/DescriptionVector`, `float32`, 1536 dims, `cosine` per container | **YES — immutable** |
| 5. Create vector index | Algorithm-specific index matching embedding policy | **YES — immutable** |
| 6. Assign RBAC | Custom role "Write to Azure Cosmos DB for NoSQL data plane" with specific data actions (defined in Bicep) | — |

**Critical:** Once a container's vector embedding policy is set, it CANNOT be changed. Containers are infrastructure — not disposable resources.

### Phase 2: Application Runtime

The application code performs data-plane operations only:

| Step | Operation | Notes |
|------|-----------|-------|
| 1. Initialize clients | `DefaultAzureCredential` → `CosmosClient` + Azure OpenAI client | Prefer passwordless auth |
| 2. Get database reference | Connect to existing `Hotels` database | Assume exists — never create |
| 3. Get container reference | `database.container(containerName)` by algorithm name | Never use `createIfNotExists()` |
| 4. Load hotel data | Read `HotelsData_toCosmosDB_Vector.json`, bulk insert | `executeBulkOperations()` (TS/Java/.NET), `container.upsert_item()` in a loop (Python), item-by-item insert (Go) |
| 5. Generate query embedding | Azure OpenAI embedding call | Generic — any compatible model |
| 6. Execute vector search | `VectorDistance()` SQL query | NOT `$search` or `cosmosSearch` |
| 7. Print results | `HotelName`, `Description`, `Rating`, `SimilarityScore` | — |
| 8. Clean up documents | Remove documents inserted during the run | Use existing `delete:all` scripts; containers/indexes are immutable infrastructure and are never deleted |

## Authentication Flow

```
Application starts
  → DefaultAzureCredential obtains token
  → Token used for Cosmos DB NoSQL data-plane endpoint
  → No token callback function needed — SDK handles refresh internally
  → Role: Custom "Write to Azure Cosmos DB for NoSQL data plane" role (defined in Bicep)
```

The code supports both key-based and passwordless auth paths. For deployed infrastructure (`disableKeyBasedAuth: true`), only the passwordless path works. New code should always use `DefaultAzureCredential`.

## Container Reference Pattern

Use `database.container(containerName)` directly. Never create or check-create containers at runtime:

```typescript
// ✅ Correct
const container = database.container("hotels_diskann");

// ❌ Wrong — never call this
const { container } = await database.containers.createIfNotExists({ id: "hotels_diskann" });
```

## Vector Search Query

All samples use the `VectorDistance()` SQL function:

```sql
SELECT TOP 5
  c.HotelName,
  c.Description,
  c.Rating,
  VectorDistance(c.DescriptionVector, @embedding) AS SimilarityScore
FROM c
ORDER BY VectorDistance(c.DescriptionVector, @embedding)
```

**NEVER use:**
- ❌ `$search` aggregation pipeline
- ❌ `cosmosSearch` operator
- ❌ `createIndexes` command at runtime
- ❌ Any MongoDB wire protocol commands

**Field name injection:** When the embedded field name is configurable (e.g., from `EMBEDDED_FIELD` env var), validate against `/^[A-Za-z_][A-Za-z0-9_]*$/` before string interpolation. SQL parameters (`@embeddedField`) cannot be used for field names.

## Container Architecture

Two containers — one per algorithm:

| Container | Algorithm | Notes |
|-----------|-----------|-------|
| `hotels_quantizedflat` | quantizedFlat | Compressed flat index; good for smaller datasets |
| `hotels_diskann` | diskANN | Graph-based; optimized for large-scale search |

**NOT available** in Cosmos DB NoSQL API:
- ❌ IVF
- ❌ HNSW
- ❌ Flat (for production — only for test/very small scenarios with small dimensional vectors; prefer quantizedFlat or diskANN)

## Vector Embedding Policy (from Bicep)

| Property | Value |
|----------|-------|
| Path | `/DescriptionVector` |
| Data type | `float32` |
| Dimensions | `1536` |
| Distance function | `cosine` |

## Data Format

- **Source file:** `HotelsData_toCosmosDB_Vector.json`
- **Vectors:** Pre-computed `DescriptionVector` field (1536 dimensions)
- **Partition key:** `/HotelId`
- **Embedding field naming:** Use generic `DescriptionVector` or `vector` — NOT model-specific names (e.g., not `text_embedding_ada_002`)

## What the Code NEVER Does

| Operation | Why Not |
|-----------|---------|
| Create containers | Vector policy is set at creation time via Bicep — immutable |
| Drop containers | Containers persist; serverless throughput implications |
| Modify vector indexes | Immutable once created |
| Use connection strings or keys (when `disableKeyBasedAuth: true`) | Passwordless auth required for deployed infra; new code should use `DefaultAzureCredential` |
| Use `createIfNotExists()` | Containers are pre-provisioned infrastructure |

## Contrast with DocumentDB Sample Execution

| DocumentDB Pattern | Cosmos DB NoSQL Pattern |
|-------------------|------------------------|
| Drop collection → create → index → insert → query → cleanup | Connect → upsert → query → print results → clean up documents |
| `createIndexes` command at runtime | Indexes exist from `azd up` |
| Single collection per run | 2 containers always present |
| `mongosh` cleanup possible | `delete:all` scripts clean up inserted documents |
| Connection string supported | Passwordless auth preferred; key-based supported but disabled in deployed infra |

## Failure Modes

| Failure | Cause | Fix |
|---------|-------|-----|
| `401 Unauthorized` | Missing RBAC role assignment | Re-run `azd up` or assign the custom "Write to Azure Cosmos DB for NoSQL data plane" role manually |
| `Container not found` | `azd up` not run or failed | Run `azd up` first |
| Duplicate key on upsert | Data already populated | Expected — upsert handles idempotently |
| Wrong vector dimensions | Embedding model mismatch | Check `EMBEDDING_DIMENSIONS` and model deployment |
| `disableKeyBasedAuth` error | Using connection string when key auth is disabled | Switch to `DefaultAzureCredential` |
