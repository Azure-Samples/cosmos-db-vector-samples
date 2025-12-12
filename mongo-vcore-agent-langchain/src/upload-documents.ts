import { createClientsPasswordless, createClients } from './utils/clients.js';
import { getStore } from './vector-store.js';

/**
 * Upload documents to Azure Cosmos DB MongoDB Vector Store
 */

async function uploadDocuments() {
  try {
    console.log('Starting document upload...\n');

    // Get clients based on authentication mode
    const usePasswordless = process.env.USE_PASSWORDLESS === 'true' || process.env.USE_PASSWORDLESS === '1';
    console.log(`Authentication mode: ${usePasswordless ? 'Passwordless (Azure AD)' : 'API Key'}`);
    
    console.log('\nEnvironment variables check:');
    console.log(`  DATA_FILE_WITHOUT_VECTORS: ${process.env.DATA_FILE_WITHOUT_VECTORS}`);
    console.log(`  MONGO_DB_NAME: ${process.env.MONGO_DB_NAME}`);
    console.log(`  MONGO_DB_COLLECTION: ${process.env.MONGO_DB_COLLECTION}`);
    console.log(`  MONGO_CLUSTER_NAME: ${process.env.MONGO_CLUSTER_NAME}`);
    console.log(`  AZURE_OPENAI_EMBEDDING_DEPLOYMENT: ${process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT}`);
    
    const clients = usePasswordless ? createClientsPasswordless() : createClients();
    const { embeddingClient, dbConfig } = clients;

    console.log('\ndbConfig properties:');
    console.log(`  instance: ${dbConfig.instance}`);
    console.log(`  databaseName: ${dbConfig.databaseName}`);
    console.log(`  collectionName: ${dbConfig.collectionName}`);

    // Check for data file path
    const dataFilePath = process.env.DATA_FILE_WITHOUT_VECTORS;
    if (!dataFilePath) {
      throw new Error('DATA_FILE_WITHOUT_VECTORS environment variable is required');
    }

    console.log(`\nReading data from: ${dataFilePath}`);
    console.log(`Database: ${dbConfig.databaseName}`);
    console.log(`Collection: ${dbConfig.collectionName}`);
    console.log(`Vector algorithm: ${process.env.VECTOR_INDEX_ALGORITHM || 'vector-ivf'}\n`);

    // Upload documents using existing getStore function
    const startTime = Date.now();
    const store = await getStore(dataFilePath, embeddingClient, dbConfig);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log(`\n✓ Upload completed in ${duration} seconds`);

    // Close connection
    await store.close();
    console.log('✓ Connection closed');
    
    // Force exit to ensure process terminates (Azure credential timers may still be active)
    process.exit(0);

  } catch (error: any) {
    console.error('\n✗ Upload failed:', error?.message || error);
    console.error('\nFull error:', error);
    process.exit(1);
  }
}

// Run the upload
uploadDocuments();