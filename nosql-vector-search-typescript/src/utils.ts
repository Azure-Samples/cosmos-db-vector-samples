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
    // Use SDK bulk operations with intelligent batching to avoid rate limiting
    console.log(`Inserting ${data.length} items in batches of ${config.batchSize}...`);

    const totalBatches = Math.ceil(data.length / config.batchSize);
    let inserted = 0;
    let failed = 0;
    let totalRequestCharge = 0;

    for (let i = 0; i < totalBatches; i++) {
        const start = i * config.batchSize;
        const end = Math.min(start + config.batchSize, data.length);
        const batchData = data.slice(start, end);

        // Prepare bulk operations for this batch
        // The executeBulkOperations API requires partition key in the operation
        const operations = batchData.map((item: any) => ({
            operationType: BulkOperationType.Create,
            resourceBody: {
                id: item.HotelId,  // Map HotelId to id (required by Cosmos DB)
                ...item,
            },
            // Partition key must be passed as array: [value] for /HotelId partition
            partitionKey: [item.HotelId],
        }));

        try {
            const startTime = Date.now();
            console.log(`Batch ${i + 1}/${totalBatches}: Starting bulk insert (${batchData.length} items)...`);

            const response = await container.items.executeBulkOperations(operations);

            const endTime = Date.now();
            const duration = ((endTime - startTime) / 1000).toFixed(2);
            console.log(`Batch ${i + 1}/${totalBatches}: Completed in ${duration}s`);

            totalRequestCharge += getBulkOperationRUs(response);
        } catch (error) {
            console.error(`Batch ${i + 1}/${totalBatches} failed:`, error);
            failed += batchData.length;
        }

        // Pause between batches to allow RU recovery
        if (i < totalBatches - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
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

/**
 * Diagnostic function to verify vector data is properly stored and queryable
 * 
 * @param container - Cosmos DB container reference
 * @param embeddedField - The name of the vector field to check
 * @param limit - Number of documents to inspect (default 5)
 */
export async function diagnoseVectorData(container: any, embeddedField: string, limit: number = 5): Promise<void> {
    console.log('\n=== Vector Data Diagnostics ===\n');

    try {
        // 1. Check if documents exist
        console.log('1. Checking document count...');
        const countResult = await container.items
            .query('SELECT VALUE COUNT(1) FROM c')
            .fetchAll();

        const docCount = countResult.resources[0];
        console.log(`   ✓ Total documents: ${docCount}`);

        if (docCount === 0) {
            console.log('   ⚠️  No documents found! Insert data first.\n');
            return;
        }

        // 2. Check if the vector field exists and contains data
        console.log(`\n2. Checking if "${embeddedField}" field exists and contains vectors...`);

        // Check docs with the field defined
        const fieldCheckQuery = `
            SELECT VALUE COUNT(1)
            FROM c
            WHERE IS_DEFINED(c.${embeddedField})
        `;

        const fieldCheckResult = await container.items.query(fieldCheckQuery).fetchAll();
        const docsWithField = fieldCheckResult.resources[0];

        // Check docs with array (vector)
        const arrayCheckQuery = `
            SELECT VALUE COUNT(1)
            FROM c
            WHERE IS_ARRAY(c.${embeddedField})
        `;

        const arrayCheckResult = await container.items.query(arrayCheckQuery).fetchAll();
        const docsWithArray = arrayCheckResult.resources[0];

        console.log(`   Total docs: ${docCount}`);
        console.log(`   Docs with "${embeddedField}" field: ${docsWithField}`);
        console.log(`   Docs with array (vector): ${docsWithArray}`);

        if (docsWithArray === 0) {
            console.log(`   ❌ No vectors found in "${embeddedField}" field!\n`);
            return;
        }

        // 3. Sample vector dimensions
        console.log(`\n3. Sampling vector dimensions...`);
        const sampleQuery = `SELECT TOP 1 ARRAY_LENGTH(c.${embeddedField}) as vector_dimension, c.HotelName FROM c WHERE IS_DEFINED(c.${embeddedField})`;
        const sampleResult = await container.items.query(sampleQuery).fetchAll();

        if (sampleResult.resources.length > 0) {
            const sample = sampleResult.resources[0];
            console.log(`   ✓ Vector dimension: ${sample.vector_dimension}`);
            console.log(`   Sample doc: ${sample.HotelName}`);
        }

        // 4. Test VectorDistance function
        console.log(`\n4. Testing VectorDistance function...`);
        const testVector = Array.from({ length: 1536 }, () => Math.random());

        try {
            const distanceTestQuery = `
                SELECT TOP 3 
                    c.HotelName, 
                    c.id,
                    VectorDistance(c.${embeddedField}, @testVector) AS distance
                FROM c 
                WHERE IS_DEFINED(c.${embeddedField})
                ORDER BY VectorDistance(c.${embeddedField}, @testVector)
            `;

            const distanceResult = await container.items
                .query({
                    query: distanceTestQuery,
                    parameters: [{ name: '@testVector', value: testVector }]
                })
                .fetchAll();

            if (distanceResult.resources.length > 0) {
                console.log('   ✓ VectorDistance function works!');
                console.log('   Top 3 results by distance:');
                distanceResult.resources.forEach((doc: any, idx: number) => {
                    console.log(`     ${idx + 1}. ${doc.HotelName}: distance = ${doc.distance.toFixed(4)}`);
                });
            } else {
                console.log('   ⚠️  VectorDistance executed but returned no results');
            }
        } catch (err) {
            console.log(`   ❌ VectorDistance function failed: ${(err as any).message}`);
        }

        // 5. Show sample document structure
        console.log(`\n5. Sample document structure...`);
        const sampleDocQuery = `SELECT TOP 1 * FROM c`;
        const sampleDocResult = await container.items.query(sampleDocQuery).fetchAll();

        if (sampleDocResult.resources.length > 0) {
            const doc = sampleDocResult.resources[0];
            console.log(`   Document keys: ${Object.keys(doc).join(', ')}`);
            console.log(`   "${embeddedField}" is present: ${embeddedField in doc}`);
            if (embeddedField in doc) {
                const vectorField = (doc as any)[embeddedField];
                console.log(`   "${embeddedField}" type: ${Array.isArray(vectorField) ? 'array' : typeof vectorField}`);
                console.log(`   "${embeddedField}" length: ${Array.isArray(vectorField) ? vectorField.length : 'N/A'}`);
                console.log(`   First 3 vector values: [${Array.isArray(vectorField) ? vectorField.slice(0, 3).map((v: number) => v.toFixed(4)).join(', ') : 'N/A'}]`);
            }
        }

        console.log('\n✓ Diagnostics complete\n');

    } catch (error) {
        console.error('\n❌ Diagnostic failed:', error);
    }
}
export function getBulkOperationRUs(response: any): number {

    if (!response || !Array.isArray(response)) {
        console.warn('Response is not an array. Cannot calculate RUs from bulk operation.');
        return 0;
    }

    let totalRequestCharge = 0;

    response.forEach((result: any) => {

        // Track RU consumption from individual operation response
        const requestCharge = result.requestCharge || result.operationResponse?.headers?.['x-ms-request-charge'] || 0;
        console.log(`   Operation ${result.operationType} on item with id ${result.resourceBody?.id || 'N/A'}: Request Charge = ${requestCharge} RUs`);
        if (requestCharge) {
            totalRequestCharge += requestCharge;
        }
    });
    return totalRequestCharge;
}

