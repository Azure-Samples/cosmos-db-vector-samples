---
applyTo: "nosql-*/**"
---
# Terminology & PR Review Standards — Cosmos DB NoSQL Vector Search

This file captures correct terminology and common review feedback patterns for `nosql-vector-search-*` samples. Apply these rules when writing, reviewing, or editing sample code and documentation.

## Terminology — Use These Exact Phrasings

### Embedding Field Naming

| ✅ Correct | ❌ Wrong | Rule |
|-----------|---------|------|
| `DescriptionVector` | `text_embedding_ada_002` | Use generic field names — NOT model-specific names |
| `vector` | `ada_embedding` | Field names must not encode the model that produced them |
| `embedding` | `text-embedding-3-small-vector` | Model names change; field names are schema-permanent |

The embedding field name is part of the container schema. Using model-specific names creates schema drift when models are upgraded.

### Client Naming

| ✅ Correct | ❌ Wrong |
|-----------|---------|
| Azure OpenAI client | OpenAI client |
| Azure OpenAI embedding | OpenAI embedding |

Always qualify with "Azure" — these samples use Azure OpenAI endpoints, not the public OpenAI API.

### Algorithm Descriptions

| Algorithm | ✅ Correct Description | ❌ Wrong Description |
|-----------|----------------------|---------------------|
| `quantizedFlat` | "uses vector quantization techniques" | "based on DiskANN research" |
| `diskANN` | "graph-based index optimized for large-scale vector search" | — |
| `Flat` | "only for test or very small scenarios with small dimensional vectors" | (do not present as a production option) |

For production recommendations: direct users to `quantizedFlat` or `diskANN`. Never present `Flat` as a general-purpose option.

### Recall Accuracy

| ✅ Correct | ❌ Wrong |
|-----------|---------|
| "High recall" | "~100% recall" |
| "Efficient RU consumption at scale" | "efficient memory usage" |

Cosmos DB NoSQL billing is RU-based, not memory-based. Recall guarantees should not be stated as specific percentages.

## SQL Query — Field Name Injection

Vector field names in SQL queries CANNOT use parameter placeholders. `@embeddedField` is not valid for column/field references in Cosmos DB NoSQL SQL.

### ✅ Correct: String interpolation with validation

```typescript
const SAFE_FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function buildVectorQuery(embeddedField: string): string {
  if (!SAFE_FIELD_NAME.test(embeddedField)) {
    throw new Error(`Invalid field name: ${embeddedField}`);
  }
  return `
    SELECT TOP 5
      c.HotelName, c.Description, c.Rating,
      VectorDistance(c.${embeddedField}, @embedding) AS SimilarityScore
    FROM c
    ORDER BY VectorDistance(c.${embeddedField}, @embedding)
  `;
}
```

### ❌ Wrong: Parameter placeholder for field name

```sql
-- This is NOT valid Cosmos DB NoSQL SQL
SELECT TOP 5 VectorDistance(c.@embeddedField, @embedding) FROM c
```

Always validate the field name against `/^[A-Za-z_][A-Za-z0-9_]*$/` before interpolation to prevent SQL injection.

## Code Review Checklist

### Authentication
- [ ] Uses `DefaultAzureCredential` — NOT connection strings, account keys, or hardcoded credentials
- [ ] No `AccountKey` or `PrimaryKey` references in sample code
- [ ] `CosmosClient` initialized with credential, not connection string

### Container Access
- [ ] Uses `database.container(containerName)` directly
- [ ] Does NOT call `containers.createIfNotExists()`
- [ ] Does NOT call `containers.create()`
- [ ] Does NOT drop or delete containers

### Vector Search
- [ ] Uses `VectorDistance()` SQL function
- [ ] Does NOT use `$search`, `cosmosSearch`, or MongoDB aggregation pipeline
- [ ] Field name injection validated against `/^[A-Za-z_][A-Za-z0-9_]*$/` if field is configurable
- [ ] Query result includes `HotelName`, `Description`, `Rating`, `SimilarityScore`

### Naming
- [ ] Embedding field is `DescriptionVector` or another generic name — NOT model-specific
- [ ] Client variable is named to reflect "Azure OpenAI" (e.g., `azureOpenAIClient`, not `openaiClient`)
- [ ] Container definition variable: use `containerDefinition` not `containerdef`
- [ ] No unused variable declarations

### Algorithms
- [ ] Only `quantizedFlat` and `diskANN` used in production paths
- [ ] `Flat` algorithm marked as test-only if present
- [ ] No references to IVF, HNSW, or other unsupported algorithms

### Bulk Insert
- [ ] TypeScript / Java / .NET: uses `executeBulkOperations()`
- [ ] Python: uses `container.upsert_item()` in a loop
- [ ] Go: uses item-by-item insert

## Common PR Feedback Patterns

| Feedback | Action Required |
|----------|----------------|
| "Field name is model-specific" | Rename to `DescriptionVector` or `vector` |
| "Should say 'Azure OpenAI client'" | Update variable names and comments |
| "quantizedFlat description is wrong" | Change to "uses vector quantization techniques" |
| "Flat algorithm shouldn't be listed for production" | Add caveat: test/very small scenarios only |
| "Don't use '~100% recall'" | Change to "high recall" |
| "Memory usage is wrong metric" | Change to "efficient RU consumption at scale" |
| "`@embeddedField` is not valid SQL" | Use string interpolation with regex validation |
| "`containerdef` should be `containerDefinition`" | Rename variable |
| "Remove unused variable" | Delete the unused declaration |
| "`createIfNotExists` should not be called" | Replace with `database.container(name)` |
