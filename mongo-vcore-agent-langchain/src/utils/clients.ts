import { AzureOpenAIEmbeddings, AzureChatOpenAI } from "@langchain/openai";
import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';

/*

This file contains utility functions to create Azure OpenAI clients for embeddings, planning, and synthesis.

It supports two modes of authentication:
1. API Key based authentication using AZURE_OPENAI_API_KEY and AZURE_OPENAI_API_INSTANCE_NAME environment variables.
2. Passwordless authentication using DefaultAzureCredential from Azure Identity library.

*/

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
      HAS_SYNTH_DEPLOYMENT: !!process.env.AZURE_OPENAI_SYNTH_DEPLOYMENT,
      DEFAULT_CREDENTIAL_WILL_TRY: 'VisualStudioCode/AzureCli/ManagedIdentity/Environment',
    });
  } else {
    console.log('[clients] Env present:', {
      HAS_AZURE_OPENAI_API_KEY: !!process.env.AZURE_OPENAI_API_KEY,
      HAS_AZURE_OPENAI_INSTANCE: !!process.env.AZURE_OPENAI_API_INSTANCE_NAME,
      HAS_EMBEDDING_DEPLOYMENT: !!process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
      HAS_PLANNER_DEPLOYMENT: !!process.env.AZURE_OPENAI_PLANNER_DEPLOYMENT,
      HAS_SYNTH_DEPLOYMENT: !!process.env.AZURE_OPENAI_SYNTH_DEPLOYMENT,
    });
  }
}

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

    return { embeddingClient, plannerClient, synthClient };
  } catch (err: any) {
    console.error('[clients] Failed to construct OpenAI clients:', err?.message ?? err);
    console.error('[clients] Confirm AZURE_OPENAI_* env vars are set correctly (or configure passwordless token provider).');
    throw err;
  }
}

export function createClientsPasswordless() {
  try {
    const instance = process.env.AZURE_OPENAI_API_INSTANCE_NAME;
    if (!instance) {
      throw new Error('Missing passwordless: AZURE_OPENAI_API_INSTANCE_NAME for passwordless client');
    }

    const credential = new DefaultAzureCredential();
    const scope = 'https://cognitiveservices.azure.com/.default';
    const azureADTokenProvider = getBearerTokenProvider(credential, scope);

    const embeddingClient = new AzureOpenAIEmbeddings({
      azureADTokenProvider,
      azureOpenAIApiEmbeddingsDeploymentName: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
      azureOpenAIApiVersion: process.env.AZURE_OPENAI_EMBEDDING_API_VERSION,
      maxRetries: 1,
    });

    const plannerClient = new AzureChatOpenAI({
      azureADTokenProvider,
      model: process.env.AZURE_OPENAI_PLANNER_DEPLOYMENT!,
      temperature: 0,
      azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_PLANNER_DEPLOYMENT,
      azureOpenAIApiVersion: process.env.AZURE_OPENAI_PLANNER_API_VERSION,
    });

    const synthClient = new AzureChatOpenAI({
      azureADTokenProvider,
      model: process.env.AZURE_OPENAI_SYNTH_DEPLOYMENT!,
      temperature: 0.3,
      azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_SYNTH_DEPLOYMENT,
      azureOpenAIApiVersion: process.env.AZURE_OPENAI_SYNTH_API_VERSION,
    });

    return { embeddingClient, plannerClient, synthClient };
  } catch (err: any) {
    console.error('[clients] Failed to construct passwordless OpenAI clients:', err?.message ?? err);
    throw err;
  }
}

