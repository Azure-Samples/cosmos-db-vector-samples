import { MongoClient } from 'mongodb';

/**
 * Delete a Cosmos DB (Mongo API) database by name.
 *
 * Uses the `AZURE_DOCUMENTDB_CONNECTION_STRING` environment variable to connect.
 * Example env var: `mongodb://username:password@host:port/?ssl=true&replicaSet=globaldb`
 *
 * @param databaseName - The name of the database to drop. If not provided, uses MONGO_DB_NAME env var.
 */
export async function deleteCosmosMongoDatabase(databaseName?: string): Promise<void> {
  console.log(`\n\nCLEAN UP\n\n`);

  const dbName = databaseName || process.env.MONGO_DB_NAME;
  const connectionString = process.env.AZURE_DOCUMENTDB_CONNECTION_STRING;
  
  if (!connectionString) {
    throw new Error('Environment variable AZURE_DOCUMENTDB_CONNECTION_STRING is not set.');
  }

  if (!dbName) {
    throw new Error('Database name not provided and MONGO_DB_NAME environment variable is not set.');
  }

  const client = new MongoClient(connectionString);
  try {
    await client.connect();
    const db = client.db(dbName);
    await db.dropDatabase();
    console.log(`✓ Database "${dbName}" deleted successfully`);
  } finally {
    await client.close(true);
  }
}
