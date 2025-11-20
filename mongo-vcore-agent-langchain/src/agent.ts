import {
  AzureCosmosDBMongoDBVectorStore } from "@langchain/azure-cosmosdb";
import { AzureOpenAIEmbeddings } from "@langchain/openai";
import { PLANNER_SYSTEM_PROMPT, SYNTHESIZER_SYSTEM_PROMPT, createSynthesizerUserPrompt } from './utils/prompts.js';
import { z } from 'zod';
import { createAgent, tool } from "langchain";
import { embeddingClient, plannerClient, synthClient } from './utils/clients.js';
// Helper functions to get vector index options based on algorithm
import { insertDocs } from './utils/documentdb.js';

const query = process.env.QUERY! || "quintessential lodging near running trails, eateries, retail";

const getHotelsToMatchSearchQuery = tool(
  async ({ query, nearestNeighbors }, config) => {

    const store = config.context.store as AzureCosmosDBMongoDBVectorStore;
    const embeddingClient = config.context.embeddingClient as AzureOpenAIEmbeddings;

    // Create an embedding for the query using the shared embedding client
    const queryVector = await embeddingClient.embedQuery(query);

    // Perform similarity search on the vector store
    const results = await store.similaritySearchVectorWithScore(queryVector, nearestNeighbors);
    console.log(`Found ${results.length} documents from vector store`);

    // Map results to the Hotel type (HotelsData) by extracting metadata fields
    const hotels = results.map(([doc, score]) => {
      const md = doc.metadata || {} as Record<string, any>;
      return {
        HotelId: md.HotelId,
        HotelName: md.HotelName,
        Description: md.Description,
        Category: md.Category,
        Tags: md.Tags || [],
        ParkingIncluded: md.ParkingIncluded,
        IsDeleted: md.IsDeleted,
        LastRenovationDate: md.LastRenovationDate,
        Rating: md.Rating,
        Address: md.Address,
        Score: score
      };
    });

    return hotels;
  },
  {
    name: "search_hotels_collection",
    description: "Perform a vector search against the hotels collection to retrieve hotel documents used for recommendation and comparison.",
    schema: z.object({
      query: z.string(),
      nearestNeighbors: z.number().optional().default(5),
    }),
  }
);



// Planner agent function - directly performs a vector search and returns documents
async function runPlannerAgent(
  userQuery: string,
  store: AzureCosmosDBMongoDBVectorStore,
  nearestNeighbors = 5
): Promise<void> {
  console.log('\n--- PLANNER (direct vector search) ---');

  const userMessage = `Call the "search_hotels_collection" tool with the desired number of neighbors: nearestNeighbors="${nearestNeighbors}" and the query: query="${userQuery}". Respond ONLY with a tool response JSON output`;

  console.log(`Agent input: "${userQuery}"`);

  const contextSchema = z.object({
    store: z.any(),
    embeddingClient: z.any(),
  });

  const agent = createAgent({
    model: plannerClient,
    systemPrompt: PLANNER_SYSTEM_PROMPT,
    tools: [getHotelsToMatchSearchQuery],
    contextSchema,
  });

  // Diagnostic callbacks array to log agent decisions and tool usage
  const plannerCallbacks = [
    {
      handleLLMStart: async (_llm, prompts) => {
        console.log('[planner][LLM start] prompts=', Array.isArray(prompts) ? prompts.length : 1);
      },
      handleLLMEnd: async (_output) => {
        console.log('[planner][LLM end]');
      },
      handleLLMError: async (err) => {
        console.error('[planner][LLM error]', err);
      },
      handleAgentAction: async (action) => {
        try {
          const toolName = action?.tool?.name ?? action?.tool ?? 'unknown';
          const input = action?.input ? (typeof action.input === 'string' ? action.input : JSON.stringify(action.input)) : '';
          console.log(`[planner][Agent Decision] tool=${toolName} input=${input}`);
        }
        catch (e) { /* ignore */ }
      },
      handleToolStart: async (tool) => {
        console.log('[planner][Tool Start]', typeof tool === 'string' ? tool : (tool?.name ?? JSON.stringify(tool)));
      },
      handleToolEnd: async (output) => {
        try {
          const summary = typeof output === 'string' ? output.slice(0, 200) : JSON.stringify(output).slice(0, 200);
          console.log('[planner][Tool End] output summary=', summary);
        }
        catch (e) { /* ignore */ }
      }
    }
  ];

  const agentResult = await agent.invoke(
    { messages: [{ role: 'user', content: userMessage }] },
    { context: { store, embeddingClient }, callbacks: plannerCallbacks }
  );

  const plannerMessages = agentResult.messages;
  console.log(plannerMessages);

  // Return the hotels array (JSON) to the synthesizer — vectors are not included
  // return JSON.stringify(hotels);
}

// Synthesizer agent function - generates final user-friendly response
async function runSynthesizerAgent(userQuery: string, hotelContext: string): Promise<string> {
  console.log('\n--- SYNTHESIZER ---');

  let conciseContext = hotelContext;
  console.log(`Context size is ${conciseContext.length} characters`);

  const agent = createAgent({
    model: synthClient,
    systemPrompt: SYNTHESIZER_SYSTEM_PROMPT,
  });

  // const cbManager = CallbackManager.fromHandlers({
  //   handleLLMStart: async (llm, prompts) => {
  //     try {
  //       console.log('[LLM start] model=', llm?.name ?? llm?.model ?? llm?.modelName, 'prompts=', Array.isArray(prompts) ? prompts.length : 1);
  //     } catch (e) { /* ignore */ }
  //   },
  //   handleLLMNewToken: async (token) => {
  //     try { process.stdout.write(token); } catch (e) { /* ignore */ }
  //   },
  //   handleLLMEnd: async (output) => {
  //     try { console.log('\n[LLM end] output keys=', Object.keys(output || {})); } catch (e) { /* ignore */ }
  //   },
  //   handleLLMError: async (err) => {
  //     try { console.error('[LLM error]', err); } catch (e) { /* ignore */ }
  //   }
  // });

  const agentResult = await agent.invoke({
    messages: [{ role: 'user', content: createSynthesizerUserPrompt(userQuery, conciseContext) }],
    //callbacks: cbManager,
  });
  const synthMessages = agentResult.messages;
  const finalAnswer = synthMessages[synthMessages.length - 1].content;
  console.log(`Output: ${finalAnswer.length} characters of final recommendation`);
  return finalAnswer as string;
}

// Execute two-agent workflow
const store = await insertDocs(
  process.env.DATA_FILE_WITHOUT_VECTORS!,
  embeddingClient);



const hotelContext = await runPlannerAgent(query, store, 5);
//const finalAnswer = await runSynthesizerAgent(query, hotelContext);

console.log('\n--- FINAL ANSWER ---');
//console.log(finalAnswer);

await store.delete();
await store.close();