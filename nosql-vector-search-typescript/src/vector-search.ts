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

const VALID_DISTANCE_FUNCTIONS = ['cosine', 'euclidean', 'dotproduct'];

const config = {
    query: "quintessential lodging near running trails, eateries, retail",
    dbName: "Hotels",
    algorithm: (process.env.VECTOR_ALGORITHM || 'diskann').trim().toLowerCase() as VectorAlgorithm,
    dataFile: process.env.DATA_FILE_WITH_VECTORS!,
    embeddedField: process.env.EMBEDDED_FIELD!,
    embeddingDimensions: parseInt(process.env.EMBEDDING_DIMENSIONS! || process.env.VECTOR_EMBEDDING_DIMENSIONS || '1536', 10),
    deployment: process.env.AZURE_OPENAI_EMBEDDING_MODEL!,
    distanceFunction: (process.env.VECTOR_DISTANCE_FUNCTION || 'cosine').toLowerCase(),
    compareMetrics: (process.env.COMPARE_DISTANCE_METRICS || 'false').toLowerCase() === 'true',
};

async function runSingleMetricQuery(container: any, embedding: number[], safeEmbeddedField: string, distanceFunction: string) {
    const queryText = `SELECT TOP 5 c.HotelName, c.Description, c.Rating, VectorDistance(c.${safeEmbeddedField}, @embedding, "${distanceFunction}") AS SimilarityScore FROM c ORDER BY VectorDistance(c.${safeEmbeddedField}, @embedding, "${distanceFunction}")`;

    console.log('\n--- Executing Vector Search Query ---');
    console.log('Query:', queryText);
    console.log('Parameters: @embedding (vector with', embedding.length, 'dimensions)');
    console.log('--------------------------------------\n');

    const queryResponse = await container.items
        .query({
            query: queryText,
            parameters: [
                { name: "@embedding", value: embedding }
            ]
        })
        .fetchAll();

    const activityId = getQueryActivityId(queryResponse);
    if (activityId) {
        console.log('Query activity ID:', activityId);
    }

    const { resources, requestCharge } = queryResponse;
    printSearchResults(resources, requestCharge);
}

async function runMetricComparison(container: any, embedding: number[], safeEmbeddedField: string) {
    const resultMap = new Map<string, any>();
    const charges: Record<string, number> = {};

    console.log('\n--- Comparing All Distance Metrics ---');

    // Execute query for each distance function
    for (const metric of VALID_DISTANCE_FUNCTIONS) {
        const queryText = `SELECT TOP 5 c.HotelName, c.Description, c.Rating, VectorDistance(c.${safeEmbeddedField}, @embedding, "${metric}") AS Score FROM c ORDER BY VectorDistance(c.${safeEmbeddedField}, @embedding, "${metric}")`;

        const queryResponse = await container.items
            .query({
                query: queryText,
                parameters: [
                    { name: "@embedding", value: embedding }
                ]
            })
            .fetchAll();

        charges[metric] = (queryResponse.requestCharge || 0);

        for (const item of queryResponse.resources) {
            if (!resultMap.has(item.HotelName)) {
                resultMap.set(item.HotelName, {
                    HotelName: item.HotelName,
                    Description: item.Description,
                    Rating: item.Rating,
                    Scores: {}
                });
            }
            const result = resultMap.get(item.HotelName);
            result.Scores[metric] = item.Score;
        }
    }

    // Print comparison results
    console.log('\nHotels ranked by each distance metric:');
    let idx = 1;
    for (const [, result] of resultMap) {
        console.log(`\n${idx}. ${result.HotelName}`);
        for (const metric of VALID_DISTANCE_FUNCTIONS) {
            if (result.Scores[metric] !== undefined) {
                console.log(`   ${metric}: ${result.Scores[metric].toFixed(4)}`);
            }
        }
        idx++;
    }

    console.log('\n--- Request Charges per Metric ---');
    for (const metric of VALID_DISTANCE_FUNCTIONS) {
        console.log(`${metric}: ${charges[metric]?.toFixed(2) || '0.00'} RUs`);
    }
    console.log();
}

async function main() {
    const { aiClient, dbClient } = getClientsPasswordless();

    try {
        // Validate algorithm selection
        if (!Object.keys(algorithmConfigs).includes(config.algorithm)) {
            throw new Error(`Invalid algorithm '${config.algorithm}'. Must be one of: ${Object.keys(algorithmConfigs).join(', ')}`);
        }

        // Validate distance function
        if (!VALID_DISTANCE_FUNCTIONS.includes(config.distanceFunction)) {
            throw new Error(`Invalid distance function '${config.distanceFunction}'. Must be one of: ${VALID_DISTANCE_FUNCTIONS.join(', ')}`);
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
            if (config.compareMetrics) {
                console.log('📊 Comparison Mode: All 3 metrics');
            }

            // Verify container exists by attempting a read
            await container.read();

            const data = await readFileReturnJson(path.join(__dirname, "..", config.dataFile));
            await insertData(container, data);

            const createEmbeddedForQueryResponse = await aiClient.embeddings.create({
                model: config.deployment,
                input: [config.query]
            });

            const safeEmbeddedField = validateFieldName(config.embeddedField);

            if (config.compareMetrics) {
                await runMetricComparison(container, createEmbeddedForQueryResponse.data[0].embedding, safeEmbeddedField);
            } else {
                await runSingleMetricQuery(container, createEmbeddedForQueryResponse.data[0].embedding, safeEmbeddedField, config.distanceFunction);
            }

            console.log('Vector search completed successfully!');
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