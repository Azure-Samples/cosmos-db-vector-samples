import path from 'path';
import { 
    readFileReturnJson, 
    printSearchResults,
    completeVectorSearchWorkflow,
    createIVFIndexConfig,
    createHNSWIndexConfig,
    createDiskANNIndexConfig,
    SearchConfig,
    performVectorSearch,
    createVectorIndex,
    getClients
} from './utils.js';

// ESM specific features - create __dirname equivalent
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Example 1: Complete workflow using the high-level function
 */
async function exampleCompleteWorkflow() {
    console.log('=== Example 1: Complete Workflow ===');
    
    const config: SearchConfig = {
        dbName: "ExampleHotels",
        collectionName: "hotels_example",
        indexName: "vectorIndex_example",
        embeddedField: process.env.EMBEDDED_FIELD || "contentVector",
        embeddingDimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || "1536", 10),
        deployment: process.env.AZURE_OPENAI_EMBEDDING_MODEL!,
        batchSize: 100
    };

    const query = "luxury hotel with spa and fitness center";
    
    try {
        // Read data (optional - can pass null if data already exists in collection)
        const dataFile = process.env.DATA_FILE_WITH_VECTORS;
        const data = dataFile ? await readFileReturnJson(path.join(__dirname, "..", dataFile)) : null;
        
        // Create HNSW index configuration
        const hnswIndexConfig = createHNSWIndexConfig(
            config.embeddingDimensions,
            16, // m
            64, // efConstruction
            'COS' // similarity
        );

        // Execute complete workflow
        const { insertSummary, vectorIndexSummary, searchResults } = await completeVectorSearchWorkflow(
            config,
            hnswIndexConfig,
            query,
            data || undefined,
            false, // usePasswordless
            3 // k (number of results)
        );

        console.log('Search completed successfully!');
        printSearchResults(insertSummary, vectorIndexSummary, searchResults);
        
    } catch (error) {
        console.error('Complete workflow example failed:', error);
    }
}

/**
 * Example 2: Step-by-step workflow using individual functions
 */
async function exampleStepByStepWorkflow() {
    console.log('\n=== Example 2: Step-by-Step Workflow ===');
    
    const config: SearchConfig = {
        dbName: "ExampleHotels2",
        collectionName: "hotels_stepbystep",
        indexName: "vectorIndex_stepbystep",
        embeddedField: process.env.EMBEDDED_FIELD || "contentVector",
        embeddingDimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || "1536", 10),
        deployment: process.env.AZURE_OPENAI_EMBEDDING_MODEL!,
        batchSize: 100
    };

    const { aiClient, dbClient } = getClients();
    
    if (!aiClient || !dbClient) {
        console.error('Failed to get clients');
        return;
    }

    try {
        await dbClient.connect();
        const db = dbClient.db(config.dbName);
        const collection = await db.createCollection(config.collectionName);
        
        console.log('Created collection:', config.collectionName);

        // Step 1: Create IVF vector index
        const ivfIndexConfig = createIVFIndexConfig(
            config.embeddingDimensions,
            5, // numLists
            'COS' // similarity
        );
        
        const vectorIndexSummary = await createVectorIndex(db, config, ivfIndexConfig);
        console.log('Vector index created:', vectorIndexSummary);

        // Step 2: Perform search
        const query = "beachfront resort with ocean view";
        const searchResults = await performVectorSearch(aiClient, collection, query, config, 5);
        
        console.log('Search results:', searchResults);

    } catch (error) {
        console.error('Step-by-step workflow example failed:', error);
    } finally {
        if (dbClient) {
            await dbClient.close();
        }
    }
}

/**
 * Example 3: Comparing different vector index types
 */
async function exampleCompareIndexTypes() {
    console.log('\n=== Example 3: Compare Index Types ===');
    
    const baseConfig: SearchConfig = {
        dbName: "CompareIndexes",
        collectionName: "", // Will be set for each index type
        indexName: "", // Will be set for each index type
        embeddedField: process.env.EMBEDDED_FIELD || "contentVector",
        embeddingDimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || "1536", 10),
        deployment: process.env.AZURE_OPENAI_EMBEDDING_MODEL!,
        batchSize: 50
    };

    const query = "family-friendly hotel with pool and restaurant";
    
    // Test different index types
    const indexConfigs = [
        {
            name: 'IVF',
            config: createIVFIndexConfig(baseConfig.embeddingDimensions, 3, 'COS'),
            collectionSuffix: 'ivf'
        },
        {
            name: 'HNSW', 
            config: createHNSWIndexConfig(baseConfig.embeddingDimensions, 8, 32, 'COS'),
            collectionSuffix: 'hnsw'
        },
        {
            name: 'DiskANN',
            config: createDiskANNIndexConfig(baseConfig.embeddingDimensions, 15, 8, 'COS'),
            collectionSuffix: 'diskann'
        }
    ];

    for (const indexType of indexConfigs) {
        console.log(`\n--- Testing ${indexType.name} Index ---`);
        
        const config = {
            ...baseConfig,
            collectionName: `hotels_${indexType.collectionSuffix}`,
            indexName: `vectorIndex_${indexType.collectionSuffix}`
        };

        try {
            const { searchResults } = await completeVectorSearchWorkflow(
                config,
                indexType.config,
                query,
                undefined, // No data insertion for this example
                false, // usePasswordless
                2 // k
            );

            console.log(`${indexType.name} search results:`, searchResults?.length || 0, 'results');
            
        } catch (error) {
            console.error(`${indexType.name} index test failed:`, error);
        }
    }
}

// Main execution
async function main() {
    try {
        // Uncomment the examples you want to run:
        
        // await exampleCompleteWorkflow();
        // await exampleStepByStepWorkflow();
        // await exampleCompareIndexTypes();
        
        console.log('\n=== Examples Complete ===');
        console.log('Uncomment the example functions in main() to run them.');
        
    } catch (error) {
        console.error('Main execution failed:', error);
        process.exitCode = 1;
    }
}

// Execute the main function
main().catch(error => {
    console.error('Unhandled error:', error);
    process.exitCode = 1;
});