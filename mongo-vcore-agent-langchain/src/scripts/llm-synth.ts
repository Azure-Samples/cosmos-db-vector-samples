import {
  DefaultAzureCredential,
  getBearerTokenProvider,
} from "@azure/identity";
import { AzureChatOpenAI } from "@langchain/openai";

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
