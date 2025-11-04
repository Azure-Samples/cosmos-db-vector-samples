/**
 * Azure Cosmos DB Insert at Scale Operations
 * 
 * This example demonstrates:
 * 1. Enterprise-grade resilient bulk insertion
 * 2. Performance monitoring and optimization
 * 3. Error handling and retry patterns
 * 
 * Key Features: Robust retry logic, RU scaling guidance, document insert operations,
 * performance monitoring, and Azure best practices implementation.
 * 
 * For detailed documentation, see: ./docs/INSERT_AT_SCALE_GUIDE.md
 */
import path from 'path';
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

// Utils imports
import { JsonData, readFileReturnJson, getClientsPasswordless, calculateServerlessRUCost, calculateAutoscaleRUCost, compareAllPricingModels, shouldShowCost } from './utils/utils.js';
import { 
  ensureDatabaseAndContainer
} from './utils/cosmos-operations.js';
import { resilientInsert, DEFAULT_INSERT_CONFIG, InsertConfig, InsertResult } from './utils/cosmos-resiliency.js';

// ESM support
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const config = {
  // Database settings
  databaseName: process.env.COSMOS_DB_NAME || 'Hotels',
  containerName: process.env.COSMOS_CONTAINER_NAME || 'hotels-insert-scale',
  partitionKeyPath: process.env.PARTITION_KEY_PATH || '/HotelId',
  
  // Data files
  dataFile: process.env.DATA_FILE_WITH_VECTORS || '../../data/HotelsData_toCosmosDB_Vector.json',
  
  // Vector settings (for documents that already have embeddings)
  embeddingField: process.env.EMBEDDED_FIELD || 'text_embedding_ada_002',
  embeddingDimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || '1536', 10),
  
  // Insert settings
  batchSize: parseInt(process.env.BATCH_SIZE || '50', 10),
  maxConcurrency: parseInt(process.env.MAX_CONCURRENCY || '-1', 10)
};

// -------------------------------------------
// Data Loading Functions
// -------------------------------------------

/**
 * Load JSON data from file
 */
async function loadData(): Promise<JsonData[]> {
  console.log('\n📊 Step 1: Loading Data');
  console.log('=======================');

  const dataPath = path.join(__dirname, config.dataFile);
  
  try {
    const data = await readFileReturnJson(dataPath);
    console.log(`✅ Loaded ${data.length} documents from ${config.dataFile}`);
    
    // Validate that documents contain the expected embedding field
    console.log(`🔍 Validating that documents contain embedding field '${config.embeddingField}'...`);
    const missingEmbeddings = data.filter(doc => 
      !doc[config.embeddingField] || 
      !Array.isArray(doc[config.embeddingField]) ||
      doc[config.embeddingField].length === 0
    );
    
    if (missingEmbeddings.length > 0) {
      throw new Error(
        `❌ ${missingEmbeddings.length} out of ${data.length} documents are missing or have invalid embedding field '${config.embeddingField}'. ` +
        `Expected an array of numbers with ${config.embeddingDimensions} dimensions.`
      );
    }
    
    // Validate embedding dimensions
    const firstEmbedding = data[0][config.embeddingField];
    if (firstEmbedding.length !== config.embeddingDimensions) {
      console.warn(`⚠️  Warning: Expected ${config.embeddingDimensions} dimensions but found ${firstEmbedding.length} in first document`);
    }
    
    console.log(`✅ All documents contain valid embedding field '${config.embeddingField}' with ${firstEmbedding.length} dimensions`);
    return data;
  } catch (error) {
    console.error(`❌ Failed to load data from ${config.dataFile}:`, error);
    throw error;
  }
}

// -------------------------------------------
// Main Execution Functions
// -------------------------------------------

/**
 * Step 2: Perform resilient bulk insert
 */
async function performResilientInsert(client: any, data: JsonData[]): Promise<InsertResult> {
  console.log('\n🚀 Step 2: Enterprise-Grade Bulk Insert');
  console.log('======================================');

  // Configuration for resilient insert
  const insertConfig: InsertConfig = {
    ...DEFAULT_INSERT_CONFIG,
    batchSize: config.batchSize,
    maxConcurrency: config.maxConcurrency,
    partitionKeyPath: config.partitionKeyPath
  };

  console.log(`Configuration:`);
  console.log(`  - Database: ${config.databaseName}`);
  console.log(`  - Container: ${config.containerName}`);
  console.log(`  - Batch size: ${insertConfig.batchSize}`);
  console.log(`  - Concurrency: ${insertConfig.maxConcurrency === -1 ? 'SDK Optimized' : insertConfig.maxConcurrency}`);
  console.log(`  - Documents to insert: ${data.length}`);

  // Ensure database and container exist
  await ensureDatabaseAndContainer(
    client, 
    config.databaseName, 
    config.containerName, 
    config.partitionKeyPath
  );

  // Perform resilient insert
  console.log(`\nStarting resilient insert...`);
  const startTime = Date.now();
  
  const container = client.database(config.databaseName).container(config.containerName);
  const result = await resilientInsert(
    container,
    data, 
    insertConfig
  );

  const totalTime = Date.now() - startTime;

  // Display comprehensive results
  console.log(`\n✅ Insert Operation Complete:`);
  console.log(`   Inserted: ${result.inserted}/${result.total} documents`);
  console.log(`   Failed: ${result.failed}, Retries: ${result.retried}`);
  console.log(`   Total time: ${(totalTime / 1000).toFixed(1)}s`);
  console.log(`   RU consumed: ${result.metrics.totalRu.toLocaleString()}`);
  console.log(`   Avg RU/doc: ${result.metrics.avgRuPerDoc.toFixed(2)}`);
  console.log(`   Avg latency: ${result.metrics.avgLatencyMs.toFixed(0)}ms/doc`);

  // Show cost estimation for autoscale (only if SHOW_COST=true)
  if (shouldShowCost()) {
    const peakRUsPerSecond = Math.ceil(result.metrics.maxRu); // Use the peak RU observed
    
    console.log(`\n💰 Cost Estimation (Autoscale):`);
    
    // Calculate autoscale cost based on observed usage
    const autoscaleCost = calculateAutoscaleRUCost({
      maxAutoscaleRUs: Math.max(peakRUsPerSecond * 2, 1000), // Estimate needed max RU/s (2x peak + minimum 1000)
      totalRUsConsumed: result.metrics.totalRu,
      days: 30,
      regionCount: 1,
      averageUtilizationPercent: 60 // Conservative estimate
    });
    
    console.log(`   Estimated autoscale cost: $${autoscaleCost.estimatedCost.toFixed(2)}/month`);
    console.log(`   Recommended max autoscale RU/s: ${Math.max(peakRUsPerSecond * 2, 1000)}`);
    console.log(`   Peak RU/s observed: ${result.metrics.maxRu.toFixed(1)}`);
    
    // Also show serverless comparison
    const serverlessCost = calculateServerlessRUCost({
      totalRUs: result.metrics.totalRu,
      regionCount: 1
    });
    
    console.log(`   Serverless comparison: $${serverlessCost.estimatedCost.toFixed(6)} (this operation only)`);
  } else {
    console.log(`   Peak RU/s observed: ${result.metrics.maxRu.toFixed(1)}`);
    console.log(`   💡 Set SHOW_COST=true to see cost estimation`);
  }

  // Show errors if any occurred
  if (Object.keys(result.metrics.errorCounts).length > 0) {
    console.log(`\n⚠️  Errors encountered:`);
    for (const [errorCode, count] of Object.entries(result.metrics.errorCounts)) {
      console.log(`   ${errorCode}: ${count} occurrences`);
    }
    if (result.metrics.errorCounts['429']) {
      const peakRUsPerSecond = Math.ceil(result.metrics.maxRu);
      console.log(`   💡 Autoscale Tips:`);
      console.log(`      - Your current max autoscale RU/s may be too low`);
      console.log(`      - Autoscale takes 10-30 seconds to scale up`);
      console.log(`      - Consider increasing max autoscale RU/s to ${Math.max(peakRUsPerSecond * 3, 1000)}`);
      console.log(`      - Or reduce batch size further (currently ${config.batchSize})`);
    }
  }

  return result;
}

/**
 * Step 3: Performance analysis and recommendations
 */
async function showPerformanceAnalysis(insertResult: InsertResult): Promise<void> {
  console.log('\n📈 Step 3: Performance Analysis');
  console.log('==============================');

  const { metrics } = insertResult;
  
  // RU consumption analysis
  console.log(`RU Consumption Analysis:`);
  console.log(`  - Total RUs: ${metrics.totalRu.toLocaleString()}`);
  console.log(`  - Average RU/document: ${metrics.avgRuPerDoc.toFixed(2)}`);
  console.log(`  - Peak RU/operation: ${metrics.maxRu.toFixed(2)}`);
  
  // Performance analysis
  console.log(`\nPerformance Metrics:`);
  console.log(`  - Total duration: ${(metrics.totalDurationMs / 1000).toFixed(1)}s`);
  console.log(`  - Average latency: ${metrics.avgLatencyMs.toFixed(0)}ms/document`);
  console.log(`  - Peak latency: ${metrics.maxLatencyMs.toFixed(0)}ms`);
  console.log(`  - Throughput: ${(insertResult.total / (metrics.totalDurationMs / 1000)).toFixed(1)} docs/second`);

  // Recommendations
  console.log(`\nOptimization Recommendations:`);
  
  if (metrics.avgRuPerDoc > 10) {
    console.log(`  ⚠️  High RU consumption per document (${metrics.avgRuPerDoc.toFixed(2)} RU/doc)`);
    console.log(`     - Consider document size optimization`);
    console.log(`     - Review indexing policies`);
  }
  
  if (metrics.avgLatencyMs > 1000) {
    console.log(`  ⚠️  High average latency (${metrics.avgLatencyMs.toFixed(0)}ms)`);
    console.log(`     - Consider increasing provisioned RU/s`);
    console.log(`     - Check regional proximity`);
  }
  
  if (Object.keys(metrics.errorCounts).length === 0) {
    console.log(`  ✅ No errors encountered - excellent reliability!`);
  }
  
  console.log(`  💡 For detailed optimization guidance, see INSERT_AT_SCALE_GUIDE.md`);
}

/**
 * Main execution function - orchestrates the complete workflow
 */
async function main() {
  console.log('🏨 Azure Cosmos DB Insert at Scale Operations');
  console.log('==============================================');
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);

  try {
    // Initialize Cosmos DB client only
    const { dbClient } = getClientsPasswordless();
    //const { dbClient } = getClients();

    if (!dbClient) {
      throw new Error('❌ Cosmos DB client is not configured properly. Please check your Cosmos DB environment variables.');
    }

    console.log('✅ Cosmos DB client initialized successfully');
    
    // Debug: Show connection details (without sensitive info)
    console.log(`🔍 Connection Details:`);
    console.log(`   Database: ${config.databaseName}`);
    console.log(`   Container: ${config.containerName}`);
    console.log(`   Partition Key Path: ${config.partitionKeyPath}`);
    console.log(`   Batch Size: ${config.batchSize}`);
    console.log(`   Max Concurrency: ${config.maxConcurrency === -1 ? 'SDK Optimized' : config.maxConcurrency}`);

    // Step 1: Load data
    const data = await loadData();

    // Step 2: Perform resilient bulk insert
    const insertResult = await performResilientInsert(dbClient, data);

    // Step 3: Show performance analysis
    await showPerformanceAnalysis(insertResult);

    console.log('\n🎉 All Operations Completed Successfully!');
    console.log('========================================');
    console.log(`✅ ${data.length} documents inserted with resilience`);
    console.log(`✅ Performance metrics captured`);
    
    console.log(`\n📚 Next Steps:`);
    console.log(`  - Review the performance metrics above`);
    console.log(`  - Adjust batch sizes and concurrency based on your RU provisioning`);
    console.log(`  - Implement the patterns in your production workloads`);
    console.log(`  - Monitor RU consumption and optimize accordingly`);
    
    console.log(`\n📖 For detailed documentation, see INSERT_AT_SCALE_GUIDE.md`);

    // Properly dispose of Cosmos client to allow clean process termination
    if (dbClient) {
      await dbClient.dispose();
      console.log('✅ Cosmos DB client disposed successfully');
    }

  } catch (error) {
    console.error("❌ Fatal error in insert operations:", error);
    process.exit(1);
  }
}

// Export individual functions for modular use
export {
  loadData,
  performResilientInsert,
  showPerformanceAnalysis
};

// Run main function if this file is executed directly
//if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
//}