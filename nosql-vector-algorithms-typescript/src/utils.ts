import { CosmosClient, BulkOperationType } from '@azure/cosmos';
import { AzureOpenAI } from "openai";
import { promises as fs } from "fs";
import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";

// Define a type for JSON data
export type JsonData = Record<string, any>;

export function getClients(): { aiClient: AzureOpenAI | null; dbClient: CosmosClient | null } {

    let aiClient: AzureOpenAI | null = null;
    let dbClient: CosmosClient | null = null;

    const apiKey = process.env.AZURE_OPENAI_EMBEDDING_KEY!;
    const apiVersion = process.env.AZURE_OPENAI_EMBEDDING_API_VERSION!;
    const endpoint = process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT!;
    const deployment = process.env.AZURE_OPENAI_EMBEDDING_MODEL!;

    if (apiKey && apiVersion && endpoint && deployment) {

        aiClient = new AzureOpenAI({
            apiKey,
            apiVersion,
            endpoint,
            deployment
        });
    }

    const cosmosEndpoint = process.env.AZURE_COSMOSDB_ENDPOINT!;
    const cosmosKey = process.env.AZURE_COSMOSDB_KEY!;

    if (cosmosEndpoint && cosmosKey) {
        dbClient = new CosmosClient({ endpoint: cosmosEndpoint, key: cosmosKey });
    }

    return { aiClient, dbClient };
}

/**
 * Get Azure OpenAI and Cosmos DB clients using passwordless authentication (managed identity)
 * This function uses DefaultAzureCredential for authentication instead of API keys
 * 
 * @returns Object containing AzureOpenAI and CosmosClient instances or null if configuration is missing
 */
export function getClientsPasswordless(): { aiClient: AzureOpenAI | null; dbClient: CosmosClient | null } {
    let aiClient: AzureOpenAI | null = null;
    let dbClient: CosmosClient | null = null;

    // For Azure OpenAI with DefaultAzureCredential
    const apiVersion = process.env.AZURE_OPENAI_EMBEDDING_API_VERSION!;
    const endpoint = process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT!;
    const deployment = process.env.AZURE_OPENAI_EMBEDDING_MODEL!;

    if (apiVersion && endpoint && deployment) {
        const credential = new DefaultAzureCredential();
        const scope = "https://cognitiveservices.azure.com/.default";
        const azureADTokenProvider = getBearerTokenProvider(credential, scope);
        aiClient = new AzureOpenAI({
            apiVersion,
            endpoint,
            deployment,
            azureADTokenProvider
        });
    }

    // For Cosmos DB with DefaultAzureCredential
    const cosmosEndpoint = process.env.AZURE_COSMOSDB_ENDPOINT!;

    if (cosmosEndpoint) {
        const credential = new DefaultAzureCredential();

        dbClient = new CosmosClient({
            endpoint: cosmosEndpoint,
            aadCredentials: credential
        });
    }

    return { aiClient, dbClient };
}

export async function readFileReturnJson(filePath: string): Promise<JsonData[]> {

    console.log(`Reading JSON file from ${filePath}`);

    const fileAsString = await fs.readFile(filePath, "utf-8");
    return JSON.parse(fileAsString);
}

/**
 * Check if a container has any documents
 * @param container - Cosmos DB container reference
 * @returns Number of documents in the container
 */
async function getDocumentCount(container: any): Promise<number> {
    const countResult = await container.items
        .query('SELECT VALUE COUNT(1) FROM c')
        .fetchAll();

    return countResult.resources[0];
}

export async function insertData(container, data): Promise<{ total: number; inserted: number; failed: number; skipped: number; requestCharge: number }> {
    // Check if container already has documents
    const existingCount = await getDocumentCount(container);

    if (existingCount > 0) {
        console.log(`Container already has ${existingCount} documents. Skipping insert.`);
        return { total: 0, inserted: 0, failed: 0, skipped: existingCount, requestCharge: 0 };
    }

    console.log(`Inserting ${data.length} items using executeBulkOperations...`);

    const operations = data.map((item: any) => ({
        operationType: BulkOperationType.Create,
        resourceBody: {
            id: item.HotelId,  // Map HotelId to id (required by Cosmos DB)
            ...item,
        },
        partitionKey: [item.HotelId],
    }));

    let inserted = 0;
    let failed = 0;
    let skipped = 0;
    let totalRequestCharge = 0;

    try {
        const startTime = Date.now();
        console.log(`Starting bulk insert (${operations.length} items)...`);

        const response = await container.items.executeBulkOperations(operations);

        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(2);
        console.log(`Bulk insert completed in ${duration}s`);

        totalRequestCharge += getBulkOperationRUs(response);

        if (response) {
            response.forEach((result: any) => {
                if (result.statusCode >= 200 && result.statusCode < 300) {
                    inserted++;
                } else if (result.statusCode === 409) {
                    skipped++;
                } else {
                    failed++;
                }
            });
        }
    } catch (error) {
        console.error(`Bulk insert failed:`, error);
        failed = operations.length;
    }

    console.log(`\nInsert Request Charge: ${totalRequestCharge.toFixed(2)} RUs\n`);
    return { total: data.length, inserted, failed, skipped, requestCharge: totalRequestCharge };
}

/**
 * Validates a field name to ensure it's a safe identifier for use in queries.
 * Prevents NoSQL injection when using string interpolation in query construction.
 */
export function validateFieldName(fieldName: string): string {
    const validIdentifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

    if (!validIdentifierPattern.test(fieldName)) {
        throw new Error(
            `Invalid field name: "${fieldName}". ` +
            `Field names must start with a letter or underscore and contain only letters, numbers, and underscores.`
        );
    }

    return fieldName;
}

/**
 * Print search results in a consistent format
 */
export function printSearchResults(searchResults: any[], requestCharge?: number): void {
    console.log('\n--- Search Results ---');
    if (!searchResults || searchResults.length === 0) {
        console.log('No results found.');
        return;
    }

    searchResults.forEach((result, index) => {
        console.log(`${index + 1}. ${result.HotelName}, Score: ${result.SimilarityScore.toFixed(4)}`);
    });

    if (requestCharge !== undefined) {
        console.log(`\nVector Search Request Charge: ${requestCharge.toFixed(2)} RUs`);
    }
    console.log('');
}

export function getQueryActivityId(queryResponse: any): string | undefined {
    if (!queryResponse) {
        return undefined;
    }

    const diagnostics = queryResponse.diagnostics as any;
    const gatewayStats = Array.isArray(diagnostics?.clientSideRequestStatistics?.gatewayStatistics)
        ? diagnostics.clientSideRequestStatistics.gatewayStatistics
        : [];
    const gatewayActivityId = gatewayStats.find((entry: any) => entry?.activityId)?.activityId;

    return queryResponse.activityId ?? gatewayActivityId;
}

export function getBulkOperationRUs(response: any): number {
    if (!response) {
        console.warn('Empty response. Cannot calculate RUs from bulk operation.');
        return 0;
    }

    let items: any[] = [];
    if (Array.isArray(response)) {
        items = response;
    } else if (Array.isArray(response.resources)) {
        items = response.resources;
    } else if (Array.isArray(response.results)) {
        items = response.results;
    } else if (Array.isArray(response.result)) {
        items = response.result;
    } else if (typeof response === 'object') {
        items = [response];
    } else {
        console.warn('Response does not contain bulk operation results.');
        return 0;
    }

    let totalRequestCharge = 0;

    items.forEach((result: any) => {
        let requestCharge = 0;

        if (typeof result.requestCharge === 'number') {
            requestCharge = result.requestCharge;
        }

        if (!requestCharge && result.response && typeof result.response.requestCharge === 'number') {
            requestCharge = result.response.requestCharge;
        }

        if (!requestCharge && result.response && typeof result.response.requestCharge === 'string') {
            const parsed = parseFloat(result.response.requestCharge);
            requestCharge = isNaN(parsed) ? 0 : parsed;
        }

        if (!requestCharge && typeof result.requestCharge === 'string') {
            const parsed = parseFloat(result.requestCharge);
            requestCharge = isNaN(parsed) ? 0 : parsed;
        }

        if (!requestCharge && result.operationResponse) {
            const op = result.operationResponse;
            const headerVal = op.headers?.['x-ms-request-charge']
                ?? (typeof op.headers?.get === 'function' ? op.headers.get('x-ms-request-charge') : undefined)
                ?? op._response?.headers?.['x-ms-request-charge'];

            if (headerVal !== undefined) {
                const parsed = parseFloat(headerVal as any);
                requestCharge = isNaN(parsed) ? 0 : parsed;
            }
        }

        if (!requestCharge && result.headers) {
            const hv = result.headers['x-ms-request-charge'] ?? (typeof result.headers.get === 'function' ? result.headers.get('x-ms-request-charge') : undefined);
            if (hv !== undefined) {
                const parsed = parseFloat(hv as any);
                requestCharge = isNaN(parsed) ? 0 : parsed;
            }
        }

        if (!requestCharge) {
            const candidateHeaders =
                result.operationResponse?._response?.headers
                ?? result.operationResponse?.headers
                ?? result._response?.headers
                ?? result.headers;

            const fallback = candidateHeaders ? (candidateHeaders['x-ms-request-charge'] ?? (typeof candidateHeaders.get === 'function' ? candidateHeaders.get('x-ms-request-charge') : undefined)) : undefined;

            if (fallback !== undefined) {
                const parsed = parseFloat(fallback as any);
                requestCharge = isNaN(parsed) ? 0 : parsed;
            }
        }

        totalRequestCharge += requestCharge;
    });

    if (totalRequestCharge === 0) {
        try {
            const sample = items[0];
            const sampleKeys = sample ? Object.keys(sample) : [];
            console.warn('getBulkOperationRUs: no RUs found. Sample result keys:', sampleKeys);
            if (sample && sample.response) {
                try {
                    const respKeys = Object.keys(sample.response);
                    console.warn('  sample.response keys:', respKeys);
                    const hdrs = sample.response.headers ?? sample.response._response?.headers ?? sample.response?.operationResponse?.headers;
                    console.warn('  sample.response headers sample:', hdrs ? Object.keys(hdrs) : hdrs);
                } catch (e) {
                    console.warn('  Could not inspect sample.response for headers:', e);
                }
            }
        } catch (e) {
            console.warn('Could not inspect sample result for debugging:', e);
        }
    }

    return totalRequestCharge;
}

/**
 * Print a side-by-side comparison table of vector search results across containers
 */
export function printComparisonTable(
    results: Array<{
        containerName: string;
        algorithm: string;
        distanceFunction: string;
        searchResults: any[];
        requestCharge: number;
        latencyMs: number;
    }>
): void {
    console.log('\n╔══════════════════════════════════════════════════════════════════════════════════╗');
    console.log('║                     Vector Algorithm Comparison Results                         ║');
    console.log('╠══════════════════════════════════════════════════════════════════════════════════╣');

    // Header
    console.log(
        '║ ' +
        'Algorithm'.padEnd(16) +
        'Distance'.padEnd(14) +
        'Top Result'.padEnd(22) +
        'Score'.padEnd(10) +
        'RU'.padEnd(10) +
        'ms'.padEnd(8) +
        '║'
    );
    console.log('╠══════════════════════════════════════════════════════════════════════════════════╣');

    for (const r of results) {
        const topResult = r.searchResults[0];
        const topName = topResult ? (topResult.HotelName as string).substring(0, 20) : 'N/A';
        const topScore = topResult ? topResult.SimilarityScore.toFixed(4) : 'N/A';

        console.log(
            '║ ' +
            r.algorithm.padEnd(16) +
            r.distanceFunction.padEnd(14) +
            topName.padEnd(22) +
            topScore.padEnd(10) +
            r.requestCharge.toFixed(2).padEnd(10) +
            r.latencyMs.toFixed(0).padEnd(8) +
            '║'
        );
    }

    console.log('╚══════════════════════════════════════════════════════════════════════════════════╝');

    // Detailed results per container
    for (const r of results) {
        console.log(`\n--- ${r.algorithm} / ${r.distanceFunction} (${r.containerName}) ---`);
        if (r.searchResults.length === 0) {
            console.log('  No results.');
            continue;
        }
        r.searchResults.forEach((item, i) => {
            console.log(`  ${i + 1}. ${item.HotelName}, Score: ${item.SimilarityScore.toFixed(4)}`);
        });
        console.log(`  RU: ${r.requestCharge.toFixed(2)} | Latency: ${r.latencyMs.toFixed(0)}ms`);
    }
}
