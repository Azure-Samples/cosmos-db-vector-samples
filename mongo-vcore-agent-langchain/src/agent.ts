import {
  AzureCosmosDBMongoDBVectorStore
} from "@langchain/azure-cosmosdb";
import { TOOL_NAME, PLANNER_SYSTEM_PROMPT, SYNTHESIZER_SYSTEM_PROMPT, createSynthesizerUserPrompt } from './utils/prompts.js';
import { z } from 'zod';
import { createAgent } from "langchain";
import { createClientsPasswordless, createClients} from './utils/clients.js';
import { DEBUG_CALLBACKS } from './utils/debug-handlers.js';
import { extractPlannerToolOutput, getStore, getHotelsToMatchSearchQuery, getExistingStore } from './vector-store.js';

// Planner agent uses Vector Search Tool
async function runPlannerAgent(
  plannerClient: any,
  embeddingClient: any,
  userQuery: string,
  store: AzureCosmosDBMongoDBVectorStore,
  nearestNeighbors = 5
): Promise<string> {
  console.log('\n--- PLANNER ---');

  const userMessage = `Call the "${TOOL_NAME}" tool with the desired number of neighbors: nearestNeighbors="${nearestNeighbors}" and the query: query="${userQuery}". Respond ONLY with a tool response JSON output`;

  const contextSchema = z.object({
    store: z.any(),
    embeddingClient: z.any()
  });

  const agent = createAgent({
    model: plannerClient,
    systemPrompt: PLANNER_SYSTEM_PROMPT,
    tools: [getHotelsToMatchSearchQuery],
    contextSchema,
  });

  const agentResult = await agent.invoke(
    { messages: [{ role: 'user', content: userMessage }] },
    // @ts-ignore
    { context: { store, embeddingClient }, callbacks: DEBUG_CALLBACKS }
  );

  const plannerMessages = agentResult.messages || [];
  const searchResultsAsText = extractPlannerToolOutput(plannerMessages);

  return searchResultsAsText;
}

// Synthesizer agent function generates final user-friendly response
async function runSynthesizerAgent(synthClient: any, userQuery: string, hotelContext: string): Promise<string> {
  console.log('\n--- SYNTHESIZER ---');

  let conciseContext = hotelContext;
  console.log(`Context size is ${conciseContext.length} characters`);

  const agent = createAgent({
    model: synthClient,
    systemPrompt: SYNTHESIZER_SYSTEM_PROMPT,
  });

  const agentResult = await agent.invoke({
    messages: [{
      role: 'user',
      content: createSynthesizerUserPrompt(userQuery, conciseContext)
    }]
  });
  const synthMessages = agentResult.messages;
  const finalAnswer = synthMessages[synthMessages.length - 1].content;
  console.log(`Output: ${finalAnswer.length} characters of final recommendation`);
  return finalAnswer as string;
}

try {
  // Authentication
  const clients = process.env.USE_PASSWORDLESS === 'true' || process.env.USE_PASSWORDLESS === '1' ? createClientsPasswordless() : createClients();
  const { embeddingClient, plannerClient, synthClient, dbConfig } = clients;
  console.log(`DEBUG mode is ${process.env.DEBUG === 'true' ? 'ON' : 'OFF'}`);
  console.log(`DEBUG_CALLBACKS length: ${DEBUG_CALLBACKS.length}`);


  // Get vector store (get docs, create embeddings, insert docs)
  const store = await getExistingStore(
    embeddingClient,
    dbConfig);

  const query = process.env.QUERY || "quintessential lodging near running trails, eateries, retail";
  const nearestNeighbors = parseInt(process.env.NEAREST_NEIGHBORS || '5', 10);

  //Run planner agent
  const hotelContext = await runPlannerAgent(plannerClient, embeddingClient, query, store, nearestNeighbors);
  if (process.env.DEBUG === 'true') console.log(hotelContext);

  //Run synth agent
  const finalAnswer = await runSynthesizerAgent(synthClient, query, hotelContext);
  // Get final recommendation (data + AI)
  console.log('\n--- FINAL ANSWER ---');
  console.log(finalAnswer);

  process.exit(0);
} catch (error) {
  console.error('Error running agent:', error);
}

