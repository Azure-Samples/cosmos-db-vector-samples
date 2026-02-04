# GitHub Copilot Instructions for Azure Cosmos DB Vector Samples

## Authentication and Authorization

This repository uses **Microsoft Entra ID (formerly Azure AD)** authentication with data plane RBAC only.

### Key Principles

1. **Infrastructure Setup**: The Azure Developer CLI (`azd`) creates the database and container resources using the local developer's identity during provisioning. Sample code should never create these resources.

2. **Data Plane Only**: The RBAC roles assigned in the infrastructure are configured for **data plane operations only** (reading and writing documents). Management plane operations (creating databases, containers, or checking if they exist) are NOT supported.

3. **No Resource Creation in Code**: Sample code must NOT:
   - Create databases or containers using `createIfNotExists`
   - Check if databases or containers exist
   - Attempt any management plane operations
   - Use management plane SDKs or APIs

4. **Assume Resources Exist**: All sample code should assume that:
   - The database already exists
   - The container already exists
   - The connection has been properly configured via environment variables
   - The user's identity has been granted appropriate data plane permissions

### Code Guidelines

#### ✅ DO:
- Use data plane SDKs for document operations (CRUD)
- Access existing databases and containers directly
- Use `database.container(containerName)` to get a container reference
- Implement proper error handling for permission issues
- Guide users to create resources manually if they don't exist

#### ❌ DON'T:
- Use `createIfNotExists()` for databases or containers
- Call management plane APIs
- Attempt to validate resource existence
- Create, delete, or modify container/database definitions
- Use management plane SDKs

### Example Pattern

```typescript
// ❌ WRONG - Don't create or check existence
const { database } = await client.databases.createIfNotExists({ id: dbName });
const { container } = await database.containers.createIfNotExists({ id: containerName });

// ✅ CORRECT - Assume resources exist
const database = client.database(dbName);
const container = database.container(containerName);

// Proceed with data plane operations
const result = await container.items.create(document);
```

### Error Handling

When a resource doesn't exist, provide clear error messages directing users to:
1. Verify the database and container names in their environment configuration
2. Ensure resources were created via Azure Developer CLI or Azure Portal
3. Check their Entra ID identity has proper data plane RBAC roles assigned

### Reference Documentation

For more information on management plane vs. data plane access in Azure Cosmos DB:
- [Azure Cosmos DB security overview](https://learn.microsoft.com/azure/cosmos-db/security)
- [Azure Cosmos DB role-based access control](https://learn.microsoft.com/azure/cosmos-db/role-based-access-control)
- [Configure role-based access control with Microsoft Entra ID for your Azure Cosmos DB account](https://learn.microsoft.com/azure/cosmos-db/how-to-setup-rbac)

---

## Azure Cosmos DB Vector Search Specific Instructions

These instructions apply to Azure Cosmos DB Vector Search example prompts and are based on PR review feedback from the Azure Cosmos DB team.

### Terminology Requirements

#### Embedding Field Naming
Use generic terms like "vector" or "embedding" instead of service-specific model names such as `text_embedding_ada_002`.

- ✅ CORRECT: "Use the embedding field named `vector` or `embedding`."
- ❌ WRONG: "Use the embedding field named `text_embedding_ada_002`."

#### Client Naming
Refer explicitly to the service as "Azure OpenAI client" rather than just "OpenAI client" to avoid confusion.

- ✅ CORRECT: "Azure OpenAI client is not configured properly."
- ❌ WRONG: "OpenAI client is not configured properly."

#### Algorithm Descriptions
Describe QuantizedFlat as using vector quantization techniques, distinct from DiskANN which is graph-based.

- ✅ CORRECT: "QuantizedFlat uses vector quantization techniques."
- ❌ WRONG: "QuantizedFlat is based on DiskANN research."

#### Performance and Usage Descriptions for Flat Algorithm
- Emphasize that Flat is only suitable for testing or very small scenarios with small dimensional vectors.
- Recommend using QuantizedFlat or DiskANN for general use.
- Use terms like "optimized for low latency, highly scalable workloads" and "efficient RU consumption at scale."
- Use "high recall" instead of "~100% recall."
- Indicate Flat is best for scenarios with up to ~50,000 vectors and isolated partition searches.

- ✅ CORRECT: "Flat is best for test or very small scenarios with small dimensional vectors. For production, use QuantizedFlat or DiskANN."
- ✅ CORRECT: "Optimized for low latency, highly scalable workloads."
- ✅ CORRECT: "Efficient RU consumption at scale."
- ✅ CORRECT: "High recall, not ~100%."
- ✅ CORRECT: "Best for scenarios with up to 50,000 vectors and isolated partition searches."
- ❌ WRONG: "Flat is recommended for general use."
- ❌ WRONG: "Efficient memory usage."
- ❌ WRONG: "Say ~100% recall."

### Service-Specific Distinctions

#### Cosmos DB SQL Query Syntax for Vector Search
- Parameter placeholders (e.g., `@embeddedField`) **cannot** be used to dynamically reference field names in Cosmos DB SQL queries.
- Field names must be hardcoded in the query string or injected via string interpolation before query execution.
- Use template literals or hardcoded field names like `c.vector` or `c.embedding` in the query.
- This is a critical technical limitation due to Cosmos DB NoSQL API syntax.

- ✅ CORRECT:
  ```js
  query: `SELECT TOP 5 c.HotelName, c.Description, c.Rating, VectorDistance(c.${embeddedField}, @embedding) AS SimilarityScore FROM c ORDER BY VectorDistance(c.${embeddedField}, @embedding)`
  ```
- ❌ WRONG:
  ```sql
  SELECT TOP 5 c.HotelName, c.Description, c.Rating, VectorDistance(c[@embeddedField], @embedding) AS SimilarityScore FROM c ORDER BY VectorDistance(c[@embeddedField], @embedding)
  ```

#### SQL Injection and Query Construction Safety
- Since the embedded field name is injected via string interpolation, validate it strictly to prevent SQL injection.
- Validate that the embedded field name matches a simple identifier pattern: `/^[A-Za-z_][A-Za-z0-9_]*$/`.
- Document that this pattern is acceptable only for demo/sample code where the field name is controlled via environment variables.
- Warn that user-supplied input should never be used directly in this way in production.

- ✅ CORRECT:
  ```js
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(embeddedField)) {
      throw new Error(`Invalid embedded field name: ${embeddedField}`);
  }
  ```
- ❌ WRONG: No validation of embedded field name before query construction.

### Naming Conventions

#### Embedding Field Name
- Use generic names like `vector` or `embedding` instead of model-specific names.
- Avoid names tied to specific embedding models such as `text_embedding_ada_002`.

#### Resource and Variable Naming
- Use clear, conventional variable names (e.g., `containerDefinition` instead of `containerdef`).
- Remove unused variables to avoid confusion.

### Parameter Usage

#### Embedded Field Parameter
- The embedded field name should be treated as a configuration/environment variable, not a query parameter.
- It must be injected into the query string before execution, not passed as a SQL parameter.

### Prompt Structure Guidelines

#### Preferred Prompt Patterns for Cosmos DB Vector Search

**For querying vectors:**
- "Show me the top 5 hotels similar to this vector using the embedding field `vector`."
- "Find documents ordered by similarity score computed with `VectorDistance` on the `embedding` field."
- "Use the Azure OpenAI client to generate embeddings and query Cosmos DB with validated embedded field names."

### Example Corrections from PR Review

| Original | Corrected |
|----------|-----------|
| `VectorDistance(c[@embeddedField], @embedding)` | `VectorDistance(c.${embeddedField}, @embedding)` |
| `throw new Error('OpenAI client is not configured properly.')` | `throw new Error('Azure OpenAI client is not configured properly. Please check your environment variables.')` |
| `text_embedding_ada_002` | `vector` or `embedding` |
| `QuantizedFlat is based on DiskANN research` | `QuantizedFlat uses vector quantization techniques` |
| `Efficient memory usage` | `Efficient RU consumption at scale` |
| `~100% recall` | `High recall` |
| `Flat is recommended for general use` | `Flat is only for test or very small scenarios; use QuantizedFlat or DiskANN for production` |
| `containerdef` (unused variable) | Remove or rename to `containerDefinition` if used |

### Notes

- The SQL query syntax limitation and injection risk are HIGH confidence rules due to multiple repeated comments with code suggestions.
- Embedding field renaming is HIGH confidence due to multiple repeated reviewer requests.
- Algorithm descriptions and usage recommendations are HIGH confidence based on multiple comments from the same reviewer.
- Client naming corrections are MEDIUM confidence but important for clarity.
- Variable naming and unused variable removal are LOW confidence but recommended for code clarity.
