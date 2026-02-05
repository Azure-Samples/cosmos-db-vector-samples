import { getClientsPasswordless, validateFieldName, diagnoseVectorData } from './utils.js';

const config = {
    dbName: "Hotels",
    containerName: "hotels_flat",
    embeddedField: process.env.EMBEDDED_FIELD!,
};

async function main() {
    const { dbClient } = getClientsPasswordless();

    try {
        if (!dbClient) {
            throw new Error('Database client is not configured. Please check your environment variables.');
        }

        const database = dbClient.database(config.dbName);
        console.log(`Connected to database: ${config.dbName}`);

        const container = database.container(config.containerName);
        console.log(`Connected to container: ${config.containerName}`);

        // Verify container exists
        await container.read();

        // Validate the embedded field name
        const safeEmbeddedField = validateFieldName(config.embeddedField);

        // Run diagnostics
        await diagnoseVectorData(container, safeEmbeddedField);

    } catch (error) {
        if ((error as any).code === 404) {
            console.error(`❌ Container or database not found. Ensure database '${config.dbName}' and container '${config.containerName}' exist.`);
        } else {
            console.error('❌ Diagnostic failed:', error);
        }
        process.exitCode = 1;
    }
}

main().catch(error => {
    console.error('Unhandled error:', error);
    process.exitCode = 1;
});
