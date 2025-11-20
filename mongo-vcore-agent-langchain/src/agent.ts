import {
  AzureCosmosDBMongoDBVectorStore,
  AzureCosmosDBMongoDBSimilarityType,
} from "@langchain/azure-cosmosdb";
import { AzureOpenAIEmbeddings, AzureChatOpenAI } from "@langchain/openai";
import { readFileSync } from 'fs';
import { Document } from '@langchain/core/documents';
import { HotelsData } from './utils/types.js';
import { PLANNER_SYSTEM_PROMPT, SYNTHESIZER_SYSTEM_PROMPT, createSynthesizerUserPrompt } from './utils/prompts.js';
import { z } from 'zod';
import { createAgent, tool, createMiddleware, ToolMessage } from "langchain";
import { embeddingClient, plannerClient, synthClient } from './utils/clients.js';
// Helper functions to get vector index options based on algorithm
import { insertDocs } from './utils/documentdb.js';
import { VectorStore } from "@langchain/core/vectorstores";

const query = process.env.QUERY! || "quintessential lodging near running trails, eateries, retail";

// Planner agent function - directly performs a vector search and returns documents
async function runPlannerAgent(
  userQuery: string,
  store: AzureCosmosDBMongoDBVectorStore,
  maxResults = 5
): Promise<string> {
  console.log('\n--- PLANNER (direct vector search) ---');
  console.log(`Input: "${userQuery}"`);

  // Create an embedding for the query using the shared embedding client
  const queryVector = await embeddingClient.embedQuery(userQuery);

  // Perform similarity search on the vector store
  const results = await store.similaritySearchVectorWithScore(queryVector, maxResults);
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
      Address: md.Address
      };
  });

  // For transparency, log top hits
  hotels.forEach((h, i) => {
    console.log(`${i + 1}. ${h.HotelName || 'unknown'} (id: ${h.HotelId})`);
  });

  // Return the hotels array (JSON) to the synthesizer — vectors are not included
  return JSON.stringify(hotels);
}

// Synthesizer agent function - generates final user-friendly response
async function runSynthesizerAgent(userQuery: string, hotelContext: string): Promise<string> {
  console.log('\n--- SYNTHESIZER ---');

  let conciseContext = hotelContext;

  const agent = createAgent({
    model: synthClient,
    systemPrompt: SYNTHESIZER_SYSTEM_PROMPT,
  });

  const agentResult = await agent.invoke({
    messages: [{ role: 'user', content: createSynthesizerUserPrompt(userQuery, conciseContext) }],
  });
  const synthMessages = agentResult.messages;
  const finalAnswer = synthMessages[synthMessages.length - 1].content;
  console.log(`Output: ${finalAnswer.length} characters of final recommendation`);
  return finalAnswer as string;
}

// Execute two-agent workflow
const store = await insertDocs(
  process.env.DATA_FILE_WITH_VECTORS!,
  embeddingClient);



const hotelContext = await runPlannerAgent(query, store, 5);
const finalAnswer = await runSynthesizerAgent(query, hotelContext);

console.log('\n--- FINAL ANSWER ---');
console.log(finalAnswer);

await store.delete();
await store.close();