import { getClientsPasswordless, getBulkOperationRUs } from '../utils.js';
import { BulkOperationType } from '@azure/cosmos';

type VectorAlgorithm = 'quantizedflat' | 'diskann';
type DistanceFunction = 'cosine' | 'dotproduct' | 'euclidean';

const ALGORITHMS: VectorAlgorithm[] = ['quantizedflat', 'diskann'];
const DISTANCE_FUNCTIONS: DistanceFunction[] = ['cosine', 'dotproduct', 'euclidean'];

function getTargetContainers(
    algorithmEnv: string,
    distanceEnv: string
): string[] {
    const algorithms: VectorAlgorithm[] =
        algorithmEnv === 'all' ? ALGORITHMS : [algorithmEnv as VectorAlgorithm];
    const distances: DistanceFunction[] =
        distanceEnv === 'all' ? DISTANCE_FUNCTIONS : [distanceEnv as DistanceFunction];

    const containers: string[] = [];
    for (const alg of algorithms) {
        for (const dist of distances) {
            containers.push(`hotels_${alg}_${dist}`);
        }
    }
    return containers;
}

async function main() {
    const { dbClient } = getClientsPasswordless();

    if (!dbClient) {
        throw new Error('Database client is not configured. Please check your environment variables.');
    }

    const dbName = process.env.AZURE_COSMOSDB_DATABASENAME || 'Hotels';
    const algorithmEnv = (process.env.VECTOR_ALGORITHM || 'all').trim().toLowerCase();
    const distanceEnv = (process.env.VECTOR_DISTANCE_FUNCTION || 'all').trim().toLowerCase();

    const containers = getTargetContainers(algorithmEnv, distanceEnv);

    const database = dbClient.database(dbName);
    console.log(`Connected to database: ${dbName}`);
    console.log(`Containers to clean: ${containers.join(', ')}\n`);

    let totalDeleted = 0;
    let totalFailed = 0;

    for (const containerName of containers) {
        try {
            const container = database.container(containerName);
            console.log(`Deleting documents from container: ${containerName}`);

            const { resources } = await container.items
                .query('SELECT c.id, c.HotelId FROM c')
                .fetchAll();

            if (resources.length === 0) {
                console.log(`  No documents found in ${containerName}`);
                continue;
            }

            console.log(`  Found ${resources.length} documents to delete`);

            const operations = resources.map((doc: any) => ({
                operationType: BulkOperationType.Delete,
                id: doc.id,
                partitionKey: [doc.HotelId],
            }));

            const response = await container.items.executeBulkOperations(operations);

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
        } catch (error) {
            if ((error as any).code === 404) {
                console.log(`  Container '${containerName}' not found — skipping.`);
            } else {
                console.error(`  Error deleting from ${containerName}:`, (error as Error).message);
            }
        }
    }

    console.log(`\nSummary: Total Deleted: ${totalDeleted}, Total Failed: ${totalFailed}`);
}

main().catch((error) => {
    console.error('Unexpected error:', error);
    process.exitCode = 1;
});
