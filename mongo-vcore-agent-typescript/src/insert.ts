/**
 * Insert hotel data into Cosmos DB MongoDB vCore
 * Creates database, collection, and inserts data with embeddings
 */

import path from 'path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { readFileReturnJson, getClients, insertData } from './utils.js';

// ESM specific features - create __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log(process.env);

// ============================================================================
// Configuration
// ============================================================================

const config = {
    // Database configuration
    dbName: process.env.MONGO_DB_NAME!,

    // Data file path (relative to project root)
    dataFile: process.env.DATA_FILE_WITH_VECTORS!,

    // Batch configuration
    batchSize: parseInt(process.env.LOAD_SIZE_BATCH!, 10),

    // Vector configuration
    embeddedField: process.env.EMBEDDED_FIELD!,
    embeddingDimensions: parseInt(process.env.EMBEDDING_DIMENSIONS!, 10),

    // Collections with their respective algorithms
    collections: [
        {
            name: 'hotels_ivf',
            indexName: 'vectorIndex_ivf',
            algorithm: 'ivf' as const,
            vectorIndexOptions: {
                createIndexes: 'hotels_ivf',
                indexes: [
                    {
                        name: 'vectorIndex_ivf',
                        key: {
                            [process.env.EMBEDDED_FIELD!]: 'cosmosSearch'
                        },
                        cosmosSearchOptions: {
                            kind: 'vector-ivf',
                            numLists: 10,
                            similarity: 'COS',
                            dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS!, 10)
                        }
                    }
                ]
            }
        },
        // {
        //     name: 'hotels_hnsw',
        //     indexName: 'vectorIndex_hnsw',
        //     algorithm: 'hnsw' as const,
        //     vectorIndexOptions: {
        //         createIndexes: 'hotels_hnsw',
        //         indexes: [
        //             {
        //                 name: 'vectorIndex_hnsw',
        //                 key: {
        //                     [process.env.EMBEDDED_FIELD!]: 'cosmosSearch'
        //                 },
        //                 cosmosSearchOptions: {
        //                     kind: 'vector-hnsw',
        //                     m: 16, // 2 - 100, default = 16, number of connections per layer
        //                     efConstruction: 64, // 4 - 1000, default=64, size of the dynamic candidate list for constructing the graph
        //                     similarity: 'COS', // 'COS', 'L2', 'IP'
        //                     dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS!, 10)
        //                 }
        //             }
        //         ]
        //     }
        // },
        // {
        //     name: 'hotels_diskann',
        //     indexName: 'vectorIndex_diskann',
        //     algorithm: 'diskann' as const,
        //     vectorIndexOptions: {
        //         createIndexes: 'hotels_diskann',
        //         indexes: [
        //             {
        //                 name: 'vectorIndex_diskann',
        //                 key: {
        //                     [process.env.EMBEDDED_FIELD!]: 'cosmosSearch'
        //                 },
        //                 cosmosSearchOptions: {
        //                     kind: 'vector-diskann',
        //                     maxDegree: 20, // 20 - 2048, edges per node
        //                     lBuild: 10, // 10 - 500, candidate neighbors evaluated
        //                     similarity: 'COS', // 'COS', 'L2', 'IP'
        //                     dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS!, 10)
        //                 }
        //             }
        //         ]
        //     }
        // }
    ]
};

// // Create the vector index
// const indexOptions = {
//     createIndexes: config.collectionName,
//     indexes: [
//         
//     ]
// };
// const vectorIndexSummary = await db.command(indexOptions);
console.log(config.dataFile);
console.log(__dirname)
const newPath = path.join(__dirname, "../../../", config.dataFile);
config.dataFile = newPath;

// ============================================================================
// Main Insert Process
// ============================================================================

async function main() {
    console.log('🚀 Starting data insertion process\n');
    console.log('Configuration:');
    console.log(`  Database: ${config.dbName}`);
    console.log(`  Collections: ${config.collections.map(c => c.name).join(', ')}`);
    console.log(`  Batch Size: ${config.batchSize}`);
    console.log(`  Data File: ${config.dataFile}\n`);

    // Initialize clients
    const { dbClient } = getClients();

    if (!dbClient) {
        throw new Error('❌ Database client is not configured. Please check your environment variables.');
    }

    try {
        // Connect to database
        console.log('📡 Connecting to Cosmos DB...');
        await dbClient.connect();
        console.log('✓ Connected to Cosmos DB\n');

        // Get or create database
        const db = dbClient.db(config.dbName);
        console.log(`📂 Using database: ${config.dbName}\n`);

        // Read data file once (will be reused for all collections)
        console.log(`📖 Reading data file...`);
        const data = await readFileReturnJson(config.dataFile);
        console.log(`✓ Read ${data.length} hotel records\n`);

        // Process each collection
        for (const collectionConfig of config.collections) {
            console.log(`${'='.repeat(70)}`);
            console.log(`Processing Collection: ${collectionConfig.name}`);
            console.log(`Algorithm: ${collectionConfig.algorithm.toUpperCase()}`);
            console.log(`${'='.repeat(70)}\n`);

            // Drop collection if it exists (for clean insert)
            try {
                await db.collection(collectionConfig.name).drop();
                console.log(`✓ Dropped existing collection: ${collectionConfig.name}`);
            } catch (error: any) {
                if (error.codeName === 'NamespaceNotFound') {
                    console.log(`ℹ️  Collection does not exist yet: ${collectionConfig.name}`);
                } else {
                    console.warn(`⚠️  Warning dropping collection: ${error.message}`);
                }
            }

            // Create collection
            console.log(`\n📦 Creating collection: ${collectionConfig.name}`);
            const collection = await db.createCollection(collectionConfig.name);
            console.log('✓ Collection created');

            // Insert data
            console.log(`\n📥 Inserting data in batches of ${config.batchSize}...`);
            const insertSummary = await insertData(config, collectionConfig,db, collection, data);

            console.log('\n📊 Insert Summary:');
            console.log(`  Total records: ${insertSummary.total}`);
            console.log(`  Successfully inserted: ${insertSummary.inserted}`);
            console.log(`  Failed: ${insertSummary.failed}`);
            console.log(`  Skipped: ${insertSummary.skipped}`);

            if (insertSummary.failed > 0) {
                console.warn(`\n⚠️  Warning: ${insertSummary.failed} records failed to insert`);
            }

            // Create vector index
            console.log(`\n🔍 Creating ${collectionConfig.algorithm.toUpperCase()} vector index...`);
        }

        console.log(`${'='.repeat(70)}`);
        console.log('✅ All collections created and indexed successfully!');
        console.log(`${'='.repeat(70)}\n`);

        console.log('📝 Summary:');
        config.collections.forEach(c => {
            console.log(`  ✓ ${c.name} (${c.algorithm.toUpperCase()}) - ${c.indexName}`);
        });

        console.log('\n📝 Next steps:');
        console.log('  1. Wait 1-2 minutes for indexes to be fully built');
        console.log('  2. Run the agent: npm run start:answer');
        console.log('  3. The agent will use vector search to find hotels\n');

    } catch (error) {
        console.error('\n❌ Error during insertion:', error);
        throw error;
    } finally {
        // Close connection
        await dbClient.close();
        console.log('✓ Disconnected from Cosmos DB');
    }
}

// ============================================================================
// Run the insert process
// ============================================================================

main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});
