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
    collectionName: "hotels_quantizedflat",
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

        try {
            const database = dbClient.database(config.dbName);
            console.log('Connected to database:', config.dbName);

            const container = database.container(config.collectionName);
            console.log('Connected to container:', config.collectionName);

            // Verify container exists by attempting a read
            await container.read();
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
            if (error.code === 404) {
                throw new Error(`Container or database not found. Ensure database '${config.dbName}' and container '${config.collectionName}' exist before running this script.`);
            }
            throw error;
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