import { AzureOpenAIEmbeddings, AzureChatOpenAI } from "@langchain/openai";
import { MongoClient, OIDCCallbackParams } from 'mongodb';
import { AccessToken, DefaultAzureCredential, TokenCredential, getBearerTokenProvider } from '@azure/identity';

/*
This file contains utility functions to create Azure OpenAI clients for embeddings, planning, and synthesis.

It supports two modes of authentication:
1. API Key based authentication using AZURE_OPENAI_API_KEY and AZURE_OPENAI_API_INSTANCE_NAME environment variables.
2. Passwordless authentication using DefaultAzureCredential from Azure Identity library.
*/

// Azure Identity configuration
const OPENAI_SCOPE = 'https://cognitiveservices.azure.com/.default';
const DOCUMENT_DB_SCOPE = 'https://ossrdbms-aad.database.windows.net/.default';

// Azure identity credential (used for passwordless auth)
const CREDENTIAL = new DefaultAzureCredential();

// Token callback for MongoDB OIDC authentication
async function azureIdentityTokenCallback(
  params: OIDCCallbackParams,
  credential: TokenCredential
): Promise<{ accessToken: string; expiresInSeconds: number }> {
  const tokenResponse: AccessToken | null = await credential.getToken([DOCUMENT_DB_SCOPE]);
  return {
    accessToken: tokenResponse?.token || '',
    expiresInSeconds: (tokenResponse?.expiresOnTimestamp || 0) - Math.floor(Date.now() / 1000)
  };
}


// Debug logging
const DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1';
if (DEBUG) {
  const usePasswordless = process.env.USE_PASSWORDLESS === 'true' || process.env.USE_PASSWORDLESS === '1';
  if (usePasswordless) {
    console.log('[clients] Passwordless mode enabled. Passwordless env presence:', {
      HAS_AZURE_CLIENT_ID: !!process.env.AZURE_CLIENT_ID,
      HAS_AZURE_TENANT_ID: !!process.env.AZURE_TENANT_ID,
      HAS_AZURE_CLIENT_SECRET: !!process.env.AZURE_CLIENT_SECRET,
      HAS_AZURE_OPENAI_INSTANCE: !!process.env.AZURE_OPENAI_API_INSTANCE_NAME,
      HAS_EMBEDDING_DEPLOYMENT: !!process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
      HAS_PLANNER_DEPLOYMENT: !!process.env.AZURE_OPENAI_PLANNER_DEPLOYMENT,
      HAS_SYNTH_DEPLOYMENT: !!process.env.AZURE_OPENAI_SYNTH_DEPLOYMENT
    });
  } else {
    console.log('[clients] Password Env present:', {
      HAS_AZURE_OPENAI_API_KEY: !!process.env.AZURE_OPENAI_API_KEY,
      HAS_AZURE_OPENAI_INSTANCE: !!process.env.AZURE_OPENAI_API_INSTANCE_NAME,
      HAS_EMBEDDING_DEPLOYMENT: !!process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
      HAS_PLANNER_DEPLOYMENT: !!process.env.AZURE_OPENAI_PLANNER_DEPLOYMENT,
      HAS_SYNTH_DEPLOYMENT: !!process.env.AZURE_OPENAI_SYNTH_DEPLOYMENT,
      HAS_CONNECTION_STRING: !!process.env.AZURE_DOCUMENTDB_CONNECTION_STRING,
    });
  }
}

// Create clients with API key authentication
export function createClients() {
  try {
    const key = process.env.AZURE_OPENAI_API_KEY;
    const instance = process.env.AZURE_OPENAI_API_INSTANCE_NAME;
    if (!key || !instance) {
      throw new Error('Missing keys: AZURE_OPENAI_API_KEY or AZURE_OPENAI_API_INSTANCE_NAME');
    }

    const auth = {
      azureOpenAIApiKey: key,
      azureOpenAIApiInstanceName: instance
    };

    const embeddingClient = new AzureOpenAIEmbeddings({
      ...auth,
      azureOpenAIApiEmbeddingsDeploymentName: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
      azureOpenAIApiVersion: process.env.AZURE_OPENAI_EMBEDDING_API_VERSION,
      maxRetries: 1,
    });

    const plannerClient = new AzureChatOpenAI({
      ...auth,
      model: process.env.AZURE_OPENAI_PLANNER_DEPLOYMENT!,
      temperature: 0, // Deterministic for consistent query refinement
      azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_PLANNER_DEPLOYMENT,
      azureOpenAIApiVersion: process.env.AZURE_OPENAI_PLANNER_API_VERSION,
    });

    const synthClient = new AzureChatOpenAI({
      ...auth,
      model: process.env.AZURE_OPENAI_SYNTH_DEPLOYMENT!,
      temperature: 0.3, // Slightly creative for natural responses
      azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_SYNTH_DEPLOYMENT,
      azureOpenAIApiVersion: process.env.AZURE_OPENAI_SYNTH_API_VERSION,
    });

    const dbConfig = {
      instance: process.env.AZURE_DOCUMENTDB_INSTANCE!,
      connectionString: process.env.AZURE_DOCUMENTDB_CONNECTION_STRING!,
      databaseName: process.env.MONGO_DB_NAME!,
      collectionName: process.env.MONGO_DB_COLLECTION!
    };

    return { embeddingClient, plannerClient, synthClient, dbConfig };
  } catch (err: any) {
    console.error('[clients] Failed to construct OpenAI clients:', err?.message ?? err);
    console.error('[clients] Confirm AZURE_OPENAI_* env vars are set correctly (or configure passwordless token provider).');
    throw err;
  }
}


// Create clients with passwordless authentication
export function createClientsPasswordless() {
  try {
    const instance = process.env.AZURE_OPENAI_API_INSTANCE_NAME;
    if (!instance) {
      throw new Error('Missing passwordless: AZURE_OPENAI_API_INSTANCE_NAME for passwordless client');
    }

    const embeddingClient = new AzureOpenAIEmbeddings({
      azureADTokenProvider: getBearerTokenProvider(
        CREDENTIAL,
        "https://cognitiveservices.azure.com/.default",
      ),
      azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME!,
      azureOpenAIApiEmbeddingsDeploymentName:
        process.env.AZURE_OPENAI_EMBEDDING_MODEL!,
      azureOpenAIApiVersion: process.env.AZURE_OPENAI_EMBEDDING_API_VERSION!,
      azureOpenAIBasePath: `https://${process.env.AZURE_OPENAI_API_INSTANCE_NAME}.openai.azure.com/openai/deployments`
    });

    const plannerClient = new AzureChatOpenAI({
      azureADTokenProvider: getBearerTokenProvider(
        CREDENTIAL,
        "https://cognitiveservices.azure.com/.default",
      ),
      azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME!,
      azureOpenAIApiDeploymentName:
        process.env.AZURE_OPENAI_PLANNER_DEPLOYMENT!,
      azureOpenAIApiVersion: process.env.AZURE_OPENAI_PLANNER_API_VERSION!,
      azureOpenAIBasePath: `https://${process.env.AZURE_OPENAI_API_INSTANCE_NAME}.openai.azure.com/openai/deployments`,
    });

    const synthClient = new AzureChatOpenAI({
      azureADTokenProvider: getBearerTokenProvider(
        CREDENTIAL,
        "https://cognitiveservices.azure.com/.default",
      ),
      azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME!,
      azureOpenAIApiDeploymentName:
        process.env.AZURE_OPENAI_SYNTH_DEPLOYMENT!,
      azureOpenAIApiVersion: process.env.AZURE_OPENAI_SYNTH_API_VERSION!,
      azureOpenAIBasePath: `https://${process.env.AZURE_OPENAI_API_INSTANCE_NAME}.openai.azure.com/openai/deployments`,
    });

    const mongoClient = new MongoClient(
      `mongodb+srv://${process.env.AZURE_DOCUMENTDB_INSTANCE!}.global.mongocluster.cosmos.azure.com/`,
      {
        connectTimeoutMS: 30000,
        tls: true,
        retryWrites: true,
        authMechanism: 'MONGODB-OIDC',
        authMechanismProperties: {
          OIDC_CALLBACK: (params: OIDCCallbackParams) => azureIdentityTokenCallback(params, CREDENTIAL),
          ALLOWED_HOSTS: ['*.azure.com']
        }
      }
    );

    const dbConfig = {
      instance: process.env.AZURE_DOCUMENTDB_INSTANCE!,
      client: mongoClient,
      databaseName: process.env.MONGO_DB_NAME!,
      collectionName: process.env.MONGO_DB_COLLECTION!,
    };

    return { embeddingClient, plannerClient, synthClient, dbConfig };
  } catch (err: any) {
    console.error('[clients] Failed to construct passwordless OpenAI clients:', err?.message ?? err);
    throw err;
  }
}