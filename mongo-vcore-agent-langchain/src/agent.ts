import {
  AzureCosmosDBMongoDBVectorStore
} from "@langchain/azure-cosmosdb";
import { AzureOpenAIEmbeddings } from "@langchain/openai";
import { TOOL_NAME, TOOL_DESCRIPTION, PLANNER_SYSTEM_PROMPT, SYNTHESIZER_SYSTEM_PROMPT, createSynthesizerUserPrompt } from './utils/prompts.js';
import { z } from 'zod';
import { createAgent, tool } from "langchain";
import { createClientsPasswordless, createClients } from './utils/clients.js';
import { DEBUG_CALLBACKS } from './utils/debug-handlers.js';
import { extractPlannerToolOutput } from './utils/tool-results-extraction.js';
import { deleteCosmosMongoDatabase } from './utils/mongodb-cleanup.js';
import { getStore } from './utils/azure-documentdb.js';

// Authentication
const clients = process.env.USE_PASSWORDLESS === 'true' || process.env.USE_PASSWORDLESS === '1' ? createClientsPasswordless() : createClients();
const { embeddingClient, plannerClient, synthClient, dbConfig } = clients;
console.log(`DEBUG mode is ${process.env.DEBUG === 'true' ? 'ON' : 'OFF'}`);
console.log(`DEBUG_CALLBACKS length: ${DEBUG_CALLBACKS.length}`);

// Vector Search Tool
const getHotelsToMatchSearchQuery = tool(
  async ({ query, nearestNeighbors }, config): Promise<string> => {

    try{

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

    hotels.map(hotel => {
      console.log(`Hotel: ${hotel.HotelName}, Score: ${hotel.Score}`);
    });

    // Build a well-named, human-readable text block for each hotel with clear markers
    const formatted = hotels.map(h => {
      const addr = h.Address || {} as Record<string, any>;
      const tags = Array.isArray(h.Tags) ? h.Tags.join(', ') : String(h.Tags || '');
      return [
        '--- HOTEL START ---',
        `HotelId: ${h.HotelId ?? 'N/A'}`,
        `HotelName: ${h.HotelName ?? 'N/A'}`,
        `Description: ${h.Description ?? ''}`,
        `Category: ${h.Category ?? ''}`,
        `Tags: ${tags}`,
        `ParkingIncluded: ${h.ParkingIncluded === true}`,
        `IsDeleted: ${h.IsDeleted === true}`,
        `LastRenovationDate: ${h.LastRenovationDate ?? ''}`,
        `Rating: ${h.Rating ?? ''}`,
        `Address.StreetAddress: ${addr?.StreetAddress ?? ''}`,
        `Address.City: ${addr?.City ?? ''}`,
        `Address.StateProvince: ${addr?.StateProvince ?? ''}`,
        `Address.PostalCode: ${addr?.PostalCode ?? ''}`,
        `Address.Country: ${addr?.Country ?? ''}`,
        `Score: ${Number(h.Score ?? 0).toFixed(6)}`,
        '--- HOTEL END ---'
      ].join('\n');
    }).join('\n\n');

    return formatted;
    } catch (error) {
      console.error('Error in getHotelsToMatchSearchQuery tool:', error);
      return 'Error occurred while searching for hotels.';
    }
  },
  {
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    schema: z.object({
      query: z.string(),
      nearestNeighbors: z.number().optional().default(5),
    }),
  }
);

// Planner agent uses Vector Search Tool
async function runPlannerAgent(
  userQuery: string,
  store: AzureCosmosDBMongoDBVectorStore,
  nearestNeighbors = 5
): Promise<string> {
  console.log('\n--- PLANNER ---');

  const userMessage = `Call the "${TOOL_NAME}" tool with the desired number of neighbors: nearestNeighbors="${nearestNeighbors}" and the query: query="${userQuery}". Respond ONLY with a tool response JSON output`;

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

  const agentResult = await agent.invoke(
    { messages: [{ role: 'user', content: userMessage }] },
    // @ts-ignore
    { context: { store, embeddingClient }, callbacks: DEBUG_CALLBACKS }
  );

  const plannerMessages = agentResult.messages || [];
  const searchResultsAsText = extractPlannerToolOutput(plannerMessages, nearestNeighbors);
  
  return searchResultsAsText;
}

// Synthesizer agent function generates final user-friendly response
async function runSynthesizerAgent(userQuery: string, hotelContext: string): Promise<string> {
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

// Get vector store (get docs, create embeddings, insert docs)
const store = await getStore(
  process.env.DATA_FILE_WITHOUT_VECTORS!,
  embeddingClient,
  dbConfig);

const query = process.env.QUERY || "quintessential lodging near running trails, eateries, retail";

// Run planner agent
const hotelContext = await runPlannerAgent(query, store, 5);
if (process.env.DEBUG==='true') console.log(hotelContext);

// Run synth agent
const finalAnswer = await runSynthesizerAgent(query, hotelContext);

// // Get final recommendation (data + AI)
console.log('\n--- FINAL ANSWER ---');
console.log(finalAnswer);

// Clean up (delete database)
await store.close();
await deleteCosmosMongoDatabase();