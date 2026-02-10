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

    // Cosmos DB connection string or endpoint/key
    // You may need to use endpoint and key separately for CosmosClient
    const cosmosEndpoint = process.env.COSMOS_ENDPOINT!;
    const cosmosKey = process.env.COSMOS_KEY!;

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
    const cosmosEndpoint = process.env.COSMOS_ENDPOINT!;

    if (cosmosEndpoint) {
        const credential = new DefaultAzureCredential();

        dbClient = new CosmosClient({
            endpoint: cosmosEndpoint,
            aadCredentials: credential // Use DefaultAzureCredential instead of key
        });
    }

    return { aiClient, dbClient };
}
export async function readFileReturnJson(filePath: string): Promise<JsonData[]> {

    console.log(`Reading JSON file from ${filePath}`);

    const fileAsString = await fs.readFile(filePath, "utf-8");
    return JSON.parse(fileAsString);
}
export async function writeFileJson(filePath: string, jsonData: JsonData): Promise<void> {
    const jsonString = JSON.stringify(jsonData, null, 2);
    await fs.writeFile(filePath, jsonString, "utf-8");

    console.log(`Wrote JSON file to ${filePath}`);
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

export async function insertData(config, container, data) {
    // Check if container already has documents
    const existingCount = await getDocumentCount(container);

    if (existingCount > 0) {
        console.log(`Container already has ${existingCount} documents. Skipping insert.`);
        return { total: 0, inserted: 0, failed: 0, skipped: existingCount, requestCharge: 0 };
    }

    // Cosmos DB uses containers instead of collections
    // Use SDK bulk operations; let SDK handle batching, dispatch, and throttling
    console.log(`Inserting ${data.length} items using executeBulkOperations...`);

    // Prepare bulk operations for all items
    const operations = data.map((item: any) => ({
        operationType: BulkOperationType.Create,
        resourceBody: {
            id: item.HotelId,  // Map HotelId to id (required by Cosmos DB)
            ...item,
        },
        // Partition key must be passed as array: [value] for /HotelId partition
        partitionKey: [item.HotelId],
    }));

    let inserted = 0;
    let failed = 0;
    let totalRequestCharge = 0;

    try {
        const startTime = Date.now();
        console.log(`Starting bulk insert (${operations.length} items)...`);

        const response = await container.items.executeBulkOperations(operations);

        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(2);
        console.log(`Bulk insert completed in ${duration}s`);

        totalRequestCharge += getBulkOperationRUs(response);

        // Count inserted and failed
        if (response) {
            response.forEach((result: any) => {
                if (result.statusCode >= 200 && result.statusCode < 300) {
                    inserted++;
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
    return { total: data.length, inserted, failed, requestCharge: totalRequestCharge };
}

/**
 * Validates a field name to ensure it's a safe identifier for use in queries.
 * This prevents NoSQL injection when using string interpolation in query construction.
 * 
 * @param fieldName - The field name to validate
 * @returns The validated field name
 * @throws Error if the field name contains invalid characters
 * 
 * @example
 * ```typescript
 * const safeField = validateFieldName(config.embeddedField);
 * const query = `SELECT * FROM c WHERE c.${safeField} = @value`;
 * ```
 */
export function validateFieldName(fieldName: string): string {
    // Allow only alphanumeric characters and underscores, must start with letter or underscore
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
export function printSearchResults(insertSummary: any, searchResults: any[], requestCharge?: number): void {
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

export function getBulkOperationRUs(response: any): number {
    // Response shape can vary depending on SDK/version:
    // - An array of operation results
    // - An object with `resources` or `results` array
    // - A single operation result object
    if (!response) {
        console.warn('Empty response. Cannot calculate RUs from bulk operation.');
        return 0;
    }

    // Normalize into an array of result items
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
        // If it's a single operation result, wrap it so downstream logic is uniform
        items = [response];
    } else {
        console.warn('Response does not contain bulk operation results.');
        return 0;
    }

    let totalRequestCharge = 0;

    items.forEach((result: any) => {
        let requestCharge = 0;

        // 1) Direct numeric property
        if (typeof result.requestCharge === 'number') {
            requestCharge = result.requestCharge;
        }

        // 1b) Some SDKs nest the operation response under `response` and expose requestCharge there
        if (!requestCharge && result.response && typeof result.response.requestCharge === 'number') {
            requestCharge = result.response.requestCharge;
        }

        if (!requestCharge && result.response && typeof result.response.requestCharge === 'string') {
            const parsed = parseFloat(result.response.requestCharge);
            requestCharge = isNaN(parsed) ? 0 : parsed;
        }

        // 2) String numeric value
        if (!requestCharge && typeof result.requestCharge === 'string') {
            const parsed = parseFloat(result.requestCharge);
            requestCharge = isNaN(parsed) ? 0 : parsed;
        }

        // 3) operationResponse may contain headers in different shapes
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

        // 4) Some responses include headers at top-level or in `headers`
        if (!requestCharge && result.headers) {
            const hv = result.headers['x-ms-request-charge'] ?? (typeof result.headers.get === 'function' ? result.headers.get('x-ms-request-charge') : undefined);
            if (hv !== undefined) {
                const parsed = parseFloat(hv as any);
                requestCharge = isNaN(parsed) ? 0 : parsed;
            }
        }

        // 5) Fallback: some SDKs expose RU on resourceOperation or nested fields
        if (!requestCharge) {
            // Try several nested locations where headers may be present
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

    // If we didn't find any RUs, print a small sample to help debugging
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

