import path from 'path';
import { readFileReturnJson, getClientsPasswordless, insertData } from './utils.js';
// ESM specific features - create __dirname equivalent
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const config = {
    query: "find a hotel by a lake with a mountain view",
    dbName: "Hotels",
    collectionName: "hotels",
    indexName: "vectorIndex",
    dataFile: process.env.DATA_FILE_WITH_VECTORS!,
    batchSize: parseInt(process.env.LOAD_SIZE_BATCH! || '100', 10),
    embeddingField: process.env.EMBEDDED_FIELD!,
    embeddedField: process.env.EMBEDDED_FIELD!,
    embeddingDimensions: parseInt(process.env.EMBEDDING_DIMENSIONS!, 10),
    deployment: process.env.AZURE_OPENAI_EMBEDDING_MODEL!,
};

async function main() {

    const { aiClient, dbClient } = getClientsPasswordless();

    try {
        
    if (!aiClient) {
        throw new Error('OpenAI client is not configured properly. Please check your environment variables.');
    }

    if (!dbClient) {
        throw new Error('Cosmos DB client is not configured properly. Please check your environment variables.');
    }

        // Get database and container references (assumes they already exist)
        const database = dbClient.database(config.dbName);
        const container = database.container(config.collectionName);

        console.log(`Using database '${config.dbName}' and container '${config.collectionName}'`);
        console.log('Note: Database and container must exist before running this sample.');
        console.log('Create them via Azure Portal, Azure CLI, or Azure Developer CLI (azd).\n');

        const data = await readFileReturnJson(path.join(__dirname, "..", config.dataFile));
        const insertSummary = await insertData(config, container, data);

        console.log('Insert summary:', insertSummary);

        // Create embedding for the query
        const createEmbeddedForQueryResponse = await aiClient.embeddings.create({
            model: config.deployment,
            input: [config.query]
        });

        // Perform the vector similarity search
        const { resources } = await container.items
            .query({
                query: "SELECT TOP 5 c.HotelName, VectorDistance(c.contentVector, @embedding) AS SimilarityScore FROM c ORDER BY VectorDistance(c.contentVector, @embedding)",
                parameters: [{ name: "@embedding", value: createEmbeddedForQueryResponse.data[0].embedding }]
            })
            .fetchAll();

        for (const item of resources) {
            console.log(`${item.HotelName} with score ${item.SimilarityScore} `);
        }

    } catch (error) {
        console.error('App failed:', error);
        
        // Provide helpful error message if resources don't exist
        if (error instanceof Error || (typeof error === 'object' && error !== null)) {
            const err = error as any;
            if (err?.message?.includes('NotFound') || err?.message?.includes('does not exist') || 
                err?.message?.includes('ResourceNotFound') || err?.code === 404 || err?.statusCode === 404) {
                console.error('\n=== RESOURCE NOT FOUND ===');
                console.error(`The database '${config.dbName}' or container '${config.collectionName}' does not exist.`);
                console.error('\nPlease create these resources before running this sample:');
                console.error('1. Via Azure Portal: https://portal.azure.com');
                console.error('2. Via Azure CLI:');
                console.error(`   az cosmosdb sql database create --account-name <account> --name ${config.dbName} --resource-group <rg>`);
                console.error(`   az cosmosdb sql container create --account-name <account> --database-name ${config.dbName} --name ${config.collectionName} --partition-key-path /id --resource-group <rg>`);
                console.error('3. Via Azure Developer CLI: azd up');
                console.error('\nNote: This sample uses data plane RBAC which does not support creating resources programmatically.');
            }
        }
        
        process.exitCode = 1;
    }
}

// Execute the main function
main().catch(error => {
    console.error('Unhandled error:', error);
    process.exitCode = 1;
});