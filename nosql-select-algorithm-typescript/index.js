/**
 * Azure Cosmos DB - Vector Index Algorithms & Query Behavior
 * 
 * This sample demonstrates:
 * - Creating containers with different index algorithms (Flat, QuantizedFlat, DiskANN)
 * - Benchmarking query performance across algorithms
 * - Measuring recall vs. latency trade-offs
 * - Tuning algorithm parameters for optimal performance
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
  },
  benchmark: {
    numTestQueries: 5,
    topK: 10
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
 * Create container with specific algorithm
 */
async function createContainerWithAlgorithm(database, algorithmType, suffix = "") {
  const containerId = `embeddings_${algorithmType}${suffix}`;
  
  const containerDefinition = {
    id: containerId,
    partitionKey: {
      paths: ["/category"]
    },
    indexingPolicy: {
      automatic: true,
      includedPaths: [{ path: "/*" }],
      excludedPaths: [{ path: "/\"_etag\"/?" }],
  // Add DiskANN-specific options for tuning
  if (algorithmType === "diskANN") {
    containerDefinition.indexingPolicy.vectorIndexes[0].diskANNOptions = {
      efConstruction: 400,  // Build-time parameter
      efSearch: suffix === "_ef80" ? 80 : 40  // Query-time default (40 or 80)
    };
    console.log(`DiskANN efSearch: ${containerDefinition.indexingPolicy.vectorIndexes[0].diskANNOptions.efSearch}`);
  }

  return container;
}

/**
 * Generate test dataset
 */
function generateTestDataset() {
  return [
    {
      id: "1",
      title: "Introduction to Vector Databases",
      content: "Vector databases store and query high-dimensional embeddings for semantic search applications. They enable similarity-based retrieval using approximate nearest neighbor algorithms.",
      category: "tutorial"
    },
    {
      id: "2",
      title: "Understanding Neural Networks",
      content: "Neural networks are computing systems inspired by biological neural networks. They learn patterns from data through training and can perform tasks like classification and prediction.",
      category: "machine-learning"
    },
    {
      id: "3",
      title: "Azure Cosmos DB Global Distribution",
      content: "Cosmos DB provides turnkey global distribution across any number of Azure regions. It offers multiple consistency models and comprehensive SLAs for availability and performance.",
      category: "cloud-services"
    },
    {
      id: "4",
      title: "Semantic Search Fundamentals",
      content: "Semantic search understands the intent and contextual meaning of search queries. Unlike keyword matching, it finds results based on conceptual similarity using embeddings.",
      category: "search"
    },
    {
      id: "5",
      title: "Building RAG Applications",
      content: "Retrieval-Augmented Generation combines large language models with information retrieval. It grounds LLM responses in external knowledge bases to reduce hallucinations.",
      category: "ai-applications"
    },
    {
      id: "6",
      title: "Vector Indexing Algorithms",
      content: "Different algorithms offer trade-offs between speed and accuracy. Flat provides exact search, while HNSW and DiskANN offer fast approximate nearest neighbor search.",
      category: "algorithms"
    },
    {
      id: "7",
      title: "Embeddings and Representation Learning",
      content: "Embeddings map discrete objects to continuous vector spaces where semantic similarity corresponds to geometric proximity. They capture meaning in numerical form.",
      category: "machine-learning"
    },
    {
      id: "8",
      title: "Cloud Database Performance Tuning",
      content: "Optimizing database performance involves indexing strategies, query optimization, and resource allocation. Understanding request units and throughput is essential for cost efficiency.",
      category: "cloud-services"
    },
    {
      id: "9",
      title: "Natural Language Processing Basics",
      content: "NLP enables computers to understand and process human language. It includes tasks like tokenization, named entity recognition, and sentiment analysis.",
      category: "machine-learning"
    },
    {
      id: "10",
      title: "Scalable Search Architecture",
      content: "Building scalable search requires distributed indexing, caching strategies, and load balancing. Vector search adds challenges of high-dimensional data management.",
      category: "architecture"
    },
    {
      id: "11",
      title: "Azure OpenAI Service",
      content: "Azure OpenAI provides access to powerful language models like GPT-4. It includes enterprise features like private networking, managed identity, and content filtering.",
      category: "ai-services"
    },
    {
      id: "12",
      title: "Approximate Nearest Neighbor Search",
      content: "ANN algorithms sacrifice perfect accuracy for speed. They use data structures like graphs and trees to quickly find similar vectors in high-dimensional spaces.",
      category: "algorithms"
    },
    {
      id: "13",
      title: "Hybrid Search Strategies",
      content: "Combining keyword search with vector search provides better results. Reciprocal rank fusion merges results from multiple retrieval methods effectively.",
      category: "search"
    },
    {
      id: "14",
      title: "Cost Optimization in Cloud",
      content: "Reducing cloud costs requires right-sizing resources, using reserved capacity, and optimizing query patterns. Monitoring and alerting help prevent cost overruns.",
      category: "cloud-services"
    },
    {
      id: "15",
      title: "Transformer Models",
      content: "Transformers revolutionized NLP with attention mechanisms. They process sequences in parallel and capture long-range dependencies better than RNNs.",
      category: "machine-learning"
    }
  ];
}

/**
 * Insert documents into container
 */
async function insertDocuments(container, documents) {
  console.log(`\nInserting ${documents.length} documents into ${container.id}...`);
  
  let successCount = 0;
  for (const doc of documents) {
    try {
      const embedding = await generateEmbedding(doc.content);
      const docWithEmbedding = {
        ...doc,
        embedding: embedding,
        createdAt: new Date().toISOString()
      };
      
      await container.items.create(docWithEmbedding);
      successCount++;
      
      if (successCount % 5 === 0) {
        process.stdout.write(`  ${successCount}/${documents.length} completed\r`);
      }
    } catch (error) {
      console.error(`  Error inserting document ${doc.id}:`, error.message);
    }
  }
  
  console.log(`  ✓ ${successCount}/${documents.length} documents inserted`);
  return successCount;
}

/**
 * Generate test queries
 */
function generateTestQueries() {
  return [
    "How do vector databases work?",
    "What are the best practices for semantic search?",
    "Explain machine learning embeddings",
    "How to optimize cloud database performance?",
    "What is retrieval augmented generation?"
  ];
}

/**
 * Execute vector similarity query
 */
async function executeVectorQuery(container, queryEmbedding, topK = 10) {
  const querySpec = {
    query: `SELECT TOP @topK 
              c.id, 
              c.title, 
              c.category,
              VectorDistance(c.embedding, @embedding) AS similarity 
            FROM c 
            ORDER BY VectorDistance(c.embedding, @embedding)`,
    parameters: [
      { name: "@embedding", value: queryEmbedding },
      { name: "@topK", value: topK }
    ]
  };
  
  const startTime = Date.now();
  const { resources, requestCharge } = await container.items.query(querySpec).fetchAll();
  const latency = Date.now() - startTime;
  
  return {
    results: resources,
    latency,
    requestCharge
  };
}

/**
 * Calculate recall between two result sets
 */
function calculateRecall(groundTruth, testResults, k = 10) {
  const groundTruthIds = new Set(groundTruth.slice(0, k).map(r => r.id));
  const testResultIds = new Set(testResults.slice(0, k).map(r => r.id));
  
  const intersection = [...testResultIds].filter(id => groundTruthIds.has(id));
  const recall = intersection.length / Math.min(k, groundTruth.length);
  
  return {
    recall: recall,
    matchCount: intersection.length,
    totalRelevant: Math.min(k, groundTruth.length)
  };
}

/**
 * Run benchmark for a specific algorithm
 */
async function runAlgorithmBenchmark(container, algorithmName, testQueries, groundTruthResults = null) {
  console.log(`\n--- Benchmarking ${algorithmName} ---`);
  
  const results = {
    algorithm: algorithmName,
    queries: [],
    avgLatency: 0,
    avgRU: 0,
    avgRecall: null,
    totalQueries: testQueries.length
  };
  
  for (let i = 0; i < testQueries.length; i++) {
    const query = testQueries[i];
    console.log(`\nQuery ${i + 1}/${testQueries.length}: "${query}"`);
    
    try {
      // Generate embedding
      const embedding = await generateEmbedding(query);
      
      // Execute query
      const { results: queryResults, latency, requestCharge } = await executeVectorQuery(
        container, 
        embedding, 
        config.benchmark.topK
      );
      
      // Calculate recall if ground truth provided
      let recallData = null;
      if (groundTruthResults && groundTruthResults[i]) {
        recallData = calculateRecall(
          groundTruthResults[i].results, 
          queryResults, 
          config.benchmark.topK
        );
        console.log(`  Recall@${config.benchmark.topK}: ${(recallData.recall * 100).toFixed(2)}% (${recallData.matchCount}/${recallData.totalRelevant} matches)`);
      }
      
      console.log(`  Latency: ${latency}ms`);
      console.log(`  RU Charge: ${requestCharge.toFixed(2)} RU/s`);
      console.log(`  Results: ${queryResults.length} documents`);
      
      results.queries.push({
        query,
        latency,
        requestCharge,
        resultCount: queryResults.length,
        recall: recallData,
        topResult: queryResults[0]?.title
      });
      
    } catch (error) {
      console.error(`  Error executing query: ${error.message}`);
    }
  }
  
  // Calculate averages
  results.avgLatency = results.queries.reduce((sum, q) => sum + q.latency, 0) / results.queries.length;
  results.avgRU = results.queries.reduce((sum, q) => sum + q.requestCharge, 0) / results.queries.length;
  
  if (groundTruthResults) {
    const recalls = results.queries.map(q => q.recall?.recall).filter(r => r !== undefined);
    results.avgRecall = recalls.length > 0 
      ? recalls.reduce((sum, r) => sum + r, 0) / recalls.length 
      : null;
  }
  
  return results;
}

/**
 * Display comparison table
 */
function displayComparisonTable(benchmarkResults) {
  console.log("\n" + "=".repeat(80));
  console.log("ALGORITHM COMPARISON SUMMARY");
  console.log("=".repeat(80));
  
  console.log("\n" + "-".repeat(80));
  console.log("Algorithm".padEnd(20) + 
              "Avg Latency".padEnd(15) + 
              "Avg RU/s".padEnd(15) + 
              "Avg Recall".padEnd(15) + 
              "Memory");
  console.log("-".repeat(80));
  
  const algorithmInfo = {
    flat: { memory: "High", searchType: "Exact" },
    quantizedFlat: { memory: "Low", searchType: "Approximate" },
    diskANN: { memory: "Moderate", searchType: "Approximate" }
  };
  
  benchmarkResults.forEach(result => {
    const info = algorithmInfo[result.algorithm] || { memory: "N/A", searchType: "N/A" };
    const recallStr = result.avgRecall !== null 
      ? `${(result.avgRecall * 100).toFixed(2)}%` 
      : "100% (baseline)";
    
    console.log(
      result.algorithm.padEnd(20) +
      `${result.avgLatency.toFixed(2)}ms`.padEnd(15) +
      `${result.avgRU.toFixed(2)}`.padEnd(15) +
      recallStr.padEnd(15) +
      info.memory
    );
  });
  
  console.log("-".repeat(80));
}

/**
 * Display detailed analysis
 */
function displayDetailedAnalysis(benchmarkResults) {
  console.log("\n" + "=".repeat(80));
  console.log("DETAILED PERFORMANCE ANALYSIS");
  console.log("=".repeat(80));
  
  benchmarkResults.forEach(result => {
    console.log(`\n### ${result.algorithm.toUpperCase()} ###`);
    console.log(`Queries tested: ${result.totalQueries}`);
    console.log(`Average latency: ${result.avgLatency.toFixed(2)}ms`);
    console.log(`Average RU consumption: ${result.avgRU.toFixed(2)} RU/s`);
    if (result.avgRecall !== null) {
      console.log(`Average recall@${config.benchmark.topK}: ${(result.avgRecall * 100).toFixed(2)}%`);
    }
    
    // Calculate latency percentiles
    const latencies = result.queries.map(q => q.latency).sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    const p99 = latencies[Math.floor(latencies.length * 0.99)];
    
    console.log("\nLatency percentiles:");
    console.log(`  p50: ${p50}ms`);
    console.log(`  p95: ${p95}ms`);
    console.log(`  p99: ${p99}ms`);
  });
}

/**
 * Display recommendations
 */
function displayRecommendations(benchmarkResults) {
  console.log("\n" + "=".repeat(80));
  console.log("RECOMMENDATIONS");
  console.log("=".repeat(80));
  
  const diskANN = benchmarkResults.find(r => r.algorithm === "diskANN");
  const flat = benchmarkResults.find(r => r.algorithm === "flat");
  const quantized = benchmarkResults.find(r => r.algorithm === "quantizedFlat");
  
  console.log("\n✓ RECOMMENDED: DiskANN");
  console.log("  DiskANN should be used in most scenarios where you have more than a few");
  console.log("  tens of thousands of vectors. It provides the best balance of:");
  if (diskANN) {
    console.log(`  • Performance: ${diskANN.avgLatency.toFixed(2)}ms average latency`);
    if (diskANN.avgRecall) {
      console.log(`  • Accuracy: ${(diskANN.avgRecall * 100).toFixed(2)}% recall (tunable)`);
    }
    console.log(`  • Cost efficiency: ${diskANN.avgRU.toFixed(2)} RU/s per query`);
  }
  console.log("  • Scalability: Excellent for large datasets (millions of vectors)");
  
  console.log("\n⚠ WHEN TO USE OTHER ALGORITHMS:");
  console.log("\n  Flat Index:");
  console.log("    • Dataset size: < 10,000 vectors only");
  console.log("    • Requirement: Absolute 100% recall needed");
  console.log("    • Note: Almost no real-world use case; DiskANN is usually better");
  
  console.log("\n  QuantizedFlat Index:");
  console.log("    • Scenario: Memory-constrained environments (edge deployments)");
  if (quantized) {
    console.log(`    • Memory benefit: ~60% reduction vs. Flat index`);
    if (quantized.avgRecall) {
      console.log(`    • Trade-off: ${(quantized.avgRecall * 100).toFixed(2)}% recall`);
    }
  }
  
  console.log("\n📊 TUNING GUIDANCE:");
  console.log("  For DiskANN, adjust efSearch parameter based on requirements:");
  console.log("  • Default (efSearch=40): Good balance for most workloads");
  console.log("  • Higher recall (efSearch=80-100): Better accuracy, slower queries");
  console.log("  • Lower latency (efSearch=20-30): Faster queries, reduced accuracy");
  
  console.log("\n🎯 DECISION TREE:");
  console.log("  Dataset > 10,000 vectors?");
  console.log("    ├─ YES → Use DiskANN ✓ (recommended)");
  console.log("    └─ NO  → Still use DiskANN for consistency and future growth");
  console.log("");
  console.log("  Memory constrained?");
  console.log("    └─ YES → Consider QuantizedFlat (edge scenarios only)");
}

/**
 * Create database
 */
async function createDatabase() {
  const { database } = await cosmosClient.databases.createIfNotExists({
    id: config.cosmos.databaseId
  });
  return database;
}

/**
 * Main execution
 */
async function main() {
  console.log("=".repeat(80));
  console.log("Azure Cosmos DB - Vector Index Algorithms Benchmark");
  console.log("=".repeat(80));
  
  try {
    // Step 1: Create database
    console.log("\n[1/7] Creating database...");
    const database = await createDatabase();
    console.log(`✓ Database: ${database.id}`);
    
    // Step 2: Generate test data
    console.log("\n[2/7] Generating test dataset...");
    const testDataset = generateTestDataset();
    console.log(`✓ Generated ${testDataset.length} test documents`);
    
    // Step 3: Create containers for each algorithm
    console.log("\n[3/7] Creating containers with different algorithms...");
    const containerFlat = await createContainerWithAlgorithm(database, "flat");
    console.log(`✓ Created container: ${containerFlat.id}`);
    
    const containerQuantized = await createContainerWithAlgorithm(database, "quantizedFlat");
    console.log(`✓ Created container: ${containerQuantized.id}`);
    
    const containerDiskANN = await createContainerWithAlgorithm(database, "diskANN");
    console.log(`✓ Created container: ${containerDiskANN.id}`);
    
    // Step 4: Insert data into all containers
    console.log("\n[4/7] Inserting test data into all containers...");
    await insertDocuments(containerFlat, testDataset);
    await insertDocuments(containerQuantized, testDataset);
    await insertDocuments(containerDiskANN, testDataset);
    
    // Step 5: Generate test queries
    console.log("\n[5/7] Generating test queries...");
    const testQueries = generateTestQueries();
    console.log(`✓ Generated ${testQueries.length} test queries`);
    
    // Step 6: Run benchmarks
    console.log("\n[6/7] Running benchmarks...");
    console.log("=".repeat(80));
    
    // Benchmark Flat (ground truth)
    const flatResults = await runAlgorithmBenchmark(containerFlat, "flat", testQueries);
    
    // Benchmark QuantizedFlat (compare to ground truth)
    const quantizedResults = await runAlgorithmBenchmark(
      containerQuantized, 
      "quantizedFlat", 
      testQueries,
      flatResults.queries
    );
    
    // Benchmark DiskANN (compare to ground truth)
    const diskANNResults = await runAlgorithmBenchmark(
      containerDiskANN, 
      "diskANN", 
      testQueries,
      flatResults.queries
    );
    
    const allResults = [flatResults, quantizedResults, diskANNResults];
    
    // Step 7: Display results
    console.log("\n[7/7] Analysis complete");
    
    displayComparisonTable(allResults);
    displayDetailedAnalysis(allResults);
    displayRecommendations(allResults);
    
    console.log("\n" + "=".repeat(80));
    console.log("✓ Benchmark completed successfully");
    console.log("=".repeat(80));
    
    console.log("\n💡 Next Steps:");
    console.log("  • Review the recommendations above");
    console.log("  • Test DiskANN with your production data");
    console.log("  • Tune efSearch parameter based on your SLOs");
    console.log("  • Monitor recall and latency in production");
    
    console.log("\n🧹 Cleanup:");
    console.log("  To delete test containers, run the cleanup script or manually delete:");
    console.log(`  • ${containerFlat.id}`);
    console.log(`  • ${containerQuantized.id}`);
    console.log(`  • ${containerDiskANN.id}`);
    
  } catch (error) {
    console.error("\n✗ Error:", error.message);
    console.error(error);
    process.exit(1);
  }
}

// Run the benchmark
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  generateEmbedding,
  createContainerWithAlgorithm,
  executeVectorQuery,
  calculateRecall,
  runAlgorithmBenchmark
};
