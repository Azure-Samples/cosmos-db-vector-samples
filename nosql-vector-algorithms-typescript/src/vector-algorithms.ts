import path from 'path';
import {
    readFileReturnJson,
    getClientsPasswordless,
    validateFieldName,
    insertData,
    getQueryActivityId,
    printComparisonTable
} from './utils.js';

// ESM specific features - create __dirname equivalent
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type VectorAlgorithm = 'quantizedflat' | 'diskann';
type DistanceFunction = 'cosine' | 'dotproduct' | 'euclidean';

const ALGORITHMS: VectorAlgorithm[] = ['quantizedflat', 'diskann'];
const DISTANCE_FUNCTIONS: DistanceFunction[] = ['cosine', 'dotproduct', 'euclidean'];

const ALGORITHM_LABELS: Record<VectorAlgorithm, string> = {
    quantizedflat: 'QuantizedFlat',
    diskann: 'DiskANN',
};

/**
 * Determine which containers to query based on VECTOR_ALGORITHM and VECTOR_DISTANCE_FUNCTION env vars.
 * Container naming pattern: hotels_{algorithm}_{distance_function}
 */
function getTargetContainers(
    algorithmEnv: string,
    distanceEnv: string
): Array<{ containerName: string; algorithm: VectorAlgorithm; distanceFunction: DistanceFunction }> {
    const algorithms: VectorAlgorithm[] =
        algorithmEnv === 'all' ? ALGORITHMS : [algorithmEnv as VectorAlgorithm];
    const distances: DistanceFunction[] =
        distanceEnv === 'all' ? DISTANCE_FUNCTIONS : [distanceEnv as DistanceFunction];

    const targets: Array<{ containerName: string; algorithm: VectorAlgorithm; distanceFunction: DistanceFunction }> = [];

    for (const alg of algorithms) {
        if (!ALGORITHMS.includes(alg)) {
            throw new Error(`Invalid VECTOR_ALGORITHM '${alg}'. Must be one of: all, ${ALGORITHMS.join(', ')}`);
        }
        for (const dist of distances) {
            if (!DISTANCE_FUNCTIONS.includes(dist)) {
                throw new Error(`Invalid VECTOR_DISTANCE_FUNCTION '${dist}'. Must be one of: all, ${DISTANCE_FUNCTIONS.join(', ')}`);
            }
            targets.push({
                containerName: `hotels_${alg}_${dist}`,
                algorithm: alg,
                distanceFunction: dist,
            });
        }
    }

    return targets;
}

async function main() {
    const { aiClient, dbClient } = getClientsPasswordless();

    try {
        if (!aiClient) {
            throw new Error('Azure OpenAI client is not configured. Please check your environment variables.');
        }
        if (!dbClient) {
            throw new Error('Cosmos DB client is not configured. Please check your environment variables.');
        }

        const dbName = process.env.AZURE_COSMOSDB_DATABASENAME || 'Hotels';
        const embeddedField = process.env.EMBEDDED_FIELD || 'DescriptionVector';
        const dataFile = process.env.DATA_FILE_WITH_VECTORS || '../data/HotelsData_toCosmosDB_Vector.json';
        const deployment = process.env.AZURE_OPENAI_EMBEDDING_MODEL!;
        const algorithmEnv = (process.env.VECTOR_ALGORITHM || 'all').trim().toLowerCase();
        const distanceEnv = (process.env.VECTOR_DISTANCE_FUNCTION || 'cosine').trim().toLowerCase();
        const searchQuery = 'quintessential lodging near running trails, eateries, retail';

        const targets = getTargetContainers(algorithmEnv, distanceEnv);

        console.log(`\n🔬 Vector Algorithm Comparison`);
        console.log(`   Database: ${dbName}`);
        console.log(`   Algorithms: ${algorithmEnv}`);
        console.log(`   Distance functions: ${distanceEnv}`);
        console.log(`   Containers to query: ${targets.map(t => t.containerName).join(', ')}`);
        console.log(`   Search query: "${searchQuery}"\n`);

        const database = dbClient.database(dbName);

        // Load data once (shared across containers)
        const data = await readFileReturnJson(path.join(__dirname, '..', dataFile));

        // Generate query embedding once (reuse across containers)
        console.log('Generating query embedding...');
        const embeddingResponse = await aiClient.embeddings.create({
            model: deployment,
            input: [searchQuery],
        });
        const queryEmbedding = embeddingResponse.data[0].embedding;
        console.log(`Query embedding: ${queryEmbedding.length} dimensions\n`);

        const safeEmbeddedField = validateFieldName(embeddedField);
        const queryText = `SELECT TOP 5 c.HotelName, c.Description, c.Rating, VectorDistance(c.${safeEmbeddedField}, @embedding) AS SimilarityScore FROM c ORDER BY VectorDistance(c.${safeEmbeddedField}, @embedding)`;

        const comparisonResults: Array<{
            containerName: string;
            algorithm: string;
            distanceFunction: string;
            searchResults: any[];
            requestCharge: number;
            latencyMs: number;
        }> = [];

        for (const target of targets) {
            console.log(`\n━━━ ${ALGORITHM_LABELS[target.algorithm]} / ${target.distanceFunction} ━━━`);
            console.log(`Container: ${target.containerName}`);

            try {
                const container = database.container(target.containerName);
                await container.read();

                // Insert data (skips if already populated)
                await insertData(container, data);

                // Run vector search
                console.log('Executing vector search...');
                const startTime = Date.now();

                const queryResponse = await container.items
                    .query({
                        query: queryText,
                        parameters: [
                            { name: '@embedding', value: queryEmbedding },
                        ],
                    })
                    .fetchAll();

                const latencyMs = Date.now() - startTime;

                const activityId = getQueryActivityId(queryResponse);
                if (activityId) {
                    console.log('Query activity ID:', activityId);
                }

                const { resources, requestCharge } = queryResponse;

                comparisonResults.push({
                    containerName: target.containerName,
                    algorithm: ALGORITHM_LABELS[target.algorithm],
                    distanceFunction: target.distanceFunction,
                    searchResults: resources,
                    requestCharge: requestCharge ?? 0,
                    latencyMs,
                });

                console.log(`✓ ${resources.length} results, ${requestCharge?.toFixed(2)} RUs, ${latencyMs}ms`);
            } catch (error) {
                if ((error as any).code === 404) {
                    console.error(`✗ Container '${target.containerName}' not found. Run scripts/create-resources.sh first.`);
                } else {
                    console.error(`✗ Error querying ${target.containerName}:`, (error as Error).message);
                }
            }
        }

        // Print comparison table
        if (comparisonResults.length > 0) {
            printComparisonTable(comparisonResults);
        }
    } catch (error) {
        console.error('App failed:', error);
        process.exitCode = 1;
    }
}

main().catch(error => {
    console.error('Unhandled error:', error);
    process.exitCode = 1;
});
