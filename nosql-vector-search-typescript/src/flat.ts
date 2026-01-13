import path from 'path';
import { readFileReturnJson, getClientsPasswordless, validateFieldName, insertData, printSearchResults } from './utils.js';
import { VectorEmbeddingPolicy, VectorEmbeddingDataType, VectorEmbeddingDistanceFunction, IndexingPolicy, VectorIndexType } from '@azure/cosmos';

// ESM specific features - create __dirname equivalent
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const config = {
    query: "quintessential lodging near running trails, eateries, retail",
    dbName: "Hotels",
    collectionName: "hotels_flat",
    dataFile: process.env.DATA_FILE_WITH_VECTORS!,
    batchSize: parseInt(process.env.LOAD_SIZE_BATCH! || '50', 10),
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

        const { database } = await dbClient.databases.createIfNotExists({ id: config.dbName });
        console.log('Database ready:', config.dbName);

        const vectorEmbeddingPolicy: VectorEmbeddingPolicy = {
            vectorEmbeddings: [
                {
                    path: `/${config.embeddedField}`,
                    dataType: VectorEmbeddingDataType.Float32,
                    dimensions: config.embeddingDimensions,
                    distanceFunction: VectorEmbeddingDistanceFunction.Cosine,
                }
            ],
        };

        const indexingPolicy: IndexingPolicy = {
            vectorIndexes: [
                { 
                    path: `/${config.embeddedField}`, 
                    type: VectorIndexType.Flat 
                },
            ],
            includedPaths: [
                {
                    path: "/*",
                },
            ],
            excludedPaths: [
                {
                    path: `/${config.embeddedField}/*`,
                }
            ]
        };

        await database.containers.createIfNotExists({
            id: config.collectionName,
            vectorEmbeddingPolicy: vectorEmbeddingPolicy,
            indexingPolicy: indexingPolicy,
            partitionKey: {
                paths: ['/HotelId']
            }
        });
        console.log('Created container:', config.collectionName);

        const container = database.container(config.collectionName);
        const data = await readFileReturnJson(path.join(__dirname, "..", config.dataFile));
        const insertSummary = await insertData(config, container, data.slice(0, config.batchSize));

        const createEmbeddedForQueryResponse = await aiClient.embeddings.create({
            model: config.deployment,
            input: [config.query]
        });

        const safeEmbeddedField = validateFieldName(config.embeddedField);
        const { resources, requestCharge } = await container.items
            .query({
                query: `SELECT TOP 5 c.HotelName, c.Description, c.Rating, VectorDistance(c.${safeEmbeddedField}, @embedding) AS SimilarityScore FROM c ORDER BY VectorDistance(c.${safeEmbeddedField}, @embedding)`,
                parameters: [
                    { name: "@embedding", value: createEmbeddedForQueryResponse.data[0].embedding }
                ]
            })
            .fetchAll();

        printSearchResults(insertSummary, resources, requestCharge);

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