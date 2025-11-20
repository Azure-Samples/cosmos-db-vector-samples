import { MongoClient } from 'mongodb';

/**
 * Delete a Cosmos DB (Mongo API) database by name.
 *
 * Uses the `MONGO_CONNECTION_STRING` environment variable to connect.
 * Example env var: `mongodb://username:password@host:port/?ssl=true&replicaSet=globaldb`
 *
 * @param databaseName - The name of the database to drop.
 */
export async function deleteCosmosMongoDatabase(
  databaseNameArg?: string,
  connectionStringArg?: string,
  options?: { forceExit?: boolean }
): Promise<void> {
  console.log('\n\nCLEAN UP\n\n');

  const databaseName = databaseNameArg || process.env.MONGO_DB_NAME;
  const connectionString = connectionStringArg || process.env.MONGO_CONNECTION_STRING;
  const forceExit = options?.forceExit ?? (process.env.FORCE_EXIT_AFTER_CLEANUP === 'true');

  if (!connectionString) {
    throw new Error('Environment variable MONGO_CONNECTION_STRING is not set.');
  }

  if (!databaseName) {
    throw new Error('Database name not provided and MONGO_DB_NAME is not set.');
  }

  // Use a small pool and short timeouts so the client shuts down quickly when closed.
  const client = new MongoClient(connectionString, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 30000,
    maxPoolSize: 1,
    minPoolSize: 0,
  });

  try {
    await client.connect();
    console.log(`Connected to Mongo endpoint. Dropping database: ${databaseName}`);
    const db = client.db(databaseName);
    const result = await db.dropDatabase();
    if (result) {
      console.log(`Successfully dropped database "${databaseName}".`);
    } else {
      console.warn(
        `dropDatabase returned falsy for "${databaseName}". It may not have existed or operation did not succeed.`
      );
    }
  } finally {
    try {
      // Force close to ensure background sockets/monitoring stop promptly.
      // The `force` parameter is supported by the MongoDB node driver and will
      // abort in-flight operations and close connections.
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      await client.close(true);
    } catch (err) {
      console.error('[cleanup] Error closing Mongo client:', err);
      try {
        await client.close();
      } catch (err2) {
        console.error('[cleanup] Second attempt to close Mongo client failed:', err2);
      }
    }

    if (forceExit) {
      // If the caller explicitly requests a hard process exit, do so after a
      // short nextTick to allow logs to flush.
      console.log('[cleanup] Exiting process as requested (forceExit=true)');
      process.nextTick(() => process.exit(0));
    }
  }
}
