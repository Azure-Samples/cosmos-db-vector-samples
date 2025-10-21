# IVF Search Analysis: Agent vs Vector Search Project

## Issue Summary

The IVF vector search implementation works correctly in the `mongo-vcore-vector-search-typescript` project, returning 5 relevant documents with similarity scores around 0.83-0.84. However, the same search query in the `mongo-vcore-agent-typescript` project returns 0 documents, despite both projects using the same database connection, embedding field, and query.

## Test Results

### Vector Search Project (✅ Working)
- **Database**: Hotels2
- **Collection**: hotels_ivf
- **Results**: 5 documents returned
- **Similarity Scores**: 0.8399, 0.8399, 0.8399, 0.8384, 0.8384
- **Query**: "quintessential lodging near running trails, eateries, retail"

### Agent Project (❌ Not Working)
- **Database**: Hotels4
- **Collection**: hotels_ivf
- **Results**: 0 documents returned
- **Query**: "quintessential lodging near running trails, eateries, retail"
- **Message**: "No hotels found matching your criteria"

## Root Cause Analysis

### 1. **Primary Issue: Similarity Threshold Filtering**

The agent project applies a **0.7 similarity threshold** filter that doesn't exist in the vector search project:

**Agent Project (`utils.ts`)**:
```typescript
// Filter by similarity threshold and map to proper structure
return results
    .filter(r => r.score >= similarityThreshold)  // 0.7 threshold
    .map(r => ({
        ...r.document,
        score: r.score
    }));
```

**Vector Search Project (`ivf.ts`)**:
```typescript
// No filtering - returns all results from MongoDB
const searchResults = await collection.aggregate([...]).toArray();
console.log(searchResults);
```

### 2. **Secondary Issue: Different OpenAI Client Libraries**

**Vector Search Project**:
- Uses `AzureOpenAI` from `openai/index.js` (native OpenAI client)
- Embedding generation:
  ```typescript
  const createEmbeddedForQueryResponse = await aiClient.embeddings.create({
      model: config.deployment,
      input: [config.query]
  });
  // Uses: createEmbeddedForQueryResponse.data[0].embedding
  ```

**Agent Project**:
- Uses `AzureOpenAIEmbeddings` from `@langchain/openai` (LangChain wrapper)
- Embedding generation:
  ```typescript
  const queryEmbedding = await embeddingClient.embedQuery(query);
  // Uses: queryEmbedding directly
  ```

### 3. **Configuration Differences**

**Agent Project** uses additional LangChain configuration:
```typescript
const embeddingConfig = {
    temperature: 0,
    maxTokens: 100,
    maxRetries: 2,
    azureOpenAIApiKey: process.env.AZURE_OPENAI_KEY!,
    azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_INSTANCE!,
    azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_EMBEDDING_MODEL!,
    model: process.env.AZURE_OPENAI_EMBEDDING_MODEL!,
    azureOpenAIApiVersion: process.env.AZURE_OPENAI_EMBEDDING_API_VERSION!
};
```

**Vector Search Project** uses simpler configuration:
```typescript
const aiClient = new AzureOpenAI({
    apiKey,
    apiVersion,
    endpoint,
    deployment
});
```

## Database Verification

Both projects have valid data in their respective databases:

### Hotels Database (Vector Search Project)
```
Collections in Hotels database:
  - hotels_ivf: 50 documents
    Indexes:
      - vectorIndex_ivf: {"text-embedding-ada-002":"cosmosSearch"}
        Vector index: vector-ivf (dimensions: 1536)
```

### Hotels4 Database (Agent Project)
```
Collections in Hotels4 database:
  - hotels_ivf
    Documents: 50
    Sample document keys: _id, HotelId, HotelName, Description, Description_fr, Category, Tags, ParkingIncluded, IsDeleted, LastRenovationDate, Rating, Address, Location, Rooms, text_embedding_ada_002
    Has embeddings: 1536 dimensions
```

## Environment Configuration

Both projects use identical environment settings:

```properties
EMBEDDED_FIELD=text_embedding_ada_002
EMBEDDING_DIMENSIONS=1536
AZURE_OPENAI_EMBEDDING_MODEL=text-embedding-ada-002
AZURE_OPENAI_EMBEDDING_API_VERSION=2025-01-01-preview
```

**Key Difference**: Database names
- Vector Search: `Hotels2` (hardcoded in `ivf.ts`)
- Agent: `Hotels4` (from `MONGO_DB_NAME` environment variable)

## Debugging Evidence

### Agent Project Search Output
```
🔍 Searching in collection: hotels_ivf using IVF algorithm
Collection hotels_ivf has 50 documents
✓ Found 0 results from hotels_ivf
❌ No hotels found matching your criteria.
```

### Vector Search Project Output
```
[
  {
    _id: new ObjectId('68f78496eeb8b01fd1f401b9'),
    score: 0.8399147391319275,
    document: {
      HotelId: '7',
      HotelName: 'Roach Motel',
      Description: "Perfect Location on Main Street. Earn points while enjoying close proximity to the city's best shopping, restaurants, and attractions.",
      // ... more fields
    }
  },
  // ... 4 more results
]
```

## Potential Solutions

### 1. **Immediate Fix: Lower Similarity Threshold**
Change the similarity threshold from 0.7 to a lower value (e.g., 0.5 or 0.0):

```typescript
// In search.ts
similarityThreshold: parseFloat(process.env.SIMILARITY_THRESHOLD || '0.5'), // Changed from '0.7'
```

### 2. **Remove Similarity Filtering**
Remove the similarity threshold filtering to match the vector search project behavior:

```typescript
// In utils.ts searchHotels function
return results.map(r => ({
    ...r.document,
    score: r.score
}));
// Remove: .filter(r => r.score >= similarityThreshold)
```

### 3. **Use Consistent OpenAI Client**
Replace LangChain's `AzureOpenAIEmbeddings` with the native `AzureOpenAI` client to match the vector search project.

### 4. **Debug Embedding Differences**
Add logging to compare the actual embedding vectors and similarity scores:

```typescript
console.log('Query embedding length:', queryEmbedding.length);
console.log('Raw results before filtering:', results.map(r => ({ id: r._id, score: r.score })));
```

## Recommended Next Steps

1. **Temporarily set similarity threshold to 0.0** to see if results are returned
2. **Log the actual similarity scores** being returned before filtering
3. **Compare embedding vectors** generated by both methods for the same query
4. **Test with the native OpenAI client** in the agent project

## File Locations

### Agent Project Files
- Search implementation: `src/search.ts`
- Utility functions: `src/utils.ts`
- Configuration: `.env`

### Vector Search Project Files
- IVF implementation: `src/ivf.ts`
- Utility functions: `src/utils.ts`
- Configuration: `.env`

---

*Analysis completed on October 21, 2025*