import { AzureChatOpenAI } from "@langchain/openai";

const config = {
  temperature: 0,
  maxTokens: 100,
  maxRetries: 2,
  azureOpenAIApiKey: "", 
  azureOpenAIApiInstanceName: "my-openai",
  azureOpenAIApiDeploymentName: "gpt-4o",
  model: "gpt-4o",
  azureOpenAIApiVersion: "2024-04-01-preview"
};

const llm = new AzureChatOpenAI(config);
const aiMsg = await llm.invoke([
  [
    "system",
    "You are a helpful assistant that translates English to French. Translate the user sentence.",
  ],
  ["human", "I love programming."],
]);
console.log(aiMsg.content);