# Indexing for Embeddings in Azure Cosmos DB

**Purpose:** Learn how to plan and configure vector indexes in Azure Cosmos DB containers. Unlike traditional databases where indexes can be added later, Cosmos DB vector indexes **must be defined at container creation time** and cannot be modified afterward. This article teaches you how to plan your index strategy, test different configurations, and handle the immutability constraint.

## Prerequisites

- An Azure account with an active subscription
- Azure Cosmos DB account with NoSQL API
- Node.js 18.x or later
- Azure OpenAI resource with an embeddings model deployed
- Familiarity with the [Cosmos DB vector store quickstart](https://learn.microsoft.com/en-us/azure/cosmos-db/quickstart-vector-store-nodejs)

## What You'll Learn

In this article, you'll answer the key questions:
- **How do I create a vector index in my database?**
- **Why must I decide on index type at container creation?**
- **How do I know if my index configuration is working correctly?**
- **What if I need to change my index type later?**

You'll learn to:
- Define vector index policies in container creation
- Understand why Cosmos DB indexes are immutable
- Test different index configurations before production
- Plan for schema changes and data migration

## Understanding Cosmos DB Vector Index Model

### Indexes Are Part of Container Schema

In Azure Cosmos DB, vector indexes are **part of the container schema definition**. This means:

✅ Defined when you create the container
✅ Active immediately (no separate build phase)
✅ Cannot be modified after container creation
❌ Cannot add vector indexes to existing containers
❌ Cannot change index type without recreating container

**Why this design?** Cosmos DB uses automatic indexing that maintains indexes incrementally with each write. The index structure must be known upfront for optimal performance.

### The Immutability Constraint

Once you create a container with a vector index policy, **you cannot change it**. If you need a different index type or configuration, you must:

1. Create a new container with the desired index policy
2. Migrate all documents to the new container
3. Update your application to use the new container
4. Delete the old container

**This makes planning critical.**

## Planning Your Vector Index Strategy

### Step 1: Understand Your Requirements

Before creating your container, answer these questions:

**Dataset characteristics:**
- Current data volume: _____ documents
- Expected growth: _____ documents per month
- Vector dimensions: _____ (must match embedding model)

**Performance requirements:**
- Acceptable query latency: _____ ms
- Required recall accuracy: _____ %
- Budget for RU consumption: _____ RU/s

**Business constraints:**
- Can you tolerate ~95-99% recall? (Yes → QuantizedFlat or DiskANN)
- Need 100% exact results? (Yes → Flat, only if < 10K vectors)
- Planning for scale beyond 10K vectors? (Yes → DiskANN)

### Step 2: Choose Your Index Type

Based on your requirements, select an algorithm:

| Index Type | When to Use | Recall | Performance | RU Impact |
|------------|-------------|--------|-------------|-----------|
| **Flat** | < 10K vectors AND need 100% recall | 100% (exact) | Slower as data grows | Baseline |
| **QuantizedFlat** | Memory-constrained, general use | 95-99% | Good balance | +20-30% writes |
| **DiskANN** | **Recommended**: > 10K vectors, scalability | 90-99% (tunable) | Best for large scale | +50-100% writes |

**Default recommendation:** Start with **QuantizedFlat** unless you know you'll exceed 10K vectors soon, then use **DiskANN**.

### Step 3: Test Before Production

**Critical:** Test your index choice before production deployment.

Create test containers with different index types:

```javascript
// Test container 1: QuantizedFlat
const testContainerQF = await database.containers.create({
  id: "test_quantizedflat",
  indexingPolicy: {
    vectorIndexes: [{ path: "/embedding", type: "quantizedFlat" }]
  },
  // ... rest of definition
});

// Test container 2: DiskANN
const testContainerDiskANN = await database.containers.create({
  id: "test_diskann",
  indexingPolicy: {
    vectorIndexes: [{ path: "/embedding", type: "diskANN" }]
  },
  // ... rest of definition
});

// Load representative data into both
// Run your typical queries
// Compare recall, latency, RU consumption
```

**Measure what matters:**
- Query latency (p50, p95, p99)
- Recall accuracy (if you have ground truth)
- RU consumption per query
- Write RU consumption

**Only then** create your production container with the chosen index type.

## Creating a Container with Vector Index

### Complete Container Definition

```javascript
const { CosmosClient } = require("@azure/cosmos");
require("dotenv").config();

async function createVectorContainer() {
  const client = new CosmosClient({
    endpoint: process.env.COSMOS_ENDPOINT,
    key: process.env.COSMOS_KEY
  });

  const database = client.database(process.env.COSMOS_DATABASE_NAME);
  
  // CRITICAL: Index policy must be defined here
  // Cannot change after creation!
  const containerDefinition = {
    id: process.env.COSMOS_CONTAINER_NAME,
    
    partitionKey: {
      paths: ["/category"]  // Choose appropriate partition key
    },
    
    // Vector index configuration
    indexingPolicy: {
      automatic: true,
      includedPaths: [{ path: "/*" }],
      excludedPaths: [{ path: "/\"_etag\"/?" }],
      
      // Vector indexes - IMMUTABLE after creation
      vectorIndexes: [
        {
          path: "/embedding",
          type: "quantizedFlat"  // Or "flat", "diskANN"
        }
      ]
    },
    
    // Vector embedding policy - defines vector field properties
    vectorEmbeddingPolicy: {
      vectorEmbeddings: [
        {
          path: "/embedding",
          dataType: "float32",
          dimensions: 1536,  // MUST match your embedding model
          distanceFunction: "cosine"  // Or "euclidean", "dotproduct"
        }
      ]
    }
  };

  // Create container (this is your one chance to set vector indexes!)
  const { container } = await database.containers.create(containerDefinition);
  
  console.log(`✓ Container created: ${container.id}`);
  console.log(`  Index type: ${containerDefinition.indexingPolicy.vectorIndexes[0].type}`);
  console.log(`  Dimensions: ${containerDefinition.vectorEmbeddingPolicy.vectorEmbeddings[0].dimensions}`);
  console.log("  ⚠ This index configuration is now IMMUTABLE");
  
  return container;
}
```

### Key Configuration Elements

#### vectorIndexes (in indexingPolicy)
- **path**: Field containing embedding array (e.g., "/embedding")
- **type**: Algorithm choice - "flat", "quantizedFlat", or "diskANN"
- **⚠ Immutable**: Cannot change after container creation

#### vectorEmbeddingPolicy
- **path**: Must match vectorIndexes path
- **dimensions**: **CRITICAL** - Must exactly match your embedding model output
- **dataType**: Typically "float32" for embeddings
- **distanceFunction**: "cosine" (most common), "euclidean", or "dotproduct"

## Critical: Dimension Compatibility

### Why Dimensions Matter

The `dimensions` value in your vectorEmbeddingPolicy **must exactly match** your embedding model's output. Mismatch causes insertion failures.

### Verify Before Container Creation

```javascript
const { OpenAIClient, AzureKeyCredential } = require("@azure/openai");

async function verifyDimensionsBeforeCreation() {
  console.log("=== STEP 1: Verify Embedding Dimensions ===");
  console.log("Do this BEFORE creating your container!\n");
  
  // Generate test embedding
  const openaiClient = new OpenAIClient(
    process.env.AZURE_OPENAI_ENDPOINT,
    new AzureKeyCredential(process.env.AZURE_OPENAI_API_KEY)
  );
  
  const testEmbedding = await openaiClient.getEmbeddings(
    process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
    ["test"]
  );
  
  const actualDimensions = testEmbedding.data[0].embedding.length;
  
  console.log(`✓ Embedding model: ${process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT}`);
  console.log(`✓ Actual dimensions: ${actualDimensions}`);
  console.log("\n⚠ USE THIS VALUE in your vectorEmbeddingPolicy!");
  
  return actualDimensions;
}
```

### Common Embedding Models

| Model | Dimensions |
|-------|------------|
| text-embedding-ada-002 | 1536 |
| text-embedding-3-small | 1536 |
| text-embedding-3-large | 3072 |

## Validating Your Index Configuration

### Read Back and Verify

After container creation, immediately validate your configuration:

```javascript
async function validateIndexConfiguration(container) {
  console.log("\n=== Validating Index Configuration ===");
  
  const { resource: containerDef } = await container.read();
  
  // Check vector indexes
  const vectorIndexes = containerDef.indexingPolicy?.vectorIndexes;
  if (!vectorIndexes || vectorIndexes.length === 0) {
    console.log("❌ ERROR: No vector indexes found!");
    console.log("   Container was created without vector index.");
    console.log("   You must recreate the container.");
    return false;
  }
  
  console.log("\n✓ Vector Index Configuration:");
  vectorIndexes.forEach((index, i) => {
    console.log(`  [${i + 1}] Path: ${index.path}`);
    console.log(`      Type: ${index.type}`);
  });
  
  // Check embedding policy
  const embeddings = containerDef.vectorEmbeddingPolicy?.vectorEmbeddings;
  if (!embeddings || embeddings.length === 0) {
    console.log("❌ ERROR: No vector embedding policy found!");
    return false;
  }
  
  console.log("\n✓ Vector Embedding Policy:");
  embeddings.forEach((embed, i) => {
    console.log(`  [${i + 1}] Path: ${embed.path}`);
    console.log(`      Dimensions: ${embed.dimensions}`);
    console.log(`      Distance Function: ${embed.distanceFunction}`);
    console.log(`      Data Type: ${embed.dataType}`);
  });
  
  // Verify paths match
  const indexPath = vectorIndexes[0].path;
  const embeddingPath = embeddings[0].path;
  
  if (indexPath !== embeddingPath) {
    console.log(`\n❌ ERROR: Path mismatch!`);
    console.log(`   vectorIndexes path: ${indexPath}`);
    console.log(`   vectorEmbeddings path: ${embeddingPath}`);
    return false;
  }
  
  console.log("\n✅ Configuration is valid");
  console.log("⚠ Remember: This configuration is now IMMUTABLE");
  
  return true;
}
```

## Testing Your Index Works

### Insert Test Document

```javascript
async function testDocumentInsertion(container, embedding) {
  console.log("\n=== Testing Document Insertion ===");
  
  const testDoc = {
    id: `test-${Date.now()}`,
    title: "Test Document",
    content: "Testing vector index functionality",
    embedding: embedding,
    category: "test"
  };
  
  try {
    const { resource, requestCharge } = await container.items.create(testDoc);
    console.log("✓ Document inserted successfully");
    console.log(`  RU charge: ${requestCharge.toFixed(2)} RU/s`);
    
    // Clean up
    await container.item(testDoc.id, testDoc.category).delete();
    
    return true;
  } catch (error) {
    if (error.message.includes("dimension")) {
      console.log("❌ Dimension mismatch error!");
      console.log("   Your embedding dimensions don't match the policy.");
      console.log("   You must recreate the container with correct dimensions.");
    } else {
      console.log(`❌ Insert failed: ${error.message}`);
    }
    return false;
  }
}
```

### Test Vector Query

```javascript
async function testVectorQuery(container, queryEmbedding) {
  console.log("\n=== Testing Vector Query ===");
  
  const querySpec = {
    query: `SELECT TOP 5 
              c.id, 
              c.title,
              VectorDistance(c.embedding, @embedding) AS similarity 
            FROM c 
            ORDER BY VectorDistance(c.embedding, @embedding)`,
    parameters: [
      { name: "@embedding", value: queryEmbedding }
    ]
  };
  
  try {
    const startTime = Date.now();
    const { resources, requestCharge } = await container.items
      .query(querySpec)
      .fetchAll();
    const latency = Date.now() - startTime;
    
    console.log(`✓ Query executed successfully`);
    console.log(`  Latency: ${latency}ms`);
    console.log(`  RU charge: ${requestCharge.toFixed(2)} RU/s`);
    console.log(`  Results: ${resources.length} documents`);
    
    return true;
  } catch (error) {
    console.log(`❌ Query failed: ${error.message}`);
    return false;
  }
}
```

## Understanding RU Consumption

Vector indexes add overhead to write operations:

| Index Type | Write RU Impact | Query RU Impact |
|------------|-----------------|-----------------|
| **Flat** | Baseline | Moderate (linear scan) |
| **QuantizedFlat** | +20-30% | Lower (indexed) |
| **DiskANN** | +50-100% | Lower (indexed) |

**For bulk inserts:** Provision 1.5-2x your normal RU/s during initial data load.

## What If You Need to Change?

### Scenario: Wrong Index Type Chosen

You created a container with `flat` index but now have 50K documents and queries are slow.

**Required steps:**

```javascript
async function migrateToNewIndexType(database, oldContainer, newIndexType) {
  console.log("=== Migrating to New Index Type ===");
  console.log(`Old index: ${oldContainer.id}`);
  console.log(`New index type: ${newIndexType}`);
  
  // Step 1: Create new container with desired index type
  const newContainerDef = {
    id: `${oldContainer.id}_v2`,
    partitionKey: { paths: ["/category"] },
    indexingPolicy: {
      automatic: true,
      includedPaths: [{ path: "/*" }],
      excludedPaths: [{ path: "/\"_etag\"/?" }],
      vectorIndexes: [
        {
          path: "/embedding",
          type: newIndexType  // New index type!
        }
      ]
    },
    vectorEmbeddingPolicy: {
      // Same as old container
      vectorEmbeddings: [{
        path: "/embedding",
        dataType: "float32",
        dimensions: 1536,
        distanceFunction: "cosine"
      }]
    }
  };
  
  const { container: newContainer } = await database.containers.create(newContainerDef);
  console.log(`✓ New container created: ${newContainer.id}`);
  
  // Step 2: Migrate data
  console.log("\nMigrating data...");
  const { resources: allDocs } = await oldContainer.items
    .readAll()
    .fetchAll();
  
  let migratedCount = 0;
  for (const doc of allDocs) {
    await newContainer.items.create(doc);
    migratedCount++;
    if (migratedCount % 100 === 0) {
      console.log(`  Migrated ${migratedCount}/${allDocs.length}`);
    }
  }
  
  console.log(`✓ Migrated ${migratedCount} documents`);
  
  // Step 3: Update application to use new container
  console.log("\n⚠ Next steps:");
  console.log("  1. Update your application to use new container");
  console.log("  2. Test thoroughly in production");
  console.log("  3. Delete old container when confident");
  console.log(`  4. Consider renaming ${newContainer.id} to ${oldContainer.id}`);
  
  return newContainer;
}
```

### Prevention: Test First

Avoid costly migrations by testing thoroughly before production:

1. **Create test containers** with each index type you're considering
2. **Load representative data** (sample of production data)
3. **Run typical queries** and measure performance
4. **Compare results** across index types
5. **Choose based on data**, not guesses

## Best Practices

### Before Container Creation
✅ Verify embedding model dimensions with test generation  
✅ Understand your data volume and growth trajectory  
✅ Define your latency and recall requirements  
✅ Test multiple index types on sample data  
✅ Choose partition key strategy carefully (also immutable)  

### At Container Creation
✅ Double-check dimensions match your model  
✅ Choose index type based on testing, not defaults  
✅ Set appropriate distance function (cosine for most embeddings)  
✅ Document your index choice and rationale  
✅ Plan for future growth (if expecting scale, use DiskANN)  

### After Container Creation
✅ Immediately validate configuration  
✅ Test insertion with real embeddings  
✅ Test vector queries work  
✅ Monitor RU consumption patterns  
✅ Document that index type cannot be changed  

### Planning for Scale
✅ If < 10K vectors now but growth expected → use DiskANN  
✅ If memory-constrained → use QuantizedFlat  
✅ Avoid Flat unless you have strong reason (rarely needed)  
✅ Plan for container recreation if needs change drastically  

## Troubleshooting

### Issue: Dimension mismatch on insert
**Cause**: vectorEmbeddingPolicy dimensions don't match embedding  
**Fix**: You must recreate container with correct dimensions  
**Prevention**: Always verify dimensions before container creation

### Issue: Queries are slow
**Cause**: Wrong index type for data volume (e.g., Flat with 100K docs)  
**Fix**: Migrate to new container with appropriate index type  
**Prevention**: Test with production-scale data before deployment

### Issue: Need to change index type
**Cause**: Requirements changed or wrong choice initially  
**Fix**: Create new container and migrate data  
**Prevention**: Test multiple index types before production

### Issue: VectorDistance() not working
**Cause**: No vector index defined in indexingPolicy  
**Fix**: Recreate container with vectorIndexes  
**Prevention**: Validate configuration immediately after creation

## Complete Workflow Example

```javascript
async function completeIndexCreationWorkflow() {
  console.log("=== Complete Vector Index Creation Workflow ===\n");
  
  // STEP 1: Verify dimensions FIRST
  console.log("STEP 1: Verify embedding dimensions");
  const dimensions = await verifyDimensionsBeforeCreation();
  console.log(`→ Will use dimensions: ${dimensions}\n`);
  
  // STEP 2: Plan and choose index type
  console.log("STEP 2: Choose index type based on requirements");
  console.log("  Dataset size: 50,000 documents");
  console.log("  Expected growth: 10,000/month");
  console.log("  → Recommendation: DiskANN (scalability)\n");
  
  const indexType = "diskANN";
  
  // STEP 3: Create container (ONE CHANCE!)
  console.log("STEP 3: Create container with vector index");
  const container = await createVectorContainerWithType(indexType, dimensions);
  console.log("⚠ Index configuration is now IMMUTABLE\n");
  
  // STEP 4: Validate immediately
  console.log("STEP 4: Validate configuration");
  const isValid = await validateIndexConfiguration(container);
  if (!isValid) {
    console.log("❌ Validation failed - must recreate container");
    return;
  }
  
  // STEP 5: Test functionality
  console.log("\nSTEP 5: Test insertion and queries");
  const testEmbedding = await generateTestEmbedding();
  
  const canInsert = await testDocumentInsertion(container, testEmbedding);
  if (!canInsert) {
    console.log("❌ Insert test failed - check dimensions");
    return;
  }
  
  // Insert sample data
  await insertSampleDocuments(container);
  
  const canQuery = await testVectorQuery(container, testEmbedding);
  if (!canQuery) {
    console.log("❌ Query test failed");
    return;
  }
  
  // STEP 6: Document and proceed
  console.log("\n=== ✓ Container Ready for Production ===");
  console.log(`Container: ${container.id}`);
  console.log(`Index type: ${indexType}`);
  console.log(`Dimensions: ${dimensions}`);
  console.log("\n⚠ Remember:");
  console.log("  • Index type cannot be changed");
  console.log("  • Plan for migration if requirements change dramatically");
  console.log("  • Monitor RU consumption and query performance");
}
```

## Key Takeaways

### The Core Constraint
🔒 **Vector indexes are immutable in Cosmos DB**
- Must be defined at container creation
- Cannot be modified afterward
- Changing requires container recreation and data migration

### Why This Matters
📋 **Planning is critical**
- Test before production deployment
- Choose index type based on data, not guesses
- Understand growth trajectory
- Document your decisions

### What Makes a Good Choice
✅ **Successful index planning**
- Dimensions verified before creation
- Index type tested with representative data
- Scaling needs considered
- Migration path understood if needs change

### When Things Go Wrong
🔧 **Migration path**
1. Create new container with desired index
2. Migrate all data
3. Update application
4. Delete old container

The key is: **Get it right the first time through testing.**

## Next Steps

Now that you understand Cosmos DB's immutable index model:
- **Topic 3: Vector Index Algorithms & Query Behavior** - Learn which algorithm (Flat, QuantizedFlat, DiskANN) to choose and why
- **Production Planning** - Design your testing strategy before deployment

## Additional Resources

- [Azure Cosmos DB Vector Search documentation](https://learn.microsoft.com/azure/cosmos-db/vector-search)
- [Indexing policies in Cosmos DB](https://learn.microsoft.com/azure/cosmos-db/index-policy)
- [Container management best practices](https://learn.microsoft.com/azure/cosmos-db/how-to-manage-database-account)
- [Request Units and provisioning](https://learn.microsoft.com/azure/cosmos-db/request-units)
