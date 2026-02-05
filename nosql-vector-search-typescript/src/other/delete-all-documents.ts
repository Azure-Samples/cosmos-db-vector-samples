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

async function deleteAllDocumentsInContainer(container: any, containerName: string) {
    console.log(`\nProcessing container: ${containerName}`);
    
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

        // Use batching to avoid rate limiting (429 errors)
        const batchSize = 50;
        const totalBatches = Math.ceil(resources.length / batchSize);
        let totalDeleted = 0;
        let totalFailed = 0;
        let totalRequestCharge = 0;

        for (let i = 0; i < totalBatches; i++) {
            const start = i * batchSize;
            const end = Math.min(start + batchSize, resources.length);
            const batchDocs = resources.slice(start, end);

            // Prepare bulk delete operations for this batch
            const operations = batchDocs.map((doc: any) => ({
                operationType: BulkOperationType.Delete,
                id: doc.id,
                partitionKey: [doc.HotelId]  // Partition key as array
            }));

            const startTime = Date.now();
            console.log(`  Batch ${i + 1}/${totalBatches}: Deleting ${batchDocs.length} documents...`);
            
            const response = await container.items.executeBulkOperations(operations);
            
            const endTime = Date.now();
            const duration = ((endTime - startTime) / 1000).toFixed(2);
            console.log(`  Batch ${i + 1}/${totalBatches}: Completed in ${duration}s`);

            // Count successful and failed operations
            let batchDeleted = 0;
            let batchFailed = 0;
            
            totalRequestCharge += getBulkOperationRUs(response);

            totalDeleted += batchDeleted;
            totalFailed += batchFailed;

            // Pause between batches to allow RU recovery
            if (i < totalBatches - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        console.log(`  ✓ Deleted: ${totalDeleted}, Failed: ${totalFailed}`);
        console.log(`  Delete Request Charge: ${totalRequestCharge.toFixed(2)} RUs`);
        return { total: resources.length, deleted: totalDeleted, failed: totalFailed };
        
    } catch (error) {
        console.error(`  ✗ Error processing container ${containerName}:`, error);
        return { total: 0, deleted: 0, failed: 0 };
    }
}

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
                
                // Verify container exists
                await container.read();
                
                const result = await deleteAllDocumentsInContainer(container, containerName);
                totalDeleted += result.deleted;
                totalFailed += result.failed;
                
            } catch (error) {
                if ((error as any).code === 404) {
                    console.log(`\n⚠ Container '${containerName}' not found - skipping`);
                } else {
                    console.error(`\n✗ Error accessing container '${containerName}':`, error);
                }
            }
        }

        console.log(`\n=== Summary ===`);
        console.log(`Total deleted: ${totalDeleted}`);
        console.log(`Total failed: ${totalFailed}`);
        console.log(`Containers processed: ${config.containers.length}`);

    } catch (error) {
        console.error('Script failed:', error);
        process.exitCode = 1;
    }
}

// Execute the main function
main().catch(error => {
    console.error('Unhandled error:', error);
    process.exitCode = 1;
});
