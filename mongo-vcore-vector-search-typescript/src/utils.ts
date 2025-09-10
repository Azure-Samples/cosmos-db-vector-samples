import { MongoClient, OIDCResponse, OIDCCallbackParams } from 'mongodb';
import { AzureOpenAI } from 'openai/index.js';
import { promises as fs } from "fs";
import { AccessToken, DefaultAzureCredential, TokenCredential, getBearerTokenProvider } from '@azure/identity';

// Define a type for JSON data
export type JsonData = Record<string, any>;

export const AzureIdentityTokenCallback = async (params: OIDCCallbackParams, credential: TokenCredential): Promise<OIDCResponse> => {
    const tokenResponse: AccessToken | null = await credential.getToken(['https://ossrdbms-aad.database.windows.net/.default']);
    return {
        accessToken: tokenResponse?.token || '',
        expiresInSeconds: (tokenResponse?.expiresOnTimestamp || 0) - Math.floor(Date.now() / 1000)
    };
};
export function getClients(): { aiClient: AzureOpenAI; dbClient: MongoClient } {
    const apiKey = process.env.AZURE_OPENAI_EMBEDDING_KEY!;
    const apiVersion = process.env.AZURE_OPENAI_EMBEDDING_API_VERSION!;
    const endpoint = process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT!;
    const deployment = process.env.AZURE_OPENAI_EMBEDDING_MODEL!;
    const aiClient = new AzureOpenAI({
        apiKey,
        apiVersion,
        endpoint,
        deployment
    });
    const dbClient = new MongoClient(process.env.MONGO_CONNECTION_STRING!, {
        // Performance optimizations
        maxPoolSize: 10,         // Limit concurrent connections
        minPoolSize: 1,          // Maintain at least one connection
        maxIdleTimeMS: 30000,    // Close idle connections after 30 seconds
        connectTimeoutMS: 30000, // Connection timeout
        socketTimeoutMS: 360000, // Socket timeout (for long-running operations)
        writeConcern: {          // Optimize write concern for bulk operations
            w: 1,                // Acknowledge writes after primary has written
            j: false             // Don't wait for journal commit
        }
    });

    return { aiClient, dbClient };
}

export function getClientsPasswordless(): { aiClient: AzureOpenAI | null; dbClient: MongoClient | null } {
    let aiClient: AzureOpenAI | null = null;
    let dbClient: MongoClient | null = null;

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
    const clusterName = process.env.MONGO_CLUSTER_NAME!;

    if (clusterName) {
        const credential = new DefaultAzureCredential();

        dbClient = new MongoClient(
            `mongodb+srv://${clusterName}.global.mongocluster.cosmos.azure.com/`, {
            connectTimeoutMS: 30000,
            tls: true,
            retryWrites: true,
            authMechanism: 'MONGODB-OIDC',
            authMechanismProperties: {
                OIDC_CALLBACK: (params: OIDCCallbackParams) => AzureIdentityTokenCallback(params, credential),
                ALLOWED_HOSTS: ['*.azure.com']
            }
        }
        );
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
export async function insertData(config, collection, data) {
    console.log(`Processing in batches of ${config.batchSize}...`);
    const totalBatches = Math.ceil(data.length / config.batchSize);

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < totalBatches; i++) {
        const start = i * config.batchSize;
        const end = Math.min(start + config.batchSize, data.length);
        const batch = data.slice(start, end);

        try {
            const result = await collection.insertMany(batch, { ordered: false });
            inserted += result.insertedCount || 0;
            console.log(`Batch ${i + 1} complete: ${result.insertedCount} inserted`);
        } catch (error: any) {
            if (error?.writeErrors) {
                // Some documents may have been inserted despite errors
                console.error(`Error in batch ${i + 1}: ${error?.writeErrors.length} failures`);
                failed += error?.writeErrors.length;
                inserted += batch.length - error?.writeErrors.length;
            } else {
                console.error(`Error in batch ${i + 1}:`, error);
                failed += batch.length;
            }
        }

        // Small pause between batches to reduce resource contention
        if (i < totalBatches - 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    const indexColumns = [
        "HotelId",
        "Category",
        "Description",
        "Description_fr"
    ];
    for (const col of indexColumns) {
        const indexSpec = {};
        indexSpec[col] = 1; // Ascending index
        await collection.createIndex(indexSpec);
    }

    return { total: data.length, inserted, updated, skipped, failed };
}

export function printSearchResults(insertSummary, indexSummary, searchResults) {


    if (!searchResults || searchResults.length === 0) {
        console.log('No search results found.');
        return;
    }

    searchResults.map((result, index) => {

        const { document, score } = result as any;

        console.log(`${index + 1}. HotelName: ${document.HotelName}, Score: ${score.toFixed(4)}`);
        //console.log(`   Description: ${document.Description}`);
    });

}
