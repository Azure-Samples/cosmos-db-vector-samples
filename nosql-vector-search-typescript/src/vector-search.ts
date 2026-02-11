 import path from 'path';
import { readFileReturnJson, getClientsPasswordless, validateFieldName, insertData, printSearchResults, getQueryActivityId } from './utils.js';

// ESM specific features - create __dirname equivalent
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type VectorAlgorithm = 'diskann' | 'quantizedflat';

interface AlgorithmConfig {
    containerName: string;
    algorithmName: string;
}

const algorithmConfigs: Record<VectorAlgorithm, AlgorithmConfig> = {
    diskann: {
        containerName: 'hotels_diskann',
        algorithmName: 'DiskANN'
    },
    quantizedflat: {
        containerName: 'hotels_quantizedflat',
        algorithmName: 'QuantizedFlat'
    }
};

const config = {
    query: "quintessential lodging near running trails, eateries, retail",
    dbName: "Hotels",
    algorithm: (process.env.VECTOR_ALGORITHM || 'diskann').trim().toLowerCase() as VectorAlgorithm,
    dataFile: process.env.DATA_FILE_WITH_VECTORS!,
    embeddedField: process.env.EMBEDDED_FIELD!,
    embeddingDimensions: parseInt(process.env.EMBEDDING_DIMENSIONS! || process.env.VECTOR_EMBEDDING_DIMENSIONS || '1536', 10),
    deployment: process.env.AZURE_OPENAI_EMBEDDING_MODEL!,
    distanceFunction: process.env.VECTOR_DISTANCE_FUNCTION || 'cosine',
};

async function main() {
    const { aiClient, dbClient } = getClientsPasswordless();

    try {
        // Validate algorithm selection
        if (!Object.keys(algorithmConfigs).includes(config.algorithm)) {
            throw new Error(`Invalid algorithm '${config.algorithm}'. Must be one of: ${Object.keys(algorithmConfigs).join(', ')}`);
        }

        if (!aiClient) {
            throw new Error('Azure OpenAI client is not configured. Please check your environment variables.');
        }
        if (!dbClient) {
            throw new Error('Database client is not configured. Please check your environment variables.');
        }

        const algorithmConfig = algorithmConfigs[config.algorithm];
        const collectionName = algorithmConfig.containerName;

        try {
            const database = dbClient.database(config.dbName);
            console.log(`Connected to database: ${config.dbName}`);

            const container = database.container(collectionName);
            console.log(`Connected to container: ${collectionName}`);
            console.log(`\n📊 Vector Search Algorithm: ${algorithmConfig.algorithmName}`);
            console.log(`📏 Distance Function: ${config.distanceFunction}`);

            // Verify container exists by attempting a read
            await container.read();

            const data = await readFileReturnJson(path.join(__dirname, "..", config.dataFile));
            await insertData(container, data);

            const createEmbeddedForQueryResponse = await aiClient.embeddings.create({
                model: config.deployment,
                input: [config.query]
            });

            const safeEmbeddedField = validateFieldName(config.embeddedField);
            const queryText = `SELECT TOP 5 c.HotelName, c.Description, c.Rating, VectorDistance(c.${safeEmbeddedField}, @embedding) AS SimilarityScore FROM c ORDER BY VectorDistance(c.${safeEmbeddedField}, @embedding)`;

            console.log('\n--- Executing Vector Search Query ---');
            console.log('Query:', queryText);
            console.log('Parameters: @embedding (vector with', createEmbeddedForQueryResponse.data[0].embedding.length, 'dimensions)');
            console.log('--------------------------------------\n');

            const queryResponse = await container.items
                .query({
                    query: queryText,
                    parameters: [
                        { name: "@embedding", value: createEmbeddedForQueryResponse.data[0].embedding }
                    ]
                })
                .fetchAll();

            const activityId = getQueryActivityId(queryResponse);
            if (activityId) {
                console.log('Query activity ID:', activityId);
            }

            const { resources, requestCharge } = queryResponse;

            printSearchResults(resources, requestCharge);
        } catch (error) {
            if ((error as any).code === 404) {
                throw new Error(`Container or database not found. Ensure database '${config.dbName}' and container '${collectionName}' exist before running this script.`);
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