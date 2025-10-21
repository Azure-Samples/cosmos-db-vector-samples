# Enhanced Utils.ts - Complete Vector Search Solution

This enhanced `utils.ts` file provides a comprehensive set of utilities for MongoDB vector search operations with Azure Cosmos DB. All insert and search functionality is now contained within the utils file, making it a one-stop solution for vector search operations.

## New Features Added

### Core Functionality
- **Complete Vector Search Workflow**: High-level function that handles the entire process from setup to search
- **Individual Vector Operations**: Granular functions for specific operations
- **Multiple Index Types**: Support for IVF, HNSW, and DiskANN vector indexes
- **Type Safety**: Full TypeScript support with proper type definitions

### Key Functions

#### High-Level Functions

1. **`completeVectorSearchWorkflow()`**
   - Handles the entire workflow: collection setup, data insertion, index creation, and search
   - Parameters: config, vectorIndexConfig, query, data, usePasswordless, k
   - Returns: insertSummary, vectorIndexSummary, searchResults

#### Vector Index Functions

2. **`createVectorIndex()`**
   - Creates a vector index on a MongoDB collection
   - Supports all vector index types (IVF, HNSW, DiskANN)

3. **`performVectorSearch()`**
   - Performs vector similarity search using AI embeddings
   - Returns search results with scores

#### Index Configuration Helpers

4. **`createIVFIndexConfig()`**
   - Creates IVF (Inverted File) index configuration
   - Parameters: dimensions, numLists, similarity

5. **`createHNSWIndexConfig()`**
   - Creates HNSW (Hierarchical Navigable Small World) index configuration
   - Parameters: dimensions, m, efConstruction, similarity

6. **`createDiskANNIndexConfig()`**
   - Creates DiskANN index configuration
   - Parameters: dimensions, maxDegree, lBuild, similarity

### Type Definitions

```typescript
export type VectorIndexType = 'vector-ivf' | 'vector-hnsw' | 'vector-diskann';

export interface SearchConfig {
    dbName: string;
    collectionName: string;
    indexName: string;
    embeddedField: string;
    embeddingDimensions: number;
    deployment: string;
    batchSize?: number;
    dataFile?: string;
}
```

## Usage Examples

### Example 1: Complete Workflow (Recommended)

```typescript
import { 
    completeVectorSearchWorkflow,
    createHNSWIndexConfig,
    SearchConfig
} from './utils.js';

const config: SearchConfig = {
    dbName: "Hotels",
    collectionName: "hotels_collection",
    indexName: "vectorIndex",
    embeddedField: "contentVector",
    embeddingDimensions: 1536,
    deployment: "text-embedding-ada-002"
};

const query = "luxury hotel with spa";
const indexConfig = createHNSWIndexConfig(1536, 16, 64, 'COS');

const { searchResults } = await completeVectorSearchWorkflow(
    config,
    indexConfig,
    query,
    data, // Optional: pass data to insert
    false, // usePasswordless
    5 // number of results
);
```

### Example 2: Step-by-Step Workflow

```typescript
import { 
    getClients,
    createVectorIndex,
    performVectorSearch,
    createIVFIndexConfig
} from './utils.js';

const { aiClient, dbClient } = getClients();
await dbClient.connect();

const db = dbClient.db("Hotels");
const collection = await db.createCollection("hotels");

// Create index
const indexConfig = createIVFIndexConfig(1536, 10, 'COS');
await createVectorIndex(db, config, indexConfig);

// Perform search
const results = await performVectorSearch(
    aiClient, 
    collection, 
    "beachfront resort", 
    config, 
    5
);
```

## Vector Index Types

### IVF (Inverted File)
- **Best for**: Large datasets with batch queries
- **Parameters**: numLists (partitions for data organization)
- **Use case**: High-throughput scenarios

### HNSW (Hierarchical Navigable Small World)
- **Best for**: Real-time queries with high accuracy
- **Parameters**: m (connections per layer), efConstruction (build quality)
- **Use case**: Interactive applications

### DiskANN (Disk-based Approximate Nearest Neighbor)
- **Best for**: Very large datasets that don't fit in memory
- **Parameters**: maxDegree (graph connectivity), lBuild (build parameter)
- **Use case**: Massive scale deployments

## Environment Variables Required

```bash
AZURE_OPENAI_EMBEDDING_KEY=your_api_key
AZURE_OPENAI_EMBEDDING_API_VERSION=2023-05-15
AZURE_OPENAI_EMBEDDING_ENDPOINT=your_endpoint
AZURE_OPENAI_EMBEDDING_MODEL=text-embedding-ada-002
MONGO_CONNECTION_STRING=your_connection_string
EMBEDDED_FIELD=contentVector
EMBEDDING_DIMENSIONS=1536
DATA_FILE_WITH_VECTORS=data/hotels_with_vectors.json
LOAD_SIZE_BATCH=100
```

## Migration from Previous Version

The enhanced utils.ts is backward compatible. Existing code will continue to work, but you can now use the new high-level functions for simpler implementations:

**Before:**
```typescript
// Multiple files with repeated setup code
const { aiClient, dbClient } = getClients();
// ... manual connection, collection creation, index creation, search ...
```

**After:**
```typescript
// Single function call
const results = await completeVectorSearchWorkflow(config, indexConfig, query, data);
```

## Error Handling

All functions include comprehensive error handling and will throw descriptive errors for:
- Missing environment variables
- Database connection issues
- Index creation failures
- Search operation errors

## Performance Considerations

- Use appropriate batch sizes for data insertion (default: 100)
- Choose the right vector index type for your use case
- Consider using passwordless authentication for production
- Monitor memory usage with large datasets

## Running Examples

```bash
npm run build
npm run start:example    # Run example-usage.ts
npm run start:ivf        # Run simplified IVF example
npm run start:hnsw       # Run HNSW example
npm run start:diskann    # Run DiskANN example
```