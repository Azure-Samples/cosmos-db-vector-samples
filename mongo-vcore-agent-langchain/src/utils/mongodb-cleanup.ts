import { MongoClient } from 'mongodb';

/**
 * Delete a Cosmos DB (Mongo API) database by name.
 *
 * Uses the `AZURE_COSMOSDB_MONGODB_CONNECTION_STRING` environment variable to connect.
 * Example env var: `mongodb://username:password@host:port/?ssl=true&replicaSet=globaldb`
 *
 * @param databaseName - The name of the database to drop.
 */
export async function deleteCosmosMongoDatabase(): Promise<void> {

    console.log(`\n\nCLEAN UP\n\n`);

    const databaseName = process.env.MONGO_DB_NAME;
    const connectionString = process.env.AZURE_COSMOSDB_MONGODB_CONNECTION_STRING;
    if (!connectionString) {
        throw new Error('Environment variable AZURE_COSMOSDB_MONGODB_CONNECTION_STRING is not set.');
    }

    const client = new MongoClient(connectionString);
    try {
        await client.connect();
        const db = client.db(databaseName);
        await db.dropDatabase();
    } finally {
        await client.close(true);
    }
}