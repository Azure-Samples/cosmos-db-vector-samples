import { AzureOpenAIEmbeddings, AzureChatOpenAI  } from "@langchain/openai";

// Diagnostic: report presence of key env vars (do not print secrets)
const DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1';
if (DEBUG) {
  console.log('[clients] Env present:', {
    HAS_AZURE_OPENAI_API_KEY: !!process.env.AZURE_OPENAI_API_KEY,
    HAS_AZURE_OPENAI_INSTANCE: !!process.env.AZURE_OPENAI_API_INSTANCE_NAME,
    HAS_EMBEDDING_DEPLOYMENT: !!process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
    HAS_PLANNER_DEPLOYMENT: !!process.env.AZURE_OPENAI_PLANNER_DEPLOYMENT,
    HAS_SYNTH_DEPLOYMENT: !!process.env.AZURE_OPENAI_SYNTH_DEPLOYMENT,
  });
}

function createClients() {
  try {

    const key = process.env.AZURE_OPENAI_API_KEY;
    const instance = process.env.AZURE_OPENAI_API_INSTANCE_NAME;
    if (!key || !instance) {
      throw new Error('Missing AZURE_OPENAI_API_KEY or AZURE_OPENAI_API_INSTANCE_NAME');
    }

    const auth = { azureOpenAIApiKey: key,
      azureOpenAIApiInstanceName: instance };

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

const _clients = createClients();
export const embeddingClient = _clients.embeddingClient;
export const plannerClient = _clients.plannerClient;
export const synthClient = _clients.synthClient;
