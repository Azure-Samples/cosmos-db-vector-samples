 import type { Container, SqlQuerySpec } from '@azure/cosmos';
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

const ALGORITHM_ORDER: VectorAlgorithm[] = ['diskann', 'quantizedflat'];
const VALID_DISTANCE_FUNCTIONS = ['cosine', 'euclidean', 'dotproduct'] as const;
const METRIC_LABELS: Record<(typeof VALID_DISTANCE_FUNCTIONS)[number], string> = {
    cosine: 'COS',
    euclidean: 'L2',
    dotproduct: 'IP'
};

interface ComparisonRow {
    algorithmName: string;
    metric: (typeof VALID_DISTANCE_FUNCTIONS)[number];
    results: any[];
}

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

function buildVectorQuerySpec(
    embedding: number[],
    safeEmbeddedField: string,
    distanceFunction: string,
    topK: number,
    scoreAlias: string
): SqlQuerySpec {
    return {
        query: `SELECT TOP ${topK} c.HotelName, c.Description, c.Rating, VectorDistance(c.${safeEmbeddedField}, @embedding, false, {"distanceFunction": "${distanceFunction}"}) AS ${scoreAlias} FROM c ORDER BY VectorDistance(c.${safeEmbeddedField}, @embedding, false, {"distanceFunction": "${distanceFunction}"})`,
        parameters: [
            { name: '@embedding', value: embedding }
        ]
    };
}

function truncateHotelName(name: string): string {
    return name.length > 20 ? `${name.slice(0, 20)}..` : name;
}

function printComparisonTable(rows: ComparisonRow[]) {
    console.log('\n| Algorithm     | Metric | Top 1 Result            | Score  | Top 2 Result            | Score  |');
    console.log('|---------------|--------|-------------------------|--------|-------------------------|--------|');

    for (const row of rows) {
        const top1 = row.results[0];
        const top2 = row.results[1];
        const top1Name = top1?.HotelName ? truncateHotelName(top1.HotelName) : 'N/A';
        const top2Name = top2?.HotelName ? truncateHotelName(top2.HotelName) : 'N/A';
        const top1Score = typeof top1?.SimilarityScore === 'number' ? top1.SimilarityScore.toFixed(4) : 'N/A';
        const top2Score = typeof top2?.SimilarityScore === 'number' ? top2.SimilarityScore.toFixed(4) : 'N/A';

        console.log(
            `| ${row.algorithmName.padEnd(13)} | ${METRIC_LABELS[row.metric].padEnd(6)} | ${top1Name.padEnd(24)} | ${top1Score.padStart(6)} | ${top2Name.padEnd(24)} | ${top2Score.padStart(6)} |`
        );
    }

    console.log('\n====================================================================================================');
    console.log('Summary: Compared 2 algorithms x 3 metrics = 6 combinations');
    console.log('====================================================================================================');
}

async function runSingleMetricQuery(container: Container, embedding: number[], safeEmbeddedField: string, distanceFunction: string) {
    const querySpec = buildVectorQuerySpec(embedding, safeEmbeddedField, distanceFunction, 5, 'SimilarityScore');

    console.log('\n--- Executing Vector Search Query ---');
    console.log('Query:', querySpec.query);
    console.log('Parameters: @embedding (vector with', embedding.length, 'dimensions)');
    console.log('--------------------------------------\n');

    const queryResponse = await container.items
        .query(querySpec)
        .fetchAll();

    const activityId = getQueryActivityId(queryResponse);
    if (activityId) {
        console.log('Query activity ID:', activityId);
    }

    const { resources, requestCharge } = queryResponse;
    printSearchResults(resources, requestCharge);
}

async function runMetricComparison(database: any, embedding: number[], safeEmbeddedField: string, data: any[]) {
    const rows: ComparisonRow[] = [];

    console.log('\nComparing distance metrics across DiskANN and QuantizedFlat');

    for (const algorithm of ALGORITHM_ORDER) {
        const algorithmConfig = algorithmConfigs[algorithm];
        const container = database.container(algorithmConfig.containerName);
        await container.read();
        await insertData(container, data);

        for (const metric of VALID_DISTANCE_FUNCTIONS) {
            const querySpec = buildVectorQuerySpec(embedding, safeEmbeddedField, metric, 2, 'SimilarityScore');
            const queryResponse = await container.items.query(querySpec).fetchAll();

            rows.push({
                algorithmName: algorithmConfig.algorithmName,
                metric,
                results: queryResponse.resources
            });
        }
    }

    printComparisonTable(rows);
}

async function main() {
    const { aiClient, dbClient } = getClientsPasswordless();

    try {
        // Validate algorithm selection
        if (!Object.keys(algorithmConfigs).includes(config.algorithm)) {
            throw new Error(`Invalid algorithm '${config.algorithm}'. Must be one of: ${Object.keys(algorithmConfigs).join(', ')}`);
        }

        // Validate distance function
        if (!VALID_DISTANCE_FUNCTIONS.includes(config.distanceFunction as (typeof VALID_DISTANCE_FUNCTIONS)[number])) {
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
            console.log(`\nVector Search Algorithm: ${algorithmConfig.algorithmName}`);
            console.log(`Distance Function: ${config.distanceFunction}`);
            if (config.compareMetrics) {
                console.log('Comparison Mode: metrics across DiskANN and QuantizedFlat');
            }

            const data = await readFileReturnJson(path.join(__dirname, "..", config.dataFile));

            const createEmbeddedForQueryResponse = await aiClient.embeddings.create({
                model: config.deployment,
                input: [config.query]
            });

            const safeEmbeddedField = validateFieldName(config.embeddedField);

            if (config.compareMetrics) {
                await runMetricComparison(database, createEmbeddedForQueryResponse.data[0].embedding, safeEmbeddedField, data);
            } else {
                const container = database.container(collectionName);
                console.log(`Connected to container: ${collectionName}`);
                await container.read();
                await insertData(container, data);
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