/**
 * Universal Document Insertion and Index Creation Tool
 * 
 * LEARNING OBJECTIVES:
 * - Creating collections and inserting documents at scale
 * - Building vector indexes for different algorithms (IVF, HNSW, DiskANN)
 * - Creating regular indexes for query optimization
 * - Handling batch operations and error recovery
 * - Configuration-driven approach for algorithm flexibility
 */

import path from 'path';
import { 
    readFileReturnJson,
    getClients,
    getClientsPasswordless,
    insertData,
    createVectorIndex,
    createIVFIndexConfig,
    createHNSWIndexConfig,
    createDiskANNIndexConfig,
    SearchConfig,
    performVectorSearch,
    VectorIndexType,
    VectorIndexConfig
} from './utils.js';

// ESM specific features - create __dirname equivalent
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// CONFIGURATION TYPES AND DEFAULTS
// ============================================================================
const config: SearchConfig = {
    dbName: "Hotels26",
    collectionName: "Hotels_Search_27",
    indexName: "vectorIndex_ivf",
    dataFile: process.env.DATA_FILE_WITH_VECTORS!,
    batchSize: parseInt(process.env.LOAD_SIZE_BATCH! || '100', 10),
    embeddedField: process.env.EMBEDDED_FIELD!,
    embeddingDimensions: parseInt(process.env.EMBEDDING_DIMENSIONS!, 10),
    deployment: process.env.AZURE_OPENAI_EMBEDDING_MODEL!,
};


async function main() {
    // Use passwordless authentication (RBAC)
    const { aiClient, dbClient } = getClientsPasswordless();
    
    // Validate clients are configured
    if (!aiClient) {
        throw new Error('❌ AI client is not configured. Please check your environment variables.');
    }
    if (!dbClient) {
        throw new Error('❌ Database client is not configured. Please check your environment variables.');
    }
    
    // Handle process termination signals
    let isShuttingDown = false;
    const gracefulShutdown = async (signal: string) => {
        if (isShuttingDown) return;
        isShuttingDown = true;
        console.log(`\n🚨 Received ${signal}. Shutting down gracefully...`);
        try {
            if (dbClient) {
                await dbClient.close();
                console.log('✅ Database connection closed');
            }
        } catch (error) {
            console.error('❌ Error during shutdown:', error);
        }
        process.exit(0);
    };
    
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    
    try {
        await dbClient.connect();
        console.log('🔗 Connected to MongoDB');

        const data = await readFileReturnJson(path.join(__dirname, "..", config.dataFile!));
            
        const ivfIndexConfig = createIVFIndexConfig(
            config.embeddingDimensions,
            10, // numLists
            'COS' // similarity
        );

        const db = dbClient.db(config.dbName);
        const collection = db.collection(config.collectionName);

        const result = await insertData(config, collection, data);
        const resultIndex = await createVectorIndex(db, config, ivfIndexConfig);

        // wait 2 minutes for index to be ready
        console.log('⏳ Waiting for vector index to be ready...');
        await new Promise(resolve => setTimeout(resolve, 120000));

        const searchResults = await performVectorSearch(aiClient, collection, "quintessential lodging near running trails, eateries, retail", config, 5);

        console.log('\n✅ Data insertion completed successfully!');
        console.log(`📊 Summary:`);
        console.log(`  Total documents inserted: ${result.inserted}`);
        console.log(`  Total vector index created: ${resultIndex.created}`);
        console.log('=== Search Results ===');
        console.log(searchResults);

    } catch (error) {
        console.error('❌ App failed:', error);
        process.exitCode = 1;
    } finally {
        console.log('🔌 Closing database connection...');
        if (dbClient) {
            await dbClient.close();
            console.log('✅ Database connection closed');
        }
        process.exit(process.exitCode || 0);
    }
}

// Execute main function
main().catch(error => {
    console.error('❌ Unhandled error:', error);
    process.exit(1);
});