import { getClientsPasswordless, validateFieldName, getQueryActivityId } from '../utils.js';

type VectorAlgorithm = 'quantizedflat' | 'diskann';
type DistanceFunction = 'cosine' | 'dotproduct' | 'euclidean';

const ALGORITHMS: VectorAlgorithm[] = ['quantizedflat', 'diskann'];
const DISTANCE_FUNCTIONS: DistanceFunction[] = ['cosine', 'dotproduct', 'euclidean'];

const ALGORITHM_LABELS: Record<VectorAlgorithm, string> = {
    quantizedflat: 'QuantizedFlat',
    diskann: 'DiskANN',
};

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
        for (const dist of distances) {
            targets.push({
                containerName: `hotels_${alg}_${dist}`,
                algorithm: alg,
                distanceFunction: dist,
            });
        }
    }
    return targets;
}

interface BenchmarkResult {
    containerName: string;
    algorithm: string;
    distanceFunction: string;
    avgLatencyMs: number;
    avgRU: number;
    resultCount: number;
}

async function main() {
    const { aiClient, dbClient } = getClientsPasswordless();

    if (!aiClient) {
        throw new Error('Azure OpenAI client is not configured. Please check your environment variables.');
    }
    if (!dbClient) {
        throw new Error('Cosmos DB client is not configured. Please check your environment variables.');
    }

    const dbName = process.env.AZURE_COSMOSDB_DATABASENAME || 'Hotels';
    const embeddedField = process.env.EMBEDDED_FIELD || 'DescriptionVector';
    const deployment = process.env.AZURE_OPENAI_EMBEDDING_MODEL!;
    const algorithmEnv = (process.env.VECTOR_ALGORITHM || 'all').trim().toLowerCase();
    const distanceEnv = (process.env.VECTOR_DISTANCE_FUNCTION || 'all').trim().toLowerCase();
    const iterations = parseInt(process.env.BENCHMARK_ITERATIONS || '5', 10);
    const topK = parseInt(process.env.BENCHMARK_TOP_K || '5', 10);
    const searchQuery = 'quintessential lodging near running trails, eateries, retail';

    const targets = getTargetContainers(algorithmEnv, distanceEnv);

    console.log(`\n📊 Vector Algorithm Benchmark`);
    console.log(`   Iterations: ${iterations} (first discarded as cold start)`);
    console.log(`   Top K: ${topK}`);
    console.log(`   Containers: ${targets.map(t => t.containerName).join(', ')}\n`);

    const database = dbClient.database(dbName);

    // Generate query embedding once
    const embeddingResponse = await aiClient.embeddings.create({
        model: deployment,
        input: [searchQuery],
    });
    const queryEmbedding = embeddingResponse.data[0].embedding;

    const safeEmbeddedField = validateFieldName(embeddedField);
    const queryText = `SELECT TOP ${topK} c.HotelName, c.Description, c.Rating, VectorDistance(c.${safeEmbeddedField}, @embedding) AS SimilarityScore FROM c ORDER BY VectorDistance(c.${safeEmbeddedField}, @embedding)`;

    const benchmarkResults: BenchmarkResult[] = [];

    for (const target of targets) {
        console.log(`\n━━━ Benchmarking: ${ALGORITHM_LABELS[target.algorithm]} / ${target.distanceFunction} ━━━`);

        try {
            const container = database.container(target.containerName);
            await container.read();

            const latencies: number[] = [];
            const rus: number[] = [];
            let resultCount = 0;

            for (let i = 0; i < iterations; i++) {
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

                console.log(`  Iteration ${i + 1}: ${latencyMs}ms, ${queryResponse.requestCharge?.toFixed(2)} RUs${i === 0 ? ' (cold start — excluded)' : ''}${activityId ? `, activity: ${activityId}` : ''}`);

                // Discard first iteration (cold start)
                if (i > 0) {
                    latencies.push(latencyMs);
                    rus.push(queryResponse.requestCharge ?? 0);
                }
                resultCount = queryResponse.resources?.length ?? 0;
            }

            const avgLatency = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
            const avgRU = rus.length > 0 ? rus.reduce((a, b) => a + b, 0) / rus.length : 0;

            benchmarkResults.push({
                containerName: target.containerName,
                algorithm: ALGORITHM_LABELS[target.algorithm],
                distanceFunction: target.distanceFunction,
                avgLatencyMs: avgLatency,
                avgRU: avgRU,
                resultCount,
            });
        } catch (error) {
            if ((error as any).code === 404) {
                console.error(`  ✗ Container '${target.containerName}' not found.`);
            } else {
                console.error(`  ✗ Error:`, (error as Error).message);
            }
        }
    }

    // Print comparison table
    if (benchmarkResults.length > 0) {
        console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
        console.log('║                   Benchmark Comparison Results                       ║');
        console.log('╠══════════════════════════════════════════════════════════════════════╣');
        console.log(
            '║ ' +
            'Algorithm'.padEnd(16) +
            'Distance'.padEnd(14) +
            'Avg Latency'.padEnd(14) +
            'Avg RU'.padEnd(12) +
            'Results'.padEnd(10) +
            '║'
        );
        console.log('╠══════════════════════════════════════════════════════════════════════╣');

        for (const r of benchmarkResults) {
            console.log(
                '║ ' +
                r.algorithm.padEnd(16) +
                r.distanceFunction.padEnd(14) +
                `${r.avgLatencyMs.toFixed(0)}ms`.padEnd(14) +
                r.avgRU.toFixed(2).padEnd(12) +
                String(r.resultCount).padEnd(10) +
                '║'
            );
        }

        console.log('╚══════════════════════════════════════════════════════════════════════╝');
    }
}

main().catch((error) => {
    console.error('Benchmark failed:', error);
    process.exitCode = 1;
});
