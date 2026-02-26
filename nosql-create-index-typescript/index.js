/**
 * Azure Cosmos DB - Vector Index Planning & Creation
 * 
 * This sample demonstrates the CRITICAL PLANNING required for Cosmos DB vector indexes:
 * - Vector indexes MUST be defined at container creation
 * - Cannot be modified after creation (immutable schema)
 * - Must test and validate before production deployment
 * - Changing index type requires container recreation and data migration
 * 
 * Focus: Planning, Testing, Validation (not algorithm comparison - that's Topic 3)
 */

const { CosmosClient } = require("@azure/cosmos");
const { OpenAIClient, AzureKeyCredential } = require("@azure/openai");
require("dotenv").config();

// Configuration
const config = {
  cosmos: {
    endpoint: process.env.COSMOS_ENDPOINT,
    key: process.env.COSMOS_KEY,
    databaseId: process.env.COSMOS_DATABASE_NAME || "vectordb"
  },
  openai: {
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    key: process.env.AZURE_OPENAI_API_KEY,
    embeddingDeployment: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || "text-embedding-ada-002",
    dimensions: parseInt(process.env.AZURE_OPENAI_EMBEDDING_DIMENSIONS || "1536")
  }
};

// Initialize clients
const cosmosClient = new CosmosClient({
  endpoint: config.cosmos.endpoint,
  key: config.cosmos.key
});

const openaiClient = new OpenAIClient(
  config.openai.endpoint,
  new AzureKeyCredential(config.openai.key)
);

/**
 * Generate embedding for text
 */
async function generateEmbedding(text) {
  try {
    const embeddings = await openaiClient.getEmbeddings(
      config.openai.embeddingDeployment,
      [text]
    );
    return embeddings.data[0].embedding;
  } catch (error) {
    console.error("Error generating embedding:", error.message);
    throw error;
  }
}

/**
 * STEP 1: Verify embedding dimensions BEFORE container creation
 * This is CRITICAL - you only get one chance to set dimensions correctly
 */
async function verifyEmbeddingDimensions() {
  console.log("\n=== STEP 1: Verify Embedding Dimensions (BEFORE Container Creation) ===");
  console.log("⚠ CRITICAL: Do this BEFORE creating your container!");
  console.log("   Dimensions cannot be changed after container creation.\n");
  
  const testText = "Verify embedding dimensions before container creation";
  console.log(`Generating test embedding...`);
  
  const embedding = await generateEmbedding(testText);
  const actualDimensions = embedding.length;
  
  console.log(`✓ Embedding model: ${config.openai.embeddingDeployment}`);
  console.log(`✓ Actual dimensions: ${actualDimensions}`);
  console.log(`  Expected (from config): ${config.openai.dimensions}`);
  
  if (actualDimensions !== config.openai.dimensions) {
    console.log(`\n⚠ MISMATCH DETECTED!`);
    console.log(`  Update AZURE_OPENAI_EMBEDDING_DIMENSIONS in .env to ${actualDimensions}`);
    config.openai.dimensions = actualDimensions;
    console.log(`  Auto-corrected for this session`);
  } else {
    console.log(`✓ Dimensions match - safe to create container`);
  }
  
  console.log(`\n→ USE THIS VALUE in vectorEmbeddingPolicy: ${actualDimensions}`);
  
  return actualDimensions;
}

/**
 * STEP 2: Create container with vector index
 * This is your ONE CHANCE to set the index configuration correctly
 */
async function createContainerWithVectorIndex(database, dimensions, indexType = "quantizedFlat") {
  console.log("\n=== STEP 2: Create Container with Vector Index ===");
  console.log("⚠ CRITICAL: Index configuration is IMMUTABLE after creation!\n");
  
  const containerId = `embeddings_${indexType}`;
  
  const containerDefinition = {
    id: containerId,
    
    partitionKey: {
      paths: ["/category"]
    },
    
    // Vector index - CANNOT CHANGE AFTER CREATION
    indexingPolicy: {
      automatic: true,
      includedPaths: [{ path: "/*" }],
      excludedPaths: [{ path: "/\"_etag\"/?" }],
      
      vectorIndexes: [
        {
          path: "/embedding",
          type: indexType  // "flat", "quantizedFlat", or "diskANN"
        }
      ]
    },
    
    // Vector embedding policy - CANNOT CHANGE AFTER CREATION
    vectorEmbeddingPolicy: {
      vectorEmbeddings: [
        {
          path: "/embedding",
          dataType: "float32",
          dimensions: dimensions,  // MUST match embedding model exactly
          distanceFunction: "cosine"
        }
      ]
    }
  };
  
  console.log("Creating container with configuration:");
  console.log(`  ID: ${containerId}`);
  console.log(`  Index type: ${indexType}`);
  console.log(`  Dimensions: ${dimensions}`);
  console.log(`  Distance function: cosine`);
  
  const startTime = Date.now();
  const { container } = await database.containers.createIfNotExists(containerDefinition);
  const creationTime = Date.now() - startTime;
  
  console.log(`\n✓ Container created in ${creationTime}ms`);
  console.log(`⚠ Index configuration is now IMMUTABLE`);
  console.log(`  → Cannot change index type without recreating container`);
  console.log(`  → Cannot change dimensions without recreating container`);
  
  return container;
}

/**
 * STEP 3: Validate configuration immediately after creation
 * Catch any configuration errors before inserting data
 */
async function validateIndexConfiguration(container, expectedDimensions) {
  console.log("\n=== STEP 3: Validate Index Configuration ===");
  console.log("Verify container was created with correct settings\n");
  
  const { resource: containerDef } = await container.read();
  
  const checks = {
    vectorIndexExists: false,
    embeddingPolicyExists: false,
    dimensionsCorrect: false,
    pathsMatch: false,
    distanceFunctionSet: false
  };
  
  // Check vector indexes
  console.log("Checking vector indexes...");
  if (containerDef.indexingPolicy?.vectorIndexes?.length > 0) {
    checks.vectorIndexExists = true;
    const index = containerDef.indexingPolicy.vectorIndexes[0];
    console.log(`  ✓ Vector index found: ${index.path} (${index.type})`);
  } else {
    console.log(`  ✗ No vector indexes found!`);
    console.log(`    Container was created WITHOUT vector index`);
    console.log(`    You must recreate the container`);
  }
  
  // Check vector embedding policy
  console.log("\nChecking vector embedding policy...");
  if (containerDef.vectorEmbeddingPolicy?.vectorEmbeddings?.length > 0) {
    checks.embeddingPolicyExists = true;
    const embed = containerDef.vectorEmbeddingPolicy.vectorEmbeddings[0];
    
    console.log(`  ✓ Embedding policy found: ${embed.path}`);
    console.log(`    Dimensions: ${embed.dimensions}`);
    console.log(`    Distance: ${embed.distanceFunction}`);
    console.log(`    Data type: ${embed.dataType}`);
    
    // Validate dimensions
    checks.dimensionsCorrect = embed.dimensions === expectedDimensions;
    if (!checks.dimensionsCorrect) {
      console.log(`    ✗ DIMENSION MISMATCH!`);
      console.log(`      Expected: ${expectedDimensions}`);
      console.log(`      Got: ${embed.dimensions}`);
      console.log(`      You must recreate container with correct dimensions`);
    } else {
      console.log(`    ✓ Dimensions match expected value`);
    }
    
    // Validate paths match
    const indexPath = containerDef.indexingPolicy.vectorIndexes[0]?.path;
    checks.pathsMatch = embed.path === indexPath;
    if (!checks.pathsMatch) {
      console.log(`    ✗ Path mismatch between index and policy`);
    }
    
    checks.distanceFunctionSet = !!embed.distanceFunction;
  } else {
    console.log(`  ✗ No embedding policy found!`);
  }
  
  // Summary
  console.log("\n--- Validation Summary ---");
  const allPassed = Object.values(checks).every(check => check === true);
  
  if (allPassed) {
    console.log("✅ All checks PASSED");
    console.log("   Container is configured correctly");
  } else {
    console.log("❌ Some checks FAILED");
    console.log("   Review errors above");
    console.log("   You may need to recreate the container");
  }
  
  return { healthy: allPassed, checks };
}

/**
 * STEP 4: Test document insertion
 * Verify dimensions are compatible before loading production data
 */
async function testDocumentInsertion(container) {
  console.log("\n=== STEP 4: Test Document Insertion ===");
  console.log("Verify embeddings can be inserted successfully\n");
  
  const testDoc = {
    id: `test-${Date.now()}`,
    title: "Test Document for Dimension Validation",
    content: "This tests that embedding dimensions match the container policy",
    embedding: await generateEmbedding("test content"),
    category: "test"
  };
  
  console.log(`Attempting to insert test document...`);
  console.log(`  Embedding dimensions: ${testDoc.embedding.length}`);
  
  try {
    const { requestCharge } = await container.items.create(testDoc);
    
    console.log(`✓ Insert successful!`);
    console.log(`  RU charge: ${requestCharge.toFixed(2)} RU/s`);
    console.log(`  Dimensions are compatible`);
    
    // Clean up test document
    await container.item(testDoc.id, testDoc.category).delete();
    console.log(`✓ Test document cleaned up`);
    
    return { success: true, requestCharge };
    
  } catch (error) {
    console.log(`✗ Insert FAILED: ${error.message}`);
    
    if (error.message.includes("dimension")) {
      console.log(`\n⚠ DIMENSION MISMATCH ERROR`);
      console.log(`  Your embeddings don't match the container's vectorEmbeddingPolicy`);
      console.log(`  You must recreate the container with correct dimensions`);
    }
    
    return { success: false, error: error.message };
  }
}

/**
 * STEP 5: Insert sample documents
 */
async function insertSampleDocuments(container) {
  console.log("\n=== STEP 5: Insert Sample Documents ===");
  
  const documents = [
    {
      id: "1",
      title: "Understanding Cosmos DB Vector Index Immutability",
      content: "In Cosmos DB, vector indexes must be defined at container creation time and cannot be modified afterward, requiring careful planning.",
      category: "concepts"
    },
    {
      id: "2",
      title: "Planning Your Vector Index Strategy",
      content: "Before creating a production container, test different index types with representative data to choose the optimal configuration.",
      category: "best-practices"
    },
    {
      id: "3",
      title: "Migrating to a Different Index Type",
      content: "If you need to change index types, you must create a new container with the desired configuration and migrate all documents.",
      category: "operations"
    }
  ];
  
  console.log(`Inserting ${documents.length} sample documents...\n`);
  let successCount = 0;
  
  for (const doc of documents) {
    try {
      const embedding = await generateEmbedding(doc.content);
      const docWithEmbedding = {
        ...doc,
        embedding: embedding,
        embeddingModel: config.openai.embeddingDeployment,
        createdAt: new Date().toISOString()
      };
      
      const { requestCharge } = await container.items.create(docWithEmbedding);
      successCount++;
      console.log(`  ✓ ${doc.title} (${requestCharge.toFixed(2)} RU)`);
      
    } catch (error) {
      console.error(`  ✗ Error inserting ${doc.id}: ${error.message}`);
    }
  }
  
  console.log(`\n✓ Inserted ${successCount}/${documents.length} documents`);
  return successCount;
}

/**
 * STEP 6: Test vector query functionality
 */
async function testVectorQuery(container) {
  console.log("\n=== STEP 6: Test Vector Query ===");
  console.log("Verify VectorDistance() queries work correctly\n");
  
  const queryText = "How do I plan my vector index configuration?";
  console.log(`Query: "${queryText}"`);
  
  try {
    const queryEmbedding = await generateEmbedding(queryText);
    
    const querySpec = {
      query: `SELECT TOP 3 
                c.id, 
                c.title,
                VectorDistance(c.embedding, @embedding) AS similarity 
              FROM c 
              ORDER BY VectorDistance(c.embedding, @embedding)`,
      parameters: [{ name: "@embedding", value: queryEmbedding }]
    };
    
    const startTime = Date.now();
    const { resources, requestCharge } = await container.items
      .query(querySpec)
      .fetchAll();
    const latency = Date.now() - startTime;
    
    console.log(`\n✓ Query executed successfully`);
    console.log(`  Latency: ${latency}ms`);
    console.log(`  RU charge: ${requestCharge.toFixed(2)} RU/s`);
    console.log(`  Results: ${resources.length}`);
    
    if (resources.length > 0) {
      console.log(`\n  Top results:`);
      resources.forEach((r, i) => {
        console.log(`    ${i + 1}. ${r.title}`);
        console.log(`       Similarity: ${r.similarity.toFixed(4)}`);
      });
    }
    
    return { success: true, latency, requestCharge };
    
  } catch (error) {
    console.log(`✗ Query failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Display summary and key lessons
 */
function displaySummary() {
  console.log("\n" + "=".repeat(80));
  console.log("SUMMARY: Cosmos DB Vector Index Planning");
  console.log("=".repeat(80));
  
  console.log("\n🔒 KEY CONSTRAINT:");
  console.log("   Vector indexes in Cosmos DB are IMMUTABLE after container creation");
  
  console.log("\n📋 WHAT THIS MEANS:");
  console.log("   ✓ Must plan carefully before creating container");
  console.log("   ✓ Test different index types before production");
  console.log("   ✓ Verify dimensions match embedding model exactly");
  console.log("   ✗ Cannot modify index type after creation");
  console.log("   ✗ Cannot change dimensions after creation");
  
  console.log("\n🔧 IF YOU NEED TO CHANGE:");
  console.log("   1. Create new container with desired configuration");
  console.log("   2. Migrate all documents to new container");
  console.log("   3. Update application to use new container");
  console.log("   4. Delete old container");
  
  console.log("\n✅ BEST PRACTICES:");
  console.log("   • Always verify dimensions BEFORE container creation");
  console.log("   • Test index types with representative data");
  console.log("   • Validate configuration immediately after creation");
  console.log("   • Document your index choice and rationale");
  console.log("   • Plan for scale (use DiskANN if expecting > 10K vectors)");
  
  console.log("\n🎯 WORKFLOW DEMONSTRATED:");
  console.log("   1. ✓ Verified embedding dimensions first");
  console.log("   2. ✓ Created container with vector index (ONE CHANCE)");
  console.log("   3. ✓ Validated configuration immediately");
  console.log("   4. ✓ Tested insertion to verify compatibility");
  console.log("   5. ✓ Inserted sample documents");
  console.log("   6. ✓ Confirmed vector queries work");
  
  console.log("\n→ Next: Topic 3 to learn which index type to choose (Flat vs QuantizedFlat vs DiskANN)");
}

/**
 * Main execution
 */
async function main() {
  console.log("=".repeat(80));
  console.log("Azure Cosmos DB - Vector Index Planning & Creation");
  console.log("=".repeat(80));
  console.log("\nDemonstrating the critical planning required for Cosmos DB vector indexes");
  console.log("Key lesson: Vector indexes are IMMUTABLE - plan carefully!\n");
  
  try {
    const database = cosmosClient.database(config.cosmos.databaseId);
    await database.containers.createIfNotExists({ id: config.cosmos.databaseId });
    
    // STEP 1: Verify dimensions BEFORE creating container
    const dimensions = await verifyEmbeddingDimensions();
    
    // STEP 2: Create container (ONE CHANCE to get it right!)
    const container = await createContainerWithVectorIndex(database, dimensions, "quantizedFlat");
    
    // STEP 3: Validate immediately
    const validation = await validateIndexConfiguration(container, dimensions);
    if (!validation.healthy) {
      console.log("\n⚠ Configuration validation failed");
      console.log("   Review errors above - you may need to recreate container");
      return;
    }
    
    // STEP 4: Test insertion
    const insertTest = await testDocumentInsertion(container);
    if (!insertTest.success) {
      console.log("\n⚠ Insertion test failed");
      console.log("   Review errors above - likely dimension mismatch");
      return;
    }
    
    // STEP 5: Insert sample documents
    const insertedCount = await insertSampleDocuments(container);
    if (insertedCount === 0) {
      console.log("\n⚠ No documents inserted successfully");
      return;
    }
    
    // STEP 6: Test queries
    const queryTest = await testVectorQuery(container);
    if (!queryTest.success) {
      console.log("\n⚠ Query test failed");
      return;
    }
    
    // Display summary
    displaySummary();
    
    console.log("\n" + "=".repeat(80));
    console.log("✓ Sample completed successfully");
    console.log("=".repeat(80));
    
  } catch (error) {
    console.error("\n" + "=".repeat(80));
    console.error("✗ Error:", error.message);
    console.error("=".repeat(80));
    console.error(error);
    process.exit(1);
  }
}

// Run the sample
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  generateEmbedding,
  verifyEmbeddingDimensions,
  createContainerWithVectorIndex,
  validateIndexConfiguration,
  testDocumentInsertion,
  insertSampleDocuments,
  testVectorQuery
};
