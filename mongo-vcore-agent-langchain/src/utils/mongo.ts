import { MongoClient, OIDCCallbackParams } from 'mongodb';
import { AccessToken, DefaultAzureCredential, TokenCredential } from '@azure/identity';

const DOCUMENT_DB_SCOPE = 'https://ossrdbms-aad.database.windows.net/.default';
const CREDENTIAL = new DefaultAzureCredential();

// OIDC token callback for MongoDB authentication
async function azureIdentityTokenCallback(
  params: OIDCCallbackParams,
  tokenCredential: TokenCredential
): Promise<{ accessToken: string; expiresInSeconds: number }> {
  const tokenResponse: AccessToken | null = await tokenCredential.getToken([DOCUMENT_DB_SCOPE]);
  return {
    accessToken: tokenResponse?.token || '',
    expiresInSeconds: (tokenResponse?.expiresOnTimestamp || 0) - Math.floor(Date.now() / 1000)
  };
}

/**
 * Delete a Cosmos DB (Mongo API) database by name using passwordless OIDC authentication.
 *
 * Uses DefaultAzureCredential for passwordless authentication with MONGODB-OIDC.
 * Requires MONGO_CLUSTER_NAME environment variable.
 *
 * @param databaseName - The name of the database to drop. If not provided, uses MONGO_DB_NAME env var.
 */
export async function deleteCosmosMongoDatabase(databaseName?: string): Promise<void> {
  console.log(`\n\nCLEAN UP\n\n`);

  const dbName = databaseName || process.env.MONGO_DB_NAME;
  const clusterName = process.env.MONGO_CLUSTER_NAME;
  
  if (!clusterName) {
    throw new Error('Environment variable MONGO_CLUSTER_NAME is not set.');
  }

  if (!dbName) {
    throw new Error('Database name not provided and MONGO_DB_NAME environment variable is not set.');
  }

  const connectionString = `mongodb+srv://${clusterName}.global.mongocluster.cosmos.azure.com/`;
  
  const client = new MongoClient(connectionString, {
    connectTimeoutMS: 30000,
    tls: true,
    retryWrites: true,
    authMechanism: 'MONGODB-OIDC',
    authMechanismProperties: {
      OIDC_CALLBACK: (params: OIDCCallbackParams) => azureIdentityTokenCallback(params, CREDENTIAL),
      ALLOWED_HOSTS: ['*.azure.com']
    }
  });

  try {
    console.log(`Connecting to cluster: ${clusterName}`);
    await client.connect();
    console.log(`Dropping database: ${dbName}`);
    const db = client.db(dbName);
    await db.dropDatabase();
    console.log(`✓ Database "${dbName}" deleted successfully`);
  } finally {
    await client.close(true);
  }
}
