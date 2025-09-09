import path from 'path';
import { readFileReturnJson, getClients, insertData } from './utils.js';
import {  VectorEmbeddingPolicy, VectorEmbeddingDataType, VectorEmbeddingDistanceFunction, IndexingPolicy, VectorIndexType } from '@azure/cosmos';
// ESM specific features - create __dirname equivalent
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const config = {
    query: "find a hotel by a lake with a mountain view",
    dbName: "Hotels",
    collectionName: "hotels",
    indexName: "vectorIndex",
    dataFile: process.env.DATA_FILE_WITH_VECTORS!,
    batchSize: parseInt(process.env.LOAD_SIZE_BATCH! || '100', 10),
    embeddingField: process.env.EMBEDDED_FIELD!,
    embeddedField: process.env.EMBEDDED_FIELD!,
    embeddingDimensions: parseInt(process.env.EMBEDDING_DIMENSIONS!, 10),
    deployment: process.env.AZURE_OPENAI_EMBEDDING_MODEL!,
};

async function main() {

    const { aiClient, dbClient } = getClientsPasswordless();

    try {
        
    if (!aiClient) {
        throw new Error('OpenAI client is not configured properly. Please check your environment variables.');
    }

    if (!dbClient) {
        throw new Error('Cosmos DB client is not configured properly. Please check your environment variables.');
    }

        // Get database reference
        const { database } = await dbClient.databases.createIfNotExists({ id: config.dbName });

        // Create the vector index
        const vectorEmbeddingPolicy: VectorEmbeddingPolicy = {
            vectorEmbeddings: [
                {
                    path: "/text_embedding_ada_002",
                    dataType: VectorEmbeddingDataType.Float32,
                    dimensions: config.embeddingDimensions,
                    distanceFunction: VectorEmbeddingDistanceFunction.Cosine,
                }
            ],
        };

        const indexingPolicy: IndexingPolicy = {
            vectorIndexes: [
                { path: "/text_embedding_ada_002", type: VectorIndexType.DiskANN },
            ],
            includedPaths: [
                {
                    path: "/*",
                },
            ],
            excludedPaths: [
                {
                    path: "/text_embedding_ada_002/*",
                }
            ]
        };
        // create container
        const { resource: containerdef } = await database.containers.createIfNotExists({
            id: config.collectionName,
            vectorEmbeddingPolicy: vectorEmbeddingPolicy,
            indexingPolicy: indexingPolicy,
        });
        // get container reference
        const container = database.container(config.collectionName);

        console.log('Created collection:', config.collectionName);
        const data = await readFileReturnJson(path.join(__dirname, "..", config.dataFile));
        const insertSummary = await insertData(config, container, data);

        console.log('Insert summary:', insertSummary);

        // Create embedding for the query
        const createEmbeddedForQueryResponse = await aiClient.embeddings.create({
            model: config.deployment,
            input: [config.query]
        });

        // Perform the vector similarity search
        const { resources } = await container.items
            .query({
                query: "SELECT TOP 5 c.HotelName, VectorDistance(c.contentVector, @embedding) AS SimilarityScore FROM c ORDER BY VectorDistance(c.contentVector, @embedding)",
                parameters: [{ name: "@embedding", value: createEmbeddedForQueryResponse.data[0].embedding }]
            })
            .fetchAll();

        for (const item of resources) {
            console.log(`${item.HotelName} with score ${item.SimilarityScore} `);
        }


    } catch (error) {
        console.error('App failed:', error);
        process.exitCode = 1;
    } 
}

// Execute the main function
main().catch(error => {
    console.error('Unhandled error:', error);
    process.exitCode = 1;
});