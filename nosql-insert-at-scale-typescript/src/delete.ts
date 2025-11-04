/**
 * Azure Cosmos DB Delete All Documents Operations
 * 
 * This example demonstrates:
 * 1. Querying all documents in a container
 * 2. Enterprise-grade resilient bulk deletion
 * 3. Performance monitoring and optimization
 * 4. Error handling and retry patterns
 * 
 * Key Features: Robust retry logic, RU scaling guidance, bulk delete operations,
 * performance monitoring, and Azure best practices implementation.
 */
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

// Utils imports
import { getClientsPasswordless, calculateServerlessRUCost, calculateAutoscaleRUCost, shouldShowCost } from './utils/utils.js';
import { 
  ensureDatabaseAndContainer,
  queryAllDocumentRefs
} from './utils/cosmos-operations.js';
import { resilientDelete, DEFAULT_INSERT_CONFIG, InsertConfig, InsertResult } from './utils/cosmos-resiliency.js';
import { Container, CosmosClient } from '@azure/cosmos';
import { MetricsCollector } from './utils/metrics.js';

// ESM support
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const config = {
  // Database settings
  databaseName: process.env.COSMOS_DB_NAME || 'Hotels',
  containerName: process.env.COSMOS_CONTAINER_NAME || 'hotels-insert-scale',
  partitionKeyPath: process.env.PARTITION_KEY_PATH || '/HotelId',
  
  // Delete settings
  batchSize: parseInt(process.env.BATCH_SIZE || '100', 10), // Larger batch for deletes
  maxConcurrency: parseInt(process.env.MAX_CONCURRENCY || '-1', 10)
};

// -------------------------------------------
// Document Query Functions
// -------------------------------------------

/**
 * Query all documents in the container
 */
async function queryAllDocuments(container: Container): Promise<{ id: string, partitionKey: any }[]> {
  console.log('\n📊 Step 1: Querying All Documents');
  console.log('==================================');

  try {
    const documentRefs = await queryAllDocumentRefs(container, config.partitionKeyPath);
    
    if (documentRefs.length === 0) {
      console.log(`ℹ️  Container is already empty`);
    }

    return documentRefs;
  } catch (error) {
    console.error(`❌ Failed to query documents:`, error);
    throw error;
  }
}

// -------------------------------------------
// Delete Functions
// -------------------------------------------

/**
 * Step 2: Perform resilient bulk delete
 */
async function performResilientDelete(client: CosmosClient, documentRefs: { id: string, partitionKey: any }[]): Promise<InsertResult> {
  console.log('\n🗑️  Step 2: Enterprise-Grade Bulk Delete');
  console.log('=======================================');

  if (documentRefs.length === 0) {
    console.log('ℹ️  No documents to delete');
    return {
      total: 0,
      inserted: 0, // Using 'inserted' for 'deleted' to maintain interface consistency
      failed: 0,
      retried: 0,
      metrics: { 
        totalRu: 0, 
        totalDurationMs: 0, 
        maxRu: 0, 
        avgRuPerDoc: 0, 
        avgLatencyMs: 0,
        maxLatencyMs: 0,
        errorCounts: {}
      },
      metricsCollector: new MetricsCollector()
    };
  }

  // Configuration for resilient delete
  const deleteConfig: InsertConfig = {
    ...DEFAULT_INSERT_CONFIG,
    batchSize: config.batchSize,
    maxConcurrency: config.maxConcurrency,
    partitionKeyPath: config.partitionKeyPath
  };

  console.log(`Configuration:`);
  console.log(`  - Database: ${config.databaseName}`);
  console.log(`  - Container: ${config.containerName}`);
  console.log(`  - Batch size: ${deleteConfig.batchSize}`);
  console.log(`  - Concurrency: ${deleteConfig.maxConcurrency === -1 ? 'SDK Optimized' : deleteConfig.maxConcurrency}`);
  console.log(`  - Documents to delete: ${documentRefs.length}`);

  // Get container
  const container = client.database(config.databaseName).container(config.containerName);

  // Perform resilient bulk delete
  console.log(`\nStarting resilient delete...`);
  const startTime = Date.now();
  
  const result = await resilientDelete(container, documentRefs, deleteConfig);
  const totalTime = Date.now() - startTime;

  // Display comprehensive results
  console.log(`\n✅ Delete Operation Complete:`);
  console.log(`   Deleted: ${result.inserted}/${documentRefs.length} documents`); // Using 'inserted' for 'deleted'
  console.log(`   Failed: ${result.failed}, Retries: ${result.retried}`);
  console.log(`   Total time: ${(totalTime / 1000).toFixed(1)}s`);
  console.log(`   RU consumed: ${result.metrics.totalRu.toLocaleString()}`);
  console.log(`   Avg RU/doc: ${result.metrics.avgRuPerDoc.toFixed(2)}`);
  console.log(`   Avg latency: ${result.metrics.avgLatencyMs.toFixed(0)}ms/doc`);

  // Show cost estimation for autoscale (only if SHOW_COST=true)
  if (shouldShowCost()) {
    const peakRUsPerSecond = Math.ceil(result.metrics.maxRu);
    
    console.log(`\n💰 Cost Estimation (Delete Operation):`);
    
    // Calculate autoscale cost based on observed usage
    const autoscaleCost = calculateAutoscaleRUCost({
      maxAutoscaleRUs: Math.max(peakRUsPerSecond * 2, 1000),
      totalRUsConsumed: result.metrics.totalRu,
      days: 30,
      regionCount: 1,
      averageUtilizationPercent: 60
    });
    
    console.log(`   Estimated autoscale cost: $${autoscaleCost.estimatedCost.toFixed(2)}/month`);
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
      console.log(`      - Consider increasing max autoscale RU/s to ${Math.max(peakRUsPerSecond * 3, 1000)}`);
      console.log(`      - Or reduce batch size further (currently ${config.batchSize})`);
    }
  }

  return result;
}

// -------------------------------------------
// Performance Analysis Functions
// -------------------------------------------

/**
 * Step 3: Show performance analysis
 */
async function showPerformanceAnalysis(deleteResult: InsertResult): Promise<void> {
  console.log('\n📈 Step 3: Performance Analysis');
  console.log('===============================');
  
  console.log(`RU Consumption Analysis:`);
  console.log(`  - Total RUs: ${deleteResult.metrics.totalRu.toLocaleString()}`);
  console.log(`  - Average RU/document: ${deleteResult.metrics.avgRuPerDoc.toFixed(2)}`);
  console.log(`  - Peak RU/operation: ${deleteResult.metrics.maxRu.toFixed(2)}`);
  
  console.log(`\nPerformance Metrics:`);
  console.log(`  - Total duration: ${(deleteResult.metrics.totalDurationMs / 1000).toFixed(1)}s`);
  console.log(`  - Average latency: ${deleteResult.metrics.avgLatencyMs.toFixed(0)}ms/document`);
  console.log(`  - Peak latency: ${deleteResult.metrics.maxLatencyMs || 0}ms`);
  
  if (deleteResult.inserted > 0) { // Using 'inserted' field for 'deleted'
    const throughput = deleteResult.inserted / (deleteResult.metrics.totalDurationMs / 1000);
    console.log(`  - Throughput: ${throughput.toFixed(1)} docs/second`);
  }
  
  console.log(`\nOptimization Recommendations:`);
  if (deleteResult.metrics.avgRuPerDoc > 10) {
    console.log(`  ⚠️  High RU consumption per document (${deleteResult.metrics.avgRuPerDoc.toFixed(2)} RU/doc)`);
    console.log(`     - Consider optimizing query patterns`);
  }
  if (deleteResult.metrics.errorCounts && deleteResult.metrics.errorCounts['429']) {
    console.log(`  ⚠️  Rate limiting detected - consider increasing batch delays`);
  }
  console.log(`  💡 For detailed optimization guidance, see documentation`);
}

// -------------------------------------------
// Main Function
// -------------------------------------------

async function main(): Promise<void> {
  console.log('🗑️  Azure Cosmos DB Delete All Documents Operations');
  console.log('==================================================');
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);

  try {
    // Initialize Cosmos DB client
    const { dbClient } = getClientsPasswordless();

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

    // Ensure database and container exist
    await ensureDatabaseAndContainer(
      dbClient, 
      config.databaseName, 
      config.containerName, 
      config.partitionKeyPath
    );

    const container = dbClient.database(config.databaseName).container(config.containerName);

    // Step 1: Query all documents
    const documentRefs = await queryAllDocuments(container);

    if (documentRefs.length === 0) {
      console.log('\n✅ Container is already empty - nothing to delete');
      return;
    }

    // Confirmation prompt simulation (in real scenario, you might want actual user input)
    console.log(`\n⚠️  WARNING: This will delete ALL ${documentRefs.length} documents in the container!`);
    console.log(`   Database: ${config.databaseName}`);
    console.log(`   Container: ${config.containerName}`);
    console.log(`   This action cannot be undone.`);
    console.log(`\n   Proceeding with deletion in 3 seconds...`);
    
    // 3 second delay for safety
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Step 2: Perform resilient bulk delete
    const deleteResult = await performResilientDelete(dbClient, documentRefs);

    // Step 3: Show performance analysis
    await showPerformanceAnalysis(deleteResult);

    console.log('\n🎉 All Operations Completed Successfully!');
    console.log('========================================');
    console.log(`✅ ${deleteResult.inserted} documents deleted with resilience`); // Using 'inserted' field for 'deleted'
    console.log(`✅ Performance metrics captured`);
    
    console.log(`\n📚 Summary:`);
    console.log(`  - Container has been cleared of all documents`);
    console.log(`  - Delete operation completed with retry logic`);
    console.log(`  - RU consumption tracked and analyzed`);
    
    // Properly dispose of Cosmos client to allow clean process termination
    if (dbClient) {
      await dbClient.dispose();
      console.log('✅ Cosmos DB client disposed successfully');
    }

  } catch (error) {
    console.error("❌ Fatal error in delete operations:", error);
    process.exit(1);
  }
}

// Execute main function
main().catch(console.error);