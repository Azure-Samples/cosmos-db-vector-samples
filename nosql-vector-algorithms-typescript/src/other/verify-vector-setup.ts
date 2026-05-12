/**
 * Verify Vector Setup
 *
 * Validates that the Azure Cosmos DB vector algorithm comparison infrastructure
 * is configured correctly by checking:
 *
 * 1. Environment variables — all required settings are present
 * 2. Client initialization — Azure OpenAI and Cosmos DB clients connect
 * 3. Embedding model — model responds and returns expected dimensions
 * 4. Container access — each expected container exists and is accessible
 * 5. Container policies — vectorEmbeddingPolicy and indexingPolicy are aligned
 * 6. Stored vectors — documents contain vectors with correct dimensions
 * 7. Vector search — VectorDistance returns non-null, ordered scores
 */
import { getClientsPasswordless, validateFieldName } from '../utils.js';

type VectorAlgorithm = 'quantizedflat' | 'diskann';
type DistanceFunction = 'cosine' | 'dotproduct' | 'euclidean';

const ALGORITHMS: VectorAlgorithm[] = ['quantizedflat', 'diskann'];
const DISTANCE_FUNCTIONS: DistanceFunction[] = ['cosine', 'dotproduct', 'euclidean'];

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

interface CheckResult {
    name: string;
    passed: boolean;
    message: string;
    details?: string;
}

function checkEnvironmentVariables(): CheckResult {
    const required: Record<string, string | undefined> = {
        AZURE_COSMOSDB_ENDPOINT: process.env.AZURE_COSMOSDB_ENDPOINT,
        AZURE_OPENAI_EMBEDDING_ENDPOINT: process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT,
        AZURE_OPENAI_EMBEDDING_MODEL: process.env.AZURE_OPENAI_EMBEDDING_MODEL,
        AZURE_OPENAI_EMBEDDING_API_VERSION: process.env.AZURE_OPENAI_EMBEDDING_API_VERSION,
        EMBEDDED_FIELD: process.env.EMBEDDED_FIELD,
    };

    const missing = Object.entries(required)
        .filter(([, value]) => !value)
        .map(([key]) => key);

    if (missing.length > 0) {
        return {
            name: 'Environment variables',
            passed: false,
            message: `Missing required variables: ${missing.join(', ')}`,
            details: 'Ensure your .env file is loaded and all required variables are set.',
        };
    }
    return { name: 'Environment variables', passed: true, message: 'All required variables present' };
}

function checkClients(aiClient: unknown, dbClient: unknown): CheckResult {
    if (!aiClient) {
        return { name: 'Client initialization', passed: false, message: 'Azure OpenAI client is not configured.' };
    }
    if (!dbClient) {
        return { name: 'Client initialization', passed: false, message: 'Cosmos DB client is not configured.' };
    }
    return { name: 'Client initialization', passed: true, message: 'Both clients initialized' };
}

async function checkEmbeddingModel(aiClient: any, deployment: string, expectedDimensions: number): Promise<CheckResult> {
    try {
        const response = await aiClient.embeddings.create({ model: deployment, input: ['test'] });
        const actualDimensions = response.data[0].embedding.length;

        if (actualDimensions !== expectedDimensions) {
            return {
                name: 'Embedding model dimensions',
                passed: false,
                message: `Dimension mismatch: model returns ${actualDimensions} but expected ${expectedDimensions}`,
            };
        }
        return {
            name: 'Embedding model dimensions',
            passed: true,
            message: `Model '${deployment}' returns ${actualDimensions} dimensions (matches config)`,
        };
    } catch (error: any) {
        return { name: 'Embedding model dimensions', passed: false, message: `Failed: ${error.message}` };
    }
}

async function checkContainerAccess(dbClient: any, dbName: string, containerName: string): Promise<CheckResult> {
    try {
        const container = dbClient.database(dbName).container(containerName);
        await container.read();
        return { name: `Container access (${containerName})`, passed: true, message: 'Accessible' };
    } catch (error: any) {
        return {
            name: `Container access (${containerName})`,
            passed: false,
            message: error.code === 404
                ? `Container '${containerName}' not found. Run scripts/create-resources.sh.`
                : `Access failed: ${error.message}`,
        };
    }
}

async function checkContainerPolicies(
    dbClient: any,
    dbName: string,
    containerName: string,
    embeddedField: string,
    expectedDimensions: number,
    expectedDistanceFunction: string
): Promise<CheckResult> {
    try {
        const container = dbClient.database(dbName).container(containerName);
        const { resource } = await container.read();

        if (!resource) {
            return { name: `Container policies (${containerName})`, passed: false, message: 'Could not read container definition.' };
        }

        const issues: string[] = [];
        const vectorEmbeddings: any[] = resource.vectorEmbeddingPolicy?.vectorEmbeddings ?? [];
        const vectorIndexes: any[] = resource.indexingPolicy?.vectorIndexes ?? [];
        const expectedPath = `/${embeddedField}`;

        if (vectorEmbeddings.length === 0) issues.push('No vectorEmbeddingPolicy defined.');
        if (vectorIndexes.length === 0) issues.push('No vectorIndexes defined.');

        const matchingEmbedding = vectorEmbeddings.find((v: any) => v.path === expectedPath);
        if (matchingEmbedding) {
            if (matchingEmbedding.dimensions !== expectedDimensions) {
                issues.push(`Dimensions mismatch: policy=${matchingEmbedding.dimensions}, expected=${expectedDimensions}`);
            }
            if (matchingEmbedding.distanceFunction && matchingEmbedding.distanceFunction !== expectedDistanceFunction) {
                issues.push(`Distance function mismatch: policy='${matchingEmbedding.distanceFunction}', expected='${expectedDistanceFunction}'`);
            }
        }

        const indexType = vectorIndexes.find((v: any) => v.path === expectedPath)?.type ?? 'unknown';

        if (issues.length > 0) {
            return { name: `Container policies (${containerName})`, passed: false, message: issues.join(' | ') };
        }
        return {
            name: `Container policies (${containerName})`,
            passed: true,
            message: `Index type: ${indexType}, dims: ${matchingEmbedding?.dimensions}, dist: ${matchingEmbedding?.distanceFunction}`,
        };
    } catch (error: any) {
        return { name: `Container policies (${containerName})`, passed: false, message: `Policy check failed: ${error.message}` };
    }
}

async function checkStoredVectors(
    dbClient: any,
    dbName: string,
    containerName: string,
    embeddedField: string,
    expectedDimensions: number
): Promise<CheckResult> {
    try {
        const safeField = validateFieldName(embeddedField);
        const container = dbClient.database(dbName).container(containerName);

        const countResult = await container.items.query('SELECT VALUE COUNT(1) FROM c').fetchAll();
        const totalCount = countResult.resources[0] ?? 0;

        if (totalCount === 0) {
            return { name: `Stored vectors (${containerName})`, passed: false, message: 'No documents found. Insert data first.' };
        }

        const vectorCountResult = await container.items
            .query(`SELECT VALUE COUNT(1) FROM c WHERE IS_ARRAY(c.${safeField})`)
            .fetchAll();
        const vectorCount = vectorCountResult.resources[0] ?? 0;

        if (vectorCount === 0) {
            return {
                name: `Stored vectors (${containerName})`,
                passed: false,
                message: `None of ${totalCount} documents contain vector field '${embeddedField}'.`,
            };
        }

        const sampleResult = await container.items
            .query(`SELECT TOP 1 ARRAY_LENGTH(c.${safeField}) AS dims FROM c WHERE IS_ARRAY(c.${safeField})`)
            .fetchAll();
        const storedDims = sampleResult.resources[0]?.dims;

        if (storedDims !== expectedDimensions) {
            return {
                name: `Stored vectors (${containerName})`,
                passed: false,
                message: `Stored dims (${storedDims}) != expected (${expectedDimensions}).`,
            };
        }

        return {
            name: `Stored vectors (${containerName})`,
            passed: true,
            message: `${vectorCount}/${totalCount} documents have ${storedDims}-dim vectors`,
        };
    } catch (error: any) {
        return { name: `Stored vectors (${containerName})`, passed: false, message: `Check failed: ${error.message}` };
    }
}

async function checkVectorSearch(
    dbClient: any,
    aiClient: any,
    dbName: string,
    containerName: string,
    embeddedField: string,
    deployment: string,
    query: string
): Promise<CheckResult> {
    try {
        const safeField = validateFieldName(embeddedField);
        const embeddingResponse = await aiClient.embeddings.create({ model: deployment, input: [query] });
        const queryVector = embeddingResponse.data[0].embedding;

        const container = dbClient.database(dbName).container(containerName);
        const queryText = `SELECT TOP 5 c.HotelName, VectorDistance(c.${safeField}, @embedding) AS SimilarityScore FROM c ORDER BY VectorDistance(c.${safeField}, @embedding)`;

        const response = await container.items
            .query({ query: queryText, parameters: [{ name: '@embedding', value: queryVector }] })
            .fetchAll();

        const results = response.resources;
        if (!results || results.length === 0) {
            return { name: `Vector search (${containerName})`, passed: false, message: 'No results returned.' };
        }

        const nullScores = results.filter((r: any) => r.SimilarityScore == null);
        if (nullScores.length > 0) {
            return {
                name: `Vector search (${containerName})`,
                passed: false,
                message: `${nullScores.length}/${results.length} results have null scores. Dimension or path mismatch.`,
            };
        }

        const scores = results.map((r: any) => r.SimilarityScore as number);
        const isDescending = scores.every((s: number, i: number) => i === 0 || scores[i - 1] >= s);
        const scoreRange = `[${Math.min(...scores).toFixed(4)} – ${Math.max(...scores).toFixed(4)}]`;

        if (!isDescending) {
            return {
                name: `Vector search (${containerName})`,
                passed: false,
                message: `Results not ordered by similarity. Scores: ${scores.map((s: number) => s.toFixed(4)).join(', ')}`,
            };
        }

        return {
            name: `Vector search (${containerName})`,
            passed: true,
            message: `${results.length} results, score range: ${scoreRange}, RU: ${response.requestCharge?.toFixed(2) ?? 'n/a'}`,
        };
    } catch (error: any) {
        return { name: `Vector search (${containerName})`, passed: false, message: `Search failed: ${error.message}` };
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log('=== Azure Cosmos DB Vector Algorithm Setup Validation ===\n');

    const embeddedField = process.env.EMBEDDED_FIELD || 'DescriptionVector';
    const dbName = process.env.AZURE_COSMOSDB_DATABASENAME || 'Hotels';
    const deployment = process.env.AZURE_OPENAI_EMBEDDING_MODEL!;
    const expectedDimensions = parseInt(process.env.EMBEDDING_DIMENSIONS || '1536', 10);
    const algorithmEnv = (process.env.VECTOR_ALGORITHM || 'all').trim().toLowerCase();
    const distanceEnv = (process.env.VECTOR_DISTANCE_FUNCTION || 'all').trim().toLowerCase();
    const searchQuery = 'quintessential lodging near running trails, eateries, retail';

    const targets = getTargetContainers(algorithmEnv, distanceEnv);
    const results: CheckResult[] = [];

    // 1. Environment variables
    const envCheck = checkEnvironmentVariables();
    results.push(envCheck);
    printCheck(envCheck);
    if (!envCheck.passed) { printSummary(results); return; }

    // 2. Client initialization
    const { aiClient, dbClient } = getClientsPasswordless();
    const clientCheck = checkClients(aiClient, dbClient);
    results.push(clientCheck);
    printCheck(clientCheck);
    if (!clientCheck.passed) { printSummary(results); return; }

    // 3. Embedding model check
    const embeddingCheck = await checkEmbeddingModel(aiClient!, deployment, expectedDimensions);
    results.push(embeddingCheck);
    printCheck(embeddingCheck);

    // 4-7. Per-container checks
    for (const target of targets) {
        console.log(`\n--- Container: ${target.containerName} (${target.algorithm}/${target.distanceFunction}) ---`);

        const accessCheck = await checkContainerAccess(dbClient!, dbName, target.containerName);
        results.push(accessCheck);
        printCheck(accessCheck);
        if (!accessCheck.passed) continue;

        const policyCheck = await checkContainerPolicies(
            dbClient!, dbName, target.containerName, embeddedField, expectedDimensions, target.distanceFunction
        );
        results.push(policyCheck);
        printCheck(policyCheck);

        const storedCheck = await checkStoredVectors(dbClient!, dbName, target.containerName, embeddedField, expectedDimensions);
        results.push(storedCheck);
        printCheck(storedCheck);
        if (!storedCheck.passed) continue;

        const searchCheck = await checkVectorSearch(
            dbClient!, aiClient!, dbName, target.containerName, embeddedField, deployment, searchQuery
        );
        results.push(searchCheck);
        printCheck(searchCheck);
    }

    printSummary(results);
}

function printCheck(check: CheckResult): void {
    const icon = check.passed ? 'PASS' : 'FAIL';
    console.log(`  [${icon}] ${check.name}: ${check.message}`);
    if (check.details) {
        console.log(`         ${check.details}`);
    }
}

function printSummary(results: CheckResult[]): void {
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;

    console.log('\n=== Summary ===');
    console.log(`  Passed: ${passed}  |  Failed: ${failed}  |  Total: ${results.length}`);

    if (failed > 0) {
        console.log('\nFailed checks:');
        results.filter(r => !r.passed).forEach(r => {
            console.log(`  - ${r.name}: ${r.message}`);
        });
        console.log('\nCommon issues:');
        console.log('  1. Missing containers: Run scripts/create-resources.sh to provision all 6 containers.');
        console.log('  2. Dimension mismatch: VectorDistance returns null silently when dimensions differ.');
        console.log('  3. Wrong vector path: Verify EMBEDDED_FIELD matches the container vectorEmbeddingPolicy path.');
    } else {
        console.log('\nAll checks passed. Vector algorithm comparison infrastructure is correctly configured.');
    }

    process.exitCode = failed > 0 ? 1 : 0;
}

main().catch(error => {
    console.error('Validation failed with unhandled error:', error);
    process.exitCode = 1;
});
