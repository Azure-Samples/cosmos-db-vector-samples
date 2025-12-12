import { MongoClient, OIDCCallbackParams } from 'mongodb';
import { AccessToken, DefaultAzureCredential, TokenCredential } from '@azure/identity';

const DOCUMENT_DB_SCOPE = 'https://ossrdbms-aad.database.windows.net/.default';
const credential = new DefaultAzureCredential();

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

async function testMongoConnection() {
  const clusterName = process.env.MONGO_CLUSTER_NAME;
  
  if (!clusterName) {
    throw new Error('MONGO_CLUSTER_NAME is not set in environment');
  }

  console.log('Connecting to MongoDB cluster:', clusterName);
  console.log('Using DefaultAzureCredential for authentication...\n');

  const connectionString = `mongodb+srv://${clusterName}.global.mongocluster.cosmos.azure.com/`;
  
  const client = new MongoClient(connectionString, {
    connectTimeoutMS: 30000,
    tls: true,
    retryWrites: true,
    authMechanism: 'MONGODB-OIDC',
    authMechanismProperties: {
      OIDC_CALLBACK: (params: OIDCCallbackParams) => azureIdentityTokenCallback(params, credential),
      ALLOWED_HOSTS: ['*.azure.com']
    }
  });

  try {
    // Connect to the cluster
    await client.connect();
    console.log('✅ Successfully connected to MongoDB!\n');

    // List all databases
    const adminDb = client.db().admin();
    const databasesList = await adminDb.listDatabases();
    
    console.log('📚 Databases:');
    for (const db of databasesList.databases) {
      console.log(`  - ${db.name} `);
    }
    console.log();

  } catch (error) {
    console.error('❌ Connection failed:', error);
    throw error;
  } finally {
    await client.close();
    console.log('\n✅ Connection closed');
  }
}

// Run the test
testMongoConnection().catch(console.error);
