# Azure Cosmos DB - Vector Index Planning & Creation

This sample demonstrates the **critical planning required** for Cosmos DB vector indexes. Unlike traditional databases, **vector indexes must be defined at container creation and cannot be modified afterward**.

## What You'll Learn

This sample answers the key questions:
- **How do I create a vector index in my database?**
- **Why must I decide on index type at container creation?**
- **How do I know if my configuration is working correctly?**
- **What if I need to change my index type later?**

You'll learn to:
- Plan vector index configuration before container creation
- Understand the immutability constraint
- Test and validate your configuration
- Handle migration if you need to change index types

## The Core Constraint

🔒 **Vector indexes in Cosmos DB are IMMUTABLE**

Once you create a container with a vector index policy, you **cannot change it**. This means:

✅ Defined when you create the container  
✅ Active immediately (no build phase)  
❌ Cannot add vector indexes to existing containers  
❌ Cannot change index type without recreating container  
❌ Cannot modify dimensions without recreating container  

**This makes planning critical.**

## Why This Design?

Cosmos DB uses automatic indexing that maintains indexes incrementally with each write. The index structure must be known upfront for optimal performance.

## Focus: Planning (Not Algorithm Comparison)

**This is Topic 2**: Planning and immutability  
**Not Topic 3**: Algorithm comparison (Flat vs QuantizedFlat vs DiskANN)

We demonstrate:
✅ Verifying dimensions before container creation  
✅ Creating container with vector index (one chance!)  
✅ Validating configuration immediately  
✅ Testing insertion and queries  
✅ Understanding migration path if needs change

## Prerequisites

- Node.js 18.x or later
- Azure subscription
- Azure Cosmos DB account (NoSQL API)
- Azure OpenAI resource with embeddings deployment

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment:
```bash
cp .env.example .env
# Edit .env with your Azure credentials
```

## Run the Sample

```bash
npm start
```

## Sample Flow

### Step 1: Verify Dimensions (BEFORE Container Creation)
```
⚠ CRITICAL: Do this BEFORE creating your container!

✓ Embedding model: text-embedding-ada-002
✓ Actual dimensions: 1536

→ USE THIS VALUE in vectorEmbeddingPolicy: 1536
```

**Why first**: Dimensions cannot be changed after container creation.

### Step 2: Create Container (ONE CHANCE)
```
Creating container with configuration:
  ID: embeddings_quantizedFlat
  Index type: quantizedFlat
  Dimensions: 1536
  Distance function: cosine

✓ Container created in 245ms
⚠ Index configuration is now IMMUTABLE
  → Cannot change index type without recreating container
```

**Key insight**: This is your one chance to get it right!

### Step 3: Validate Configuration
```
Checking vector indexes...
  ✓ Vector index found: /embedding (quantizedFlat)

Checking vector embedding policy...
  ✓ Embedding policy found: /embedding
    Dimensions: 1536
    ✓ Dimensions match expected value

--- Validation Summary ---
✅ All checks PASSED
```

### Step 4: Test Insertion
```
Attempting to insert test document...
  Embedding dimensions: 1536

✓ Insert successful!
  RU charge: 11.23 RU/s
  Dimensions are compatible
```

### Step 5: Insert Sample Documents
```
Inserting 3 sample documents...

  ✓ Understanding Cosmos DB Vector Index Immutability (10.85 RU)
  ✓ Planning Your Vector Index Strategy (11.12 RU)
  ✓ Migrating to a Different Index Type (10.94 RU)

✓ Inserted 3/3 documents
```

### Step 6: Test Query
```
Query: "How do I plan my vector index configuration?"

✓ Query executed successfully
  Latency: 42ms
  RU charge: 3.12 RU/s
  Results: 3

  Top results:
    1. Planning Your Vector Index Strategy
       Similarity: 0.0234
```

## Key Concepts

### Immutability Constraint

```javascript
// At container creation:
const containerDef = {
  indexingPolicy: {
    vectorIndexes: [
      { path: "/embedding", type: "quantizedFlat" }  // IMMUTABLE!
    ]
  },
  vectorEmbeddingPolicy: {
    vectorEmbeddings: [{
      path: "/embedding",
      dimensions: 1536,  // IMMUTABLE!
      distanceFunction: "cosine"
    }]
  }
};

// ❌ Cannot change these after creation
// ✅ Must test and validate before production
```

### What If You Need to Change?

If you created a container with the wrong index type:

1. **Create new container** with desired configuration
2. **Migrate all data** to new container
3. **Update application** to use new container
4. **Delete old container**

This is costly! **Test thoroughly first.**

### Testing Strategy

Before production:

```javascript
// Create test containers with different index types
const testQF = await createWithIndex("test_qf", "quantizedFlat");
const testDiskANN = await createWithIndex("test_diskann", "diskANN");

// Load representative data
// Run typical queries
// Measure performance

// Choose based on data, not guesses
```

## Best Practices

### Before Container Creation
✅ Verify embedding dimensions with test generation  
✅ Understand data volume and growth  
✅ Define latency and recall requirements  
✅ Test multiple index types on sample data  
✅ Choose based on measurements  

### At Container Creation
✅ Double-check dimensions match model  
✅ Choose index type based on testing  
✅ Document your choice and rationale  
✅ Plan for future growth  

### After Container Creation
✅ Immediately validate configuration  
✅ Test insertion with real embeddings  
✅ Test vector queries work  
✅ Document that config is immutable  

## Common Issues

### Issue: Dimension mismatch on insert
**Cause**: vectorEmbeddingPolicy dimensions don't match embedding  
**Fix**: Must recreate container with correct dimensions  
**Prevention**: Always verify dimensions first!

### Issue: Need to change index type
**Cause**: Wrong choice or requirements changed  
**Fix**: Create new container and migrate data  
**Prevention**: Test thoroughly before production

### Issue: VectorDistance() not working
**Cause**: No vector index defined  
**Fix**: Recreate container with vectorIndexes  
**Prevention**: Validate immediately after creation

## Workflow Summary

```
1. Verify dimensions         (Test embedding generation)
                             ↓
2. Create container          (Define vector index - ONE CHANCE!)
                             ↓
3. Validate immediately      (Check configuration is correct)
                             ↓
4. Test insertion            (Verify dimensions compatible)
                             ↓
5. Insert data               (Load production data)
                             ↓
6. Test queries              (Confirm VectorDistance works)
```

## Key Takeaway

🔒 **You get ONE CHANCE to configure vector indexes correctly**

- Test before production
- Validate immediately
- Document your decisions
- Understand migration path if needed

## Next Steps

Now that you understand Cosmos DB's immutable index model:

1. **Topic 3: Vector Index Algorithms & Query Behavior**
   - Learn which algorithm to choose (Flat vs QuantizedFlat vs DiskANN)
   - Understand recall vs latency trade-offs
   - When to use each algorithm

2. **Production Planning**
   - Design your testing strategy
   - Plan for scale
   - Document migration procedures

## Resources

- [Azure Cosmos DB Vector Search](https://learn.microsoft.com/azure/cosmos-db/vector-search)
- [Indexing policies](https://learn.microsoft.com/azure/cosmos-db/index-policy)
- [Container management](https://learn.microsoft.com/azure/cosmos-db/how-to-manage-database-account)
