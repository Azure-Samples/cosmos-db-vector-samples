import { getClientsPasswordless, getBulkOperationRUs } from '../utils.js';
import { BulkOperationType } from '@azure/cosmos';

const config = {
    dbName: "Hotels",
    containers: [
        "hotels_flat",
        "hotels_diskann",
        "hotels_quantizedflat"
    ]
};

async function main() {
    const { dbClient } = getClientsPasswordless();

    try {
        if (!dbClient) {
            throw new Error('Database client is not configured. Please check your environment variables.');
        }

        const database = dbClient.database(config.dbName);
        console.log(`Connected to database: ${config.dbName}`);

        let totalDeleted = 0;
        let totalFailed = 0;

        // Process each container
        for (const containerName of config.containers) {
            try {
                const container = database.container(containerName);
                console.log(`\nDeleting documents from container: ${containerName}`);
                
                // Verify container exists
                try {
                    // Query all documents to get their IDs and partition keys
                    const { resources } = await container.items
                        .query('SELECT c.id, c.HotelId FROM c')
                        .fetchAll();

                    if (resources.length === 0) {
                        console.log(`  No documents found in ${containerName}`);
                        return { total: 0, deleted: 0, failed: 0 };
                    }

                    console.log(`  Found ${resources.length} documents to delete`);

                    // Prepare bulk delete operations for all documents
                    const operations = resources.map((doc: any) => ({
                        operationType: BulkOperationType.Delete,
                        id: doc.id,
                        partitionKey: [doc.HotelId]  // Partition key as array
                    }));

                    const startTime = Date.now();
                    console.log(`  Deleting ${operations.length} documents in bulk...`);

                    const response = await container.items.executeBulkOperations(operations);

                    const endTime = Date.now();
                    const duration = ((endTime - startTime) / 1000).toFixed(2);
                    console.log(`  Bulk delete completed in ${duration}s`);

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
                    return { total: resources.length, deleted, failed };
                } catch (error) {
                    console.error(`  ✗ Error processing container ${containerName}:`, error);
                    return { total: 0, deleted: 0, failed: 0 };
                }
            } catch (error) {
                console.error(`  ✗ Error connecting to container ${containerName}:`, error);
                return { total: 0, deleted: 0, failed: 0 };
            }
        }

        console.log(`\nSummary: Total Deleted: ${totalDeleted}, Total Failed: ${totalFailed}`);
    } catch (error) {
        console.error('App failed:', error);
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error('Unexpected error:', error);
    process.exitCode = 1;
});
