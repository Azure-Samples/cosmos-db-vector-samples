import { CosmosClient } from '@azure/cosmos';
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
export async function insertData(config, container, data) {
    // Cosmos DB uses containers instead of collections
    // Insert documents in batches
    console.log(`Processing in batches of ${config.batchSize}...`);
    const totalBatches = Math.ceil(data.length / config.batchSize);

    let inserted = 0;
    let failed = 0;
    // Cosmos DB does not support bulk insert natively in SDK, but you can use stored procedures or loop
    // Here we use a simple loop for demonstration
    for (let i = 0; i < totalBatches; i++) {
        const start = i * config.batchSize;
        const end = Math.min(start + config.batchSize, data.length);
        const batch = data.slice(start, end);
        for (const doc of batch) {
            try {
                await container.items.create(doc);
                inserted++;
            } catch (error) {
                console.error(`Error inserting document:`, error);
                failed++;
            }
        }
        // Small pause between batches to reduce resource contention
        if (i < totalBatches - 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    // Index creation is handled by indexing policy in Cosmos DB, not programmatically per field
    //TBD: If custom indexing policy is needed, update container indexing policy via SDK or portal
    return { total: data.length, inserted, failed };
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
    console.log('\n--- Insert Summary ---');
    console.log(`Total: ${insertSummary.total}, Inserted: ${insertSummary.inserted}, Failed: ${insertSummary.failed}`);
    
    console.log('\n--- Search Results ---');
    if (!searchResults || searchResults.length === 0) {
        console.log('No results found.');
        return;
    }

    searchResults.forEach((result, index) => {
        console.log(`${index + 1}. ${result.HotelName}, Score: ${result.SimilarityScore.toFixed(4)}`);
    });

    if (requestCharge !== undefined) {
        console.log(`\nRequest Charge: ${requestCharge} RUs`);
    }
    console.log('');
}
