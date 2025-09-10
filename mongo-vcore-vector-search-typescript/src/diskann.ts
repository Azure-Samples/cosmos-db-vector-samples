import path from 'path';
import { readFileReturnJson, getClientsPasswordless, insertData, printSearchResults } from './utils.js';

// ESM specific features - create __dirname equivalent
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const config = {
    query: "quintessential lodging near running trails, eateries, retail",
    dbName: "Hotels",
    collectionName: "hotels_diskann",
    indexName: "vectorIndex_diskann",
    dataFile: process.env.DATA_FILE_WITH_VECTORS!,
    batchSize: parseInt(process.env.LOAD_SIZE_BATCH! || '100', 10),
    embeddedField: process.env.EMBEDDED_FIELD!,
    embeddingDimensions: parseInt(process.env.EMBEDDING_DIMENSIONS!, 10),
    deployment: process.env.AZURE_OPENAI_EMBEDDING_MODEL!,
};

async function main() {

    const { aiClient, dbClient } = getClientsPasswordless();

    try {

        if (!aiClient) {
            throw new Error('AI client is not configured. Please check your environment variables.');
        }
        if (!dbClient) {
            throw new Error('Database client is not configured. Please check your environment variables.');
        }

        await dbClient.connect();
        const db = dbClient.db(config.dbName);
        const collection = await db.createCollection(config.collectionName);
        console.log('Created collection:', config.collectionName);
        const data = await readFileReturnJson(path.join(__dirname, "..", config.dataFile));
        const insertSummary = await insertData(config, collection, data);
        console.log('Created vector index:', config.indexName);
        
        // Create the vector index
        const indexOptions = {
            createIndexes: config.collectionName,
            indexes: [
                {
                    name: config.indexName,
                    key: {
                        [config.embeddedField]: 'cosmosSearch'
                    },
                    cosmosSearchOptions: {
                        kind: 'vector-diskann',
                        dimensions: config.embeddingDimensions,
                        similarity: 'COS', // 'COS', 'L2', 'IP'
                        maxDegree: 20, // 20 - 2048,  edges per node
                        lBuild: 10 // 10 - 500, candidate neighbors evaluated
                    }
                }
            ]
        };
        const vectorIndexSummary = await db.command(indexOptions);

        // Create embedding for the query
        const createEmbeddedForQueryResponse = await aiClient.embeddings.create({
            model: config.deployment,
            input: [config.query]
        });

        // Perform the vector similarity search
        const searchResults = await collection.aggregate([
            {
                $search: {
                    cosmosSearch: {
                        vector: createEmbeddedForQueryResponse.data[0].embedding,
                        path: config.embeddedField,
                        k: 5
                    }
                }
            },
            {
                $project: {
                    score: {
                        $meta: "searchScore"
                    },
                    document: "$$ROOT"
                }
            }
        ]).toArray();

        // Print the results
        printSearchResults(insertSummary, vectorIndexSummary, searchResults);

    } catch (error) {
        console.error('App failed:', error);
        process.exitCode = 1;
    } finally {
        console.log('Closing database connection...');
        if (dbClient) await dbClient.close();
        console.log('Database connection closed');
    }
}

// Execute the main function
main().catch(error => {
    console.error('Unhandled error:', error);
    process.exitCode = 1;
});