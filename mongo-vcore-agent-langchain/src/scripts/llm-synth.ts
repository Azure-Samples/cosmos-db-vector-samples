import {
  DefaultAzureCredential,
  getBearerTokenProvider,
} from "@azure/identity";
import { AzureChatOpenAI } from "@langchain/openai";

export async function testSynth() {
  const credentials = new DefaultAzureCredential();
  const azureADTokenProvider = getBearerTokenProvider(
    credentials,
    "https://cognitiveservices.azure.com/.default",
  );

  const llmWithManagedIdentity = new AzureChatOpenAI({
    azureADTokenProvider,
    azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME!,
    azureOpenAIApiDeploymentName:
      process.env.AZURE_OPENAI_SYNTH_DEPLOYMENT!,
    azureOpenAIApiVersion: process.env.AZURE_OPENAI_SYNTH_API_VERSION!,
    azureOpenAIBasePath: `https://${process.env.AZURE_OPENAI_API_INSTANCE_NAME}.openai.azure.com/openai/deployments`,
  });

  const response = await llmWithManagedIdentity.invoke("Hi there!");
  console.log(response);
  return response;
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testSynth().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
}
