import { getClientsPasswordless, getBulkOperationRUs } from '../utils.js';
import { BulkOperationType } from '@azure/cosmos';

const config = {
    dbName: "Hotels",
    containers: [
        "hotels_diskann",
        "hotels_quantizedflat"
    ]
};

async function main() {
    const { dbClient } = getClientsPasswordless();


    if (!dbClient) {
        throw new Error('Database client is not configured. Please check your environment variables.');
    }

    const database = dbClient.database(config.dbName);
    console.log(`Connected to database: ${config.dbName}`);

    let totalDeleted = 0;
    let totalFailed = 0;

    // Process each container
    for (const containerName of config.containers) {

            const container = database.container(containerName);
            console.log(`\nDeleting documents from container: ${containerName}`);
            
            // Query all documents to get their IDs and partition keys
            const { resources } = await container.items
                .query('SELECT c.id, c.HotelId FROM c')
                .fetchAll();

            if (resources.length === 0) {
                console.log(`  No documents found in ${containerName}`);
                continue;
            }

            console.log(`  Found ${resources.length} documents to delete`);

            // Prepare bulk delete operations for all documents
            const operations = resources.map((doc: any) => ({
                operationType: BulkOperationType.Delete,
                id: doc.id,
                partitionKey: [doc.HotelId]  // Partition key as array
            }));
            const response = await container.items.executeBulkOperations(operations);

            // Count successful and failed operations
            let deleted = 0;
            let failed = 0;
            if (response) {
                response.forEach((result: any) => {
                    if (result.statusCode >= 200 && result.statusCode < 300) {
                        deleted++;
                    } else {
                        failed++;
                    }
                });
            }

            const totalRequestCharge = getBulkOperationRUs(response);

            console.log(`  ✓ Deleted: ${deleted}, Failed: ${failed}`);
            console.log(`  Delete Request Charge: ${totalRequestCharge.toFixed(2)} RUs`);
            totalDeleted += deleted;
            totalFailed += failed;
    }

    console.log(`\nSummary: Total Deleted: ${totalDeleted}, Total Failed: ${totalFailed}`);
}

main().catch((error) => {
    console.error('Unexpected error:', error);
    process.exitCode = 1;
});
