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

// Helper functions to get vector index options based on algorithm
function getSimilarityType(similarity: string) {
  switch (similarity.toUpperCase()) {
    case 'COS':
      return AzureCosmosDBMongoDBSimilarityType.COS;
    case 'L2':
      return AzureCosmosDBMongoDBSimilarityType.L2;
    case 'IP':
      return AzureCosmosDBMongoDBSimilarityType.IP;
    default:
      return AzureCosmosDBMongoDBSimilarityType.COS;
  }
}

function getIVFIndexOptions() {
  return {
    numLists: parseInt(process.env.IVF_NUM_LISTS || '10'),
    dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || '1536'),
    similarity: getSimilarityType(process.env.VECTOR_SIMILARITY || 'COS'),
  };
}

function getHNSWIndexOptions() {
  return {
    kind: 'vector-hnsw' as const,
    m: parseInt(process.env.HNSW_M || '16'),
    efConstruction: parseInt(process.env.HNSW_EF_CONSTRUCTION || '64'),
    dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || '1536'),
    similarity: getSimilarityType(process.env.VECTOR_SIMILARITY || 'COS'),
  };
}

function getDiskANNIndexOptions() {
  return {
    kind: 'vector-diskann' as const,
    dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || '1536'),
    similarity: getSimilarityType(process.env.VECTOR_SIMILARITY || 'COS'),
  };
}

function getVectorIndexOptions() {
  const algorithm = process.env.VECTOR_INDEX_ALGORITHM || 'vector-ivf';

  switch (algorithm) {
    case 'vector-hnsw':
      return getHNSWIndexOptions();
    case 'vector-diskann':
      return getDiskANNIndexOptions();
    case 'vector-ivf':
    default:
      return getIVFIndexOptions();
  }
}

const hotelsData: HotelsData = JSON.parse(readFileSync(process.env.DATA_FILE_WITHOUT_VECTORS!, 'utf-8'));
const query = process.env.QUERY! || "quintessential lodging near running trails, eateries, retail";

const documents = hotelsData.map(hotel => new Document({
  pageContent: `Hotel: ${hotel.HotelName}\n\n${hotel.Description}`,
  metadata: {
    HotelId: hotel.HotelId,
    HotelName: hotel.HotelName,
    Description: hotel.Description,
    Description_fr: hotel.Description_fr,
    Category: hotel.Category,
    Tags: hotel.Tags,
    ParkingIncluded: hotel.ParkingIncluded,
    IsDeleted: hotel.IsDeleted,
    LastRenovationDate: hotel.LastRenovationDate,
    Rating: hotel.Rating,
    Address: hotel.Address,
    Location: hotel.Location,
    Rooms: hotel.Rooms
  },
  id: hotel.HotelId.toString()
}));

const embeddingClient = new AzureOpenAIEmbeddings({
  azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY!,
  azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME!,
  azureOpenAIApiEmbeddingsDeploymentName: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT!,
  azureOpenAIApiVersion: process.env.AZURE_OPENAI_EMBEDDING_API_VERSION!,
  maxRetries: 1,
});

const plannerClient = new AzureChatOpenAI({
  model: process.env.AZURE_OPENAI_PLANNER_DEPLOYMENT!,
  temperature: 0, // Deterministic for consistent query refinement
  maxRetries: 2,
  azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY!,
  azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME!,
  azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_PLANNER_DEPLOYMENT,
  azureOpenAIApiVersion: process.env.AZURE_OPENAI_PLANNER_API_VERSION,
});

const synthClient = new AzureChatOpenAI({
  model: process.env.AZURE_OPENAI_SYNTH_DEPLOYMENT!,
  temperature: 0.3, // Slightly creative for natural responses
  maxRetries: 2,
  azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY!,
  azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME!,
  azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_SYNTH_DEPLOYMENT,
  azureOpenAIApiVersion: process.env.AZURE_OPENAI_SYNTH_API_VERSION,
});

// Create Azure Cosmos DB for MongoDB vCore vector store
const store = await AzureCosmosDBMongoDBVectorStore.fromDocuments(
  documents,
  embeddingClient,
  {
    connectionString: process.env.MONGO_CONNECTION_STRING,
    databaseName: process.env.MONGO_DB_NAME!,
    collectionName: process.env.MONGO_DB_COLLECTION!,
    indexOptions: getVectorIndexOptions(),
  }
);

// Create hotel search tool
const hotelSearchTool = tool(
  ({ query, maxResults }: { query: string; maxResults: number }) => {
    console.log(`\n--- VECTOR SEARCH ---`);
    console.log(`Query: "${query}"`);
    console.log(`Max results: ${maxResults}`);

    const results = await store.similaritySearchVectorWithScore(
      await embeddingClient.embedQuery(query),
      maxResults
    );
    console.log(`Found ${results.length} hotels`);
    results.forEach(([doc, score], i) => console.log(`${i + 1}. ${doc.metadata.HotelName} (score: ${score.toFixed(4)})`));

    const hotelResults = results.map(([doc, score]) => ({
      hotelName: doc.metadata.HotelName,
      vectorScore: score
    }));
    
    console.log('\n--- TOOL RETURNING ---');
    console.log(JSON.stringify(hotelResults, null, 2));

    const context = results.map(([doc, score]) =>
      `Hotel: ${doc.metadata.HotelName}
      Score: ${score.toFixed(4)}
      ${doc.pageContent}
      Rating: ${doc.metadata.Rating}
      Category: ${doc.metadata.Category}
      Tags: ${doc.metadata.Tags.join(', ')}
      Parking Included: ${doc.metadata.ParkingIncluded ? 'Yes' : 'No'}
      Address: ${doc.metadata.Address.StreetAddress}, ${doc.metadata.Address.City}, ${doc.metadata.Address.StateProvince} ${doc.metadata.Address.PostalCode}
      Rooms Available: ${doc.metadata.Rooms.length} room type(s)`
    ).join('\n\n---\n\n');

    return context;
  },
  {
    name: 'search_hotels',
    description: 'Search for hotels based on user requirements. Returns detailed hotel information including name, description, rating, and category.',
    schema: z.object({
      query: z.string().describe('The search query to find relevant hotels'),
      maxResults: z.number().describe('Maximum number of hotels to return (default: 5)'),
    }),
  }
);

const handleToolErrors = createMiddleware({
  name: "HandleToolErrors",
  wrapToolCall: async (request, handler) => {
    try {
      return await handler(request);
    } catch (error) {
      // Return a custom error message to the model
      return new ToolMessage({
        content: `Tool error: Please check your input and try again. (${error})`,
        tool_call_id: request.toolCall.id!,
      });
    }
  },
});

// Planner agent function - decides what to search and executes the search
async function runPlannerAgent(userQuery: string): Promise<string> {
  console.log('\n--- PLANNER AGENT (with search tool) ---');
  console.log(`Input: "${userQuery}"`);

  const agent = createAgent({
    model: plannerClient,
    tools: [hotelSearchTool],
    systemPrompt: PLANNER_SYSTEM_PROMPT,
    middleware: [handleToolErrors],
  });

  const agentResult = await agent.invoke({
    messages: [{ role: "user", content: userQuery }],
  })

  // Log all messages to see tool calls and results
  console.log('\n--- AGENT MESSAGES ---');
  agentResult.messages.forEach((msg, i) => {
    console.log(`\nMessage ${i + 1}:`);
    console.log(`  Role: ${msg._getType()}`);
    if ('tool_calls' in msg && msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      console.log(`  Tool Calls: ${JSON.stringify(msg.tool_calls, null, 2)}`);
    }
    if (msg._getType() === 'tool') {
      console.log(`  Tool Result: ${msg.content}`);
    }
  });

  console.log(`\nOutput: Hotel context with ${agentResult.messages[agentResult.messages.length - 1].content.length} characters`);
  return agentResult.messages[agentResult.messages.length - 1].content as string;
}

// Synthesizer agent function - generates final user-friendly response
async function runSynthesizerAgent(userQuery: string, hotelContext: string): Promise<string> {
  console.log('\n--- SYNTHESIZER ---');
  console.log(`Input: User query + ${hotelContext.length} chars of hotel context`);

  const agent = createAgent({
    model: synthClient,
    systemPrompt: SYNTHESIZER_SYSTEM_PROMPT,
  });

  const agentResult = await agent.invoke({
    messages: [{ role: "user", content: createSynthesizerUserPrompt(userQuery, hotelContext) }],
  })
  const synthMessages = agentResult.messages;
  const finalAnswer = synthMessages[synthMessages.length - 1].content;
  console.log(`Output: ${finalAnswer.length} characters of final recommendation`);
  return finalAnswer as string;
}

// Execute two-agent workflow
const hotelContext = await runPlannerAgent(query);
const finalAnswer = await runSynthesizerAgent(query, hotelContext);

console.log('\n--- FINAL ANSWER ---');
console.log(finalAnswer);

await store.delete();
await store.close();