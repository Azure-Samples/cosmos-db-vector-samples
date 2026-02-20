/**
 * Verify Vector Setup
 * 
 * Validates that the Azure Cosmos DB NoSQL vector search infrastructure
 * is configured correctly by running a series of diagnostic checks:
 * 
 * 1. Environment variables - all required settings are present
 * 2. Azure OpenAI connectivity - embedding model responds correctly
 * 3. Embedding dimensions - model output matches configured dimensions
 * 4. Cosmos DB connectivity - database and containers are accessible
 * 5. Stored data validation - documents contain the expected vector field
 * 6. Stored vector dimensions - stored vectors match configured dimensions
 * 7. Container policy alignment - vectorEmbeddingPolicy path matches indexingPolicy vectorIndexes path
 * 8. Vector search execution - VectorDistance returns non-null scores
 * 9. Result ordering - results are ordered by relevance, not insertion order
 * 10. Model consistency - query embedding dimensions match stored dimensions
 */
import { getClientsPasswordless, validateFieldName } from '../utils.js';

// ESM specific features
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface CheckResult {
    name: string;
    passed: boolean;
    message: string;
    details?: string;
}

const config = {
    query: "quintessential lodging near running trails, eateries, retail",
    dbName: process.env.AZURE_COSMOSDB_DATABASENAME || "Hotels",
    containers: ["hotels_diskann", "hotels_quantizedflat"],
    embeddedField: process.env.EMBEDDED_FIELD!,
    embeddingDimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || '1536', 10),
    deployment: process.env.AZURE_OPENAI_EMBEDDING_MODEL!,
    distanceFunction: process.env.VECTOR_DISTANCE_FUNCTION || 'cosine',
};

// ─── Individual check functions ───────────────────────────────────────────────

function checkEnvironmentVariables(): CheckResult {
    const required: Record<string, string | undefined> = {
        AZURE_COSMOSDB_ENDPOINT: process.env.AZURE_COSMOSDB_ENDPOINT,
        AZURE_OPENAI_EMBEDDING_ENDPOINT: process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT,
        AZURE_OPENAI_EMBEDDING_MODEL: process.env.AZURE_OPENAI_EMBEDDING_MODEL,
        AZURE_OPENAI_EMBEDDING_API_VERSION: process.env.AZURE_OPENAI_EMBEDDING_API_VERSION,
        EMBEDDED_FIELD: process.env.EMBEDDED_FIELD,
        EMBEDDING_DIMENSIONS: process.env.EMBEDDING_DIMENSIONS,
    };

    const missing = Object.entries(required)
        .filter(([, value]) => !value)
        .map(([key]) => key);

    if (missing.length > 0) {
        return {
            name: "Environment variables",
            passed: false,
            message: `Missing required variables: ${missing.join(", ")}`,
            details: "Ensure your .env file is loaded and all required variables are set.",
        };
    }
    return { name: "Environment variables", passed: true, message: "All required variables present" };
}

function checkClients(
    aiClient: unknown,
    dbClient: unknown
): CheckResult {
    if (!aiClient) {
        return {
            name: "Client initialization",
            passed: false,
            message: "Azure OpenAI client is not configured. Check your environment variables.",
        };
    }
    if (!dbClient) {
        return {
            name: "Client initialization",
            passed: false,
            message: "Cosmos DB client is not configured. Check your environment variables.",
        };
    }
    return { name: "Client initialization", passed: true, message: "Both clients initialized" };
}

async function checkEmbeddingModel(
    aiClient: any,
    deployment: string,
    expectedDimensions: number
): Promise<CheckResult> {
    try {
        const response = await aiClient.embeddings.create({
            model: deployment,
            input: ["test"],
        });

        const actualDimensions = response.data[0].embedding.length;

        if (actualDimensions !== expectedDimensions) {
            return {
                name: "Embedding model dimensions",
                passed: false,
                message: `Dimension mismatch: model '${deployment}' returns ${actualDimensions} dimensions but EMBEDDING_DIMENSIONS is set to ${expectedDimensions}`,
                details: "The embedding model dimensions must match the container's vectorEmbeddingPolicy dimensions and EMBEDDING_DIMENSIONS env var. A mismatch causes null VectorDistance scores.",
            };
        }

        return {
            name: "Embedding model dimensions",
            passed: true,
            message: `Model '${deployment}' returns ${actualDimensions} dimensions (matches config)`,
        };
    } catch (error: any) {
        return {
            name: "Embedding model dimensions",
            passed: false,
            message: `Failed to call embedding model: ${error.message}`,
        };
    }
}

async function checkContainerAccess(
    dbClient: any,
    dbName: string,
    containerName: string
): Promise<CheckResult> {
    try {
        const database = dbClient.database(dbName);
        const container = database.container(containerName);
        await container.read();

        return {
            name: `Container access (${containerName})`,
            passed: true,
            message: `Container '${containerName}' in database '${dbName}' is accessible`,
        };
    } catch (error: any) {
        return {
            name: `Container access (${containerName})`,
            passed: false,
            message: error.code === 404
                ? `Container '${containerName}' or database '${dbName}' not found. Run 'azd up' to create resources.`
                : `Access failed: ${error.message}`,
        };
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
        const database = dbClient.database(dbName);
        const container = database.container(containerName);

        // Check if documents exist at all
        const countResult = await container.items
            .query("SELECT VALUE COUNT(1) FROM c")
            .fetchAll();

        const totalCount = countResult.resources[0] ?? 0;
        if (totalCount === 0) {
            return {
                name: `Stored vectors (${containerName})`,
                passed: false,
                message: "No documents found. Insert data before running validation.",
            };
        }

        // Check if documents have the vector field
        const vectorCountResult = await container.items
            .query(`SELECT VALUE COUNT(1) FROM c WHERE IS_ARRAY(c.${safeField})`)
            .fetchAll();

        const vectorCount = vectorCountResult.resources[0] ?? 0;
        if (vectorCount === 0) {
            return {
                name: `Stored vectors (${containerName})`,
                passed: false,
                message: `None of ${totalCount} documents contain the vector field '${embeddedField}'. Re-run embedding generation.`,
                details: "Documents must have the vector field populated before vector search will work.",
            };
        }

        // Sample a document to verify vector dimensions
        const sampleResult = await container.items
            .query(`SELECT TOP 1 ARRAY_LENGTH(c.${safeField}) AS dims FROM c WHERE IS_ARRAY(c.${safeField})`)
            .fetchAll();

        const storedDims = sampleResult.resources[0]?.dims;

        if (storedDims !== expectedDimensions) {
            return {
                name: `Stored vectors (${containerName})`,
                passed: false,
                message: `Stored vector dimensions (${storedDims}) do not match expected (${expectedDimensions}). Data may have been embedded with a different model.`,
                details: "If the stored dimensions don't match the query embedding dimensions, VectorDistance returns null. Re-embed the data with the correct model.",
            };
        }

        return {
            name: `Stored vectors (${containerName})`,
            passed: true,
            message: `${vectorCount}/${totalCount} documents have ${storedDims}-dim vectors in '${embeddedField}'`,
        };
    } catch (error: any) {
        return {
            name: `Stored vectors (${containerName})`,
            passed: false,
            message: `Check failed: ${error.message}`,
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
        const database = dbClient.database(dbName);
        const container = database.container(containerName);
        const { resource } = await container.read();

        if (!resource) {
            return {
                name: `Container policies (${containerName})`,
                passed: false,
                message: "Could not read container definition.",
            };
        }

        const issues: string[] = [];

        // Extract vector embedding policy paths
        const vectorEmbeddings: any[] = resource.vectorEmbeddingPolicy?.vectorEmbeddings ?? [];
        const embeddingPaths = vectorEmbeddings.map((v: any) => v.path as string);

        // Extract indexing policy vector index paths
        const vectorIndexes: any[] = resource.indexingPolicy?.vectorIndexes ?? [];
        const indexPaths = vectorIndexes.map((v: any) => v.path as string);

        if (embeddingPaths.length === 0) {
            issues.push("No vectorEmbeddingPolicy paths defined on the container.");
        }
        if (indexPaths.length === 0) {
            issues.push("No vectorIndexes defined in the indexingPolicy.");
        }

        // Check that every vectorEmbeddingPolicy path has a corresponding vectorIndex
        const missingIndexes = embeddingPaths.filter((p) => !indexPaths.includes(p));
        if (missingIndexes.length > 0) {
            issues.push(`vectorEmbeddingPolicy paths missing from indexingPolicy vectorIndexes: ${missingIndexes.join(", ")}`);
        }

        // Check that every vectorIndex has a corresponding vectorEmbeddingPolicy path
        const extraIndexes = indexPaths.filter((p) => !embeddingPaths.includes(p));
        if (extraIndexes.length > 0) {
            issues.push(`vectorIndexes paths not in vectorEmbeddingPolicy: ${extraIndexes.join(", ")}`);
        }

        // Check that EMBEDDED_FIELD matches a path in the policies
        const expectedPath = `/${embeddedField}`;
        if (embeddingPaths.length > 0 && !embeddingPaths.includes(expectedPath)) {
            issues.push(`EMBEDDED_FIELD '${embeddedField}' (path '${expectedPath}') not found in vectorEmbeddingPolicy paths: ${embeddingPaths.join(", ")}`);
        }
        if (indexPaths.length > 0 && !indexPaths.includes(expectedPath)) {
            issues.push(`EMBEDDED_FIELD '${embeddedField}' (path '${expectedPath}') not found in vectorIndexes paths: ${indexPaths.join(", ")}`);
        }

        // Validate dimensions and distance function for the matching embedding policy
        const matchingEmbedding = vectorEmbeddings.find((v: any) => v.path === expectedPath);
        if (matchingEmbedding) {
            if (matchingEmbedding.dimensions !== expectedDimensions) {
                issues.push(
                    `vectorEmbeddingPolicy dimensions (${matchingEmbedding.dimensions}) != EMBEDDING_DIMENSIONS (${expectedDimensions}). A mismatch causes null VectorDistance scores.`
                );
            }
            if (matchingEmbedding.distanceFunction && matchingEmbedding.distanceFunction !== expectedDistanceFunction) {
                issues.push(
                    `vectorEmbeddingPolicy distanceFunction '${matchingEmbedding.distanceFunction}' != configured '${expectedDistanceFunction}'.`
                );
            }
        }

        if (issues.length > 0) {
            return {
                name: `Container policies (${containerName})`,
                passed: false,
                message: issues[0],
                details: issues.length > 1 ? issues.slice(1).join(" | ") : undefined,
            };
        }

        const indexType = vectorIndexes.find((v: any) => v.path === expectedPath)?.type ?? "unknown";
        return {
            name: `Container policies (${containerName})`,
            passed: true,
            message: `Path '${expectedPath}' aligned in vectorEmbeddingPolicy and vectorIndexes (type: ${indexType}, dims: ${matchingEmbedding?.dimensions}, dist: ${matchingEmbedding?.distanceFunction})`,
        };
    } catch (error: any) {
        return {
            name: `Container policies (${containerName})`,
            passed: false,
            message: `Policy check failed: ${error.message}`,
        };
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

        // Generate a query embedding
        const embeddingResponse = await aiClient.embeddings.create({
            model: deployment,
            input: [query],
        });
        const queryVector = embeddingResponse.data[0].embedding;

        const database = dbClient.database(dbName);
        const container = database.container(containerName);

        // Run vector search with projected score
        const queryText = `SELECT TOP 5 c.HotelName, c.Description, VectorDistance(c.${safeField}, @embedding) AS SimilarityScore FROM c ORDER BY VectorDistance(c.${safeField}, @embedding)`;

        const response = await container.items
            .query({
                query: queryText,
                parameters: [{ name: "@embedding", value: queryVector }],
            })
            .fetchAll();

        const results = response.resources;

        if (!results || results.length === 0) {
            return {
                name: `Vector search (${containerName})`,
                passed: false,
                message: "Query returned no results. Container may be empty or query path may be incorrect.",
            };
        }

        // Check 1: Are scores non-null?
        const nullScores = results.filter((r: any) => r.SimilarityScore === null || r.SimilarityScore === undefined);
        if (nullScores.length > 0) {
            return {
                name: `Vector search (${containerName})`,
                passed: false,
                message: `${nullScores.length}/${results.length} results have null SimilarityScore. This indicates a dimension mismatch or incorrect vector path.`,
                details: "When the vector path is wrong or dimensions don't match, Cosmos DB returns null scores silently (no error). Verify: (1) EMBEDDED_FIELD matches the container vectorEmbeddingPolicy path, (2) stored vector dimensions match the embedding model, (3) EMBEDDING_DIMENSIONS matches both.",
            };
        }

        // Check 2: Are results ordered by relevance (not insertion order)?
        const scores = results.map((r: any) => r.SimilarityScore as number);
        const isDescending = scores.every((score: number, i: number) => i === 0 || scores[i - 1] >= score);

        if (!isDescending) {
            return {
                name: `Vector search (${containerName})`,
                passed: false,
                message: "Results are NOT ordered by descending similarity score. The vector index may not be functioning correctly.",
                details: `Scores: ${scores.map((s: number) => s.toFixed(4)).join(", ")}. If results appear in insertion order rather than relevance order, the vector distance computation may not be working.`,
            };
        }

        // Check 3: Do scores vary (not all identical)?
        const uniqueScores = new Set(scores.map((s: number) => s.toFixed(6)));
        const scoresVary = uniqueScores.size > 1;

        const scoreRange = `[${Math.min(...scores).toFixed(4)} – ${Math.max(...scores).toFixed(4)}]`;

        return {
            name: `Vector search (${containerName})`,
            passed: true,
            message: `${results.length} results returned. Scores ${scoresVary ? "vary" : "are identical"}, range: ${scoreRange}, RU: ${response.requestCharge?.toFixed(2) ?? "n/a"}`,
            details: scoresVary
                ? undefined
                : "All scores are identical, which may indicate the vector index is not differentiating results. This can be normal for small datasets with similar content.",
        };
    } catch (error: any) {
        return {
            name: `Vector search (${containerName})`,
            passed: false,
            message: `Search failed: ${error.message}`,
        };
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log("=== Azure Cosmos DB Vector Search Setup Validation ===\n");

    const results: CheckResult[] = [];

    // 1. Environment variables
    const envCheck = checkEnvironmentVariables();
    results.push(envCheck);
    printCheck(envCheck);
    if (!envCheck.passed) {
        printSummary(results);
        return;
    }

    // 2. Client initialization
    const { aiClient, dbClient } = getClientsPasswordless();
    const clientCheck = checkClients(aiClient, dbClient);
    results.push(clientCheck);
    printCheck(clientCheck);
    if (!clientCheck.passed) {
        printSummary(results);
        return;
    }

    // 3. Embedding model check
    const embeddingCheck = await checkEmbeddingModel(aiClient!, config.deployment, config.embeddingDimensions);
    results.push(embeddingCheck);
    printCheck(embeddingCheck);

    // 4-8. Per-container checks
    for (const containerName of config.containers) {
        console.log(`\n--- Container: ${containerName} ---`);

        const accessCheck = await checkContainerAccess(dbClient!, config.dbName, containerName);
        results.push(accessCheck);
        printCheck(accessCheck);
        if (!accessCheck.passed) continue;

        const policyCheck = await checkContainerPolicies(dbClient!, config.dbName, containerName, config.embeddedField, config.embeddingDimensions, config.distanceFunction);
        results.push(policyCheck);
        printCheck(policyCheck);

        const storedCheck = await checkStoredVectors(dbClient!, config.dbName, containerName, config.embeddedField, config.embeddingDimensions);
        results.push(storedCheck);
        printCheck(storedCheck);
        if (!storedCheck.passed) continue;

        const searchCheck = await checkVectorSearch(
            dbClient!, aiClient!, config.dbName, containerName,
            config.embeddedField, config.deployment, config.query
        );
        results.push(searchCheck);
        printCheck(searchCheck);
    }

    printSummary(results);
}

function printCheck(check: CheckResult): void {
    const icon = check.passed ? "PASS" : "FAIL";
    console.log(`  [${icon}] ${check.name}: ${check.message}`);
    if (check.details) {
        console.log(`         ${check.details}`);
    }
}

function printSummary(results: CheckResult[]): void {
    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;

    console.log("\n=== Summary ===");
    console.log(`  Passed: ${passed}  |  Failed: ${failed}  |  Total: ${results.length}`);

    if (failed > 0) {
        console.log("\nFailed checks:");
        results.filter((r) => !r.passed).forEach((r) => {
            console.log(`  - ${r.name}: ${r.message}`);
        });
        console.log("\nCommon issues:");
        console.log("  1. Embedding model mismatch: Ensure the same model is used for both data vectors and query vectors.");
        console.log("  2. Dimension mismatch: If dimensions don't match, VectorDistance returns null (no error).");
        console.log("  3. Wrong vector path: If the query path is incorrect, scores are null with no error message.");
        console.log("  4. Policy path mismatch: The vectorEmbeddingPolicy path and indexingPolicy vectorIndexes path must match.");
        console.log("  5. Insertion order results: If results appear in insertion order, the vector computation is not working.");
        console.log("  6. Missing resources: Run 'azd up' to provision the database and containers.");
    } else {
        console.log("\nAll checks passed. Vector search is configured correctly.");
    }

    process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((error) => {
    console.error("Validation failed with unhandled error:", error);
    process.exitCode = 1;
});