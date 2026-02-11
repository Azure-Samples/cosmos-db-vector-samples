import { getClientsPasswordless, validateFieldName } from '../utils.js';

const config = {
    query: 'quintessential lodging near running trails, eateries, retail',
    dbName: 'Hotels',
    collectionNames: ['hotels_diskann', 'hotels_quantizedflat'],
    embeddedField: process.env.EMBEDDED_FIELD!,
    deployment: process.env.AZURE_OPENAI_EMBEDDING_MODEL!,
};

async function main() {
    const { aiClient, dbClient } = getClientsPasswordless();

    if (!aiClient) {
        throw new Error('Azure OpenAI client is not configured. Please check your environment variables.');
    }
    if (!dbClient) {
        throw new Error('Cosmos DB client is not configured. Please check your environment variables.');
    }

    const database = dbClient.database(config.dbName);
    const createEmbeddedForQueryResponse = await aiClient.embeddings.create({
        model: config.deployment,
        input: [config.query],
    });

    const safeEmbeddedField = validateFieldName(config.embeddedField);
    const queryText = `SELECT TOP 5 c.HotelName, c.Description, c.Rating, VectorDistance(c.${safeEmbeddedField}, @embedding) AS SimilarityScore FROM c ORDER BY VectorDistance(c.${safeEmbeddedField}, @embedding)`;

    for (const containerName of config.collectionNames) {
        const container = database.container(containerName);
        const response = await container.items
            .query({
                query: queryText,
                parameters: [
                    { name: '@embedding', value: createEmbeddedForQueryResponse.data[0].embedding },
                ],
            })
            .fetchAll();

        console.log(`\nContainer: ${containerName}`);
        console.log('Request charge:', response.requestCharge);

        const queryMetrics = response.queryMetrics;
        if (queryMetrics && typeof queryMetrics === 'object') {
            console.log('Query metrics:', JSON.stringify(queryMetrics, null, 2));
        } else {
            console.log('Query metrics:', queryMetrics ?? 'n/a');
        }

        if (response.diagnostics && typeof response.diagnostics === 'object') {
            const clientStats = (response.diagnostics as any).clientSideRequestStatistics;
            const gatewayStats = Array.isArray(clientStats?.gatewayStatistics)
                ? clientStats.gatewayStatistics.filter((entry: any) => entry.statusCode === 200)
                : [];

            if (gatewayStats.length > 0) {
                console.log('Gateway statistics (success only):', JSON.stringify(gatewayStats, null, 2));
            } else {
                const diagnosticsText = JSON.stringify(response.diagnostics, null, 2);
                const truncatedDiagnostics = diagnosticsText.length > 4000
                    ? `${diagnosticsText.slice(0, 4000)}\n... (truncated)`
                    : diagnosticsText;
                console.log('Diagnostics:', truncatedDiagnostics);
            }
        }

        console.log('Results:', response.resources?.length ?? 0);
    }
}

main().catch((error) => {
    console.error('Query metrics script failed:', error);
    process.exitCode = 1;
});
