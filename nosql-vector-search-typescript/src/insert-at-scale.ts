/**
 * Enterprise-grade resilient document insertion for Azure Cosmos DB
 * 
 * For comprehensive documentation, see: ./docs/INSERT_AT_SCALE_GUIDE.md
 * 
 * Key Features: Robust retry logic, RU scaling guidance, vector document support,
 * performance monitoring, and Azure best practices implementation.
 */
import { JsonData, readFileReturnJson, getClientsPasswordless } from './utils.js';
import { resilientInsert, ensureDatabaseAndContainer } from './cosmos-operations.js';
import { DEFAULT_INSERT_CONFIG } from './interfaces.js';

/**
 * Main execution function demonstrating Azure Cosmos DB bulk insert best practices
 * See INSERT_AT_SCALE_GUIDE.md for comprehensive documentation
 */
async function main() {

  // Create Cosmos client as singleton per account and application
  const { dbClient: client } = getClientsPasswordless();

  if (!client) {
    throw new Error('Cosmos DB client is not configured properly. Please check your environment variables.');
  }

  // Database and container names
  const databaseName = 'Hotels';
  const containerName = 'hotels-at-scale-2';
  const config = {
    ...DEFAULT_INSERT_CONFIG,
    batchSize: 50,
    maxRetries: 3,
    maxConcurrency: -1 // Let client/SDK maximize parallelism
  };

  console.log(`Using database ${databaseName}, container ${containerName}`);
  console.log(`Configuration: ${config.maxConcurrency} concurrency, ${config.batchSize} batch size`);
  
  try {
    // Ensure database and container exist
    const { container } = await ensureDatabaseAndContainer(
      client, 
      databaseName, 
      containerName, 
      config.partitionKeyPath
    );

    // Load and insert data
    const dataPath = process.env.DATA_FILE_WITH_VECTORS || '../../data/HotelsData_toCosmosDB_Vector.json';
    console.log(`Loading data from ${dataPath}...`);
    const data = await readFileReturnJson(dataPath);

    console.log(`Starting insert of ${data.length} documents...`);
    const result = await resilientInsert(container, data, config);

    // Show operation results
    console.log(`\n✅ Operation Complete:`);
    console.log(`   Inserted: ${result.inserted}/${result.total} documents`);
    console.log(`   Failed: ${result.failed}, Retries: ${result.retried}`);
    console.log(`   RU consumed: ${result.metrics.totalRu.toLocaleString()}`);
    console.log(`   Duration: ${(result.metrics.totalDurationMs / 1000).toFixed(1)}s`);
    
    // Show errors if any occurred
    if (Object.keys(result.metrics.errorCounts).length > 0) {
      console.log(`\n⚠️  Errors encountered:`);
      for (const [errorCode, count] of Object.entries(result.metrics.errorCounts)) {
        console.log(`   ${errorCode}: ${count} occurrences`);
      }
      if (result.metrics.errorCounts['429']) {
        console.log(`   📖 See INSERT_AT_SCALE_GUIDE.md for throttling solutions`);
      }
    }
    
    console.log(`\n📖 For detailed guidance, see INSERT_AT_SCALE_GUIDE.md`);
  } catch (err: any) {
    throw err; // Error details handled in ensureDatabaseAndContainer
  }
}

main().catch(console.error);