import {
  DefaultAzureCredential,
  getBearerTokenProvider,
} from "@azure/identity";
import { AzureOpenAIEmbeddings } from "@langchain/openai";

export async function testEmbeddings() {
  const credentials = new DefaultAzureCredential();
  const azureADTokenProvider = getBearerTokenProvider(
    credentials,
    "https://cognitiveservices.azure.com/.default",
  );

  if (process.env.DEBUG === "true") {
    console.log("[embed] Environment variables:");
    console.log(`  AZURE_OPENAI_API_INSTANCE_NAME: ${process.env.AZURE_OPENAI_API_INSTANCE_NAME}`);
    console.log(`  AZURE_OPENAI_EMBEDDING_MODEL: ${process.env.AZURE_OPENAI_EMBEDDING_MODEL}`);
    console.log(`  AZURE_OPENAI_EMBEDDING_API_VERSION: ${process.env.AZURE_OPENAI_EMBEDDING_API_VERSION}`);
    console.log(`  AZURE_OPENAI_API_KEY: ${process.env.AZURE_OPENAI_API_KEY ? '[SET]' : '[NOT SET]'}`);
  }

  const modelWithManagedIdentity = new AzureOpenAIEmbeddings({
    azureADTokenProvider,
    azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME!,
    azureOpenAIApiEmbeddingsDeploymentName:
      process.env.AZURE_OPENAI_EMBEDDING_MODEL!,
    azureOpenAIApiVersion: process.env.AZURE_OPENAI_EMBEDDING_API_VERSION!,
    azureOpenAIBasePath: `https://${process.env.AZURE_OPENAI_API_INSTANCE_NAME}.openai.azure.com/openai/deployments`,
  });

  const vectors = await modelWithManagedIdentity.embedDocuments([
    "Hello world",
    "Bonjour le monde",
  ]);
  console.log("Embeddings with Managed Identity:");
  console.log(vectors);
  return vectors;
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testEmbeddings().catch((error) => {
    console.error("Error using Managed Identity for embeddings:", error);
    process.exit(1);
  });
}
