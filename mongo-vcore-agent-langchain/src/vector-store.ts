import {
  AzureCosmosDBMongoDBVectorStore,
  AzureCosmosDBMongoDBSimilarityType,
  AzureCosmosDBMongoDBConfig
} from "@langchain/azure-cosmosdb";
import type { AzureOpenAIEmbeddings } from "@langchain/openai";
import { readFileSync } from 'fs';
import { Document } from '@langchain/core/documents';
import { HotelsData, Hotel } from './utils/types.js';
import { TOOL_NAME, TOOL_DESCRIPTION } from './utils/prompts.js';
import { z } from 'zod';
import { tool } from "langchain";
import { MongoClient } from 'mongodb';
import { BaseMessage } from "@langchain/core/messages";

type HotelForVectorStore = Omit<Hotel, 'Description_fr' | 'Location' | 'Rooms'>;

// Helper function for similarity type
function getSimilarityType(similarity: string) {
  switch (similarity.toUpperCase()) {
    case 'COS': return AzureCosmosDBMongoDBSimilarityType.COS;
    case 'L2': return AzureCosmosDBMongoDBSimilarityType.L2;
    case 'IP': return AzureCosmosDBMongoDBSimilarityType.IP;
    default: return AzureCosmosDBMongoDBSimilarityType.COS;
  }
}

// Consolidated vector index configuration
function getVectorIndexOptions() {
  const algorithm = process.env.VECTOR_INDEX_ALGORITHM || 'vector-ivf';
  const dimensions = parseInt(process.env.EMBEDDING_DIMENSIONS || '1536');
  const similarity = getSimilarityType(process.env.VECTOR_SIMILARITY || 'COS');
  
  const baseOptions = { dimensions, similarity };
  
  switch (algorithm) {
    case 'vector-hnsw':
      return {
        kind: 'vector-hnsw' as const,
        m: parseInt(process.env.HNSW_M || '16'),
        efConstruction: parseInt(process.env.HNSW_EF_CONSTRUCTION || '64'),
        ...baseOptions
      };
    case 'vector-diskann':
      return {
        kind: 'vector-diskann' as const,
        ...baseOptions
      };
    case 'vector-ivf':
    default:
      return {
        numLists: parseInt(process.env.IVF_NUM_LISTS || '10'),
        ...baseOptions
      };
  }
}

// Format address fields for output
function formatAddress(addr: Record<string, any>): Record<string, string> {
  return {
    'Address.StreetAddress': addr?.StreetAddress ?? '',
    'Address.City': addr?.City ?? '',
    'Address.StateProvince': addr?.StateProvince ?? '',
    'Address.PostalCode': addr?.PostalCode ?? '',
    'Address.Country': addr?.Country ?? '',
  };
}

// Format hotel data for synthesizer agent
function formatHotelForSynthesizer(md: Partial<HotelForVectorStore>, score: number): string {
  const addr = md.Address || {} as Record<string, any>;
  const tags = Array.isArray(md.Tags) ? md.Tags.join(', ') : String(md.Tags || '');
  
  const fields = {
    HotelId: md.HotelId ?? 'N/A',
    HotelName: md.HotelName ?? 'N/A',
    Description: md.Description ?? '',
    Category: md.Category ?? '',
    Tags: tags,
    ParkingIncluded: md.ParkingIncluded === true,
    IsDeleted: md.IsDeleted === true,
    LastRenovationDate: md.LastRenovationDate ?? '',
    Rating: md.Rating ?? '',
    ...formatAddress(addr),
    Score: Number(score ?? 0).toFixed(6),
  };
  
  return [
    '--- HOTEL START ---',
    ...Object.entries(fields).map(([key, value]) => `${key}: ${value}`),
    '--- HOTEL END ---'
  ].join('\n');
}

// Get existing vector store without uploading documents
export async function getExistingStore(
  embeddingClient: AzureOpenAIEmbeddings,
  dbConfig: AzureCosmosDBMongoDBConfig
): Promise<AzureCosmosDBMongoDBVectorStore> {
  
  const store = new AzureCosmosDBMongoDBVectorStore(embeddingClient, {
    ...dbConfig,
    indexOptions: getVectorIndexOptions(),
  });

  console.log(`Connected to existing vector store: ${dbConfig.databaseName}.${dbConfig.collectionName}`);
  return store;
}

// Initialize vector store with hotel data
export async function getStore(
  dataFilePath: string,
  embeddingClient: AzureOpenAIEmbeddings,
  dbConfig: AzureCosmosDBMongoDBConfig
): Promise<AzureCosmosDBMongoDBVectorStore> {
  
  const hotelsData: HotelsData = JSON.parse(readFileSync(dataFilePath, 'utf-8'));

  // Use destructuring to exclude unwanted properties
  const documents = hotelsData.map(hotel => {
    const { Description_fr, Location, Rooms, ...hotelData } = hotel;
    
    return new Document({
      pageContent: `Hotel: ${hotel.HotelName}\n\n${hotel.Description}`,
      metadata: hotelData,
      id: hotel.HotelId.toString()
    });
  });

  const store = await AzureCosmosDBMongoDBVectorStore.fromDocuments(
    documents,
    embeddingClient,
    {
      ...dbConfig,
      indexOptions: getVectorIndexOptions(),
    }
  );

  console.log(`Inserted ${documents.length} documents into Cosmos DB (Mongo API) vector store.`);
  return store;
}

// Vector Search Tool
export const getHotelsToMatchSearchQuery = tool(
  async ({ query, nearestNeighbors }, config): Promise<string> => {
    try {
      const store = config.context.store as AzureCosmosDBMongoDBVectorStore;
      const embeddingClient = config.context.embeddingClient as AzureOpenAIEmbeddings;

      // Create query embedding and perform search
      const queryVector = await embeddingClient.embedQuery(query);
      const results = await store.similaritySearchVectorWithScore(queryVector, nearestNeighbors);
      console.log(`Found ${results.length} documents from vector store`);

      // Format results for synthesizer
      const formatted = results.map(([doc, score]) => {
        const md = doc.metadata as Partial<HotelForVectorStore>;
        console.log(`Hotel: ${md.HotelName ?? 'N/A'}, Score: ${score}`);
        return formatHotelForSynthesizer(md, score);
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


/**
 * Delete a Cosmos DB (Mongo API) database by name.
 *
 * Uses the `AZURE_DOCUMENTDB_CONNECTION_STRING` environment variable to connect.
 * Example env var: `mongodb://username:password@host:port/?ssl=true&replicaSet=globaldb`
 *
 * @param databaseName - The name of the database to drop.
 */
export async function deleteCosmosMongoDatabase(): Promise<void> {

    console.log(`\n\nCLEAN UP\n\n`);

    const databaseName = process.env.MONGO_DB_NAME;
    const connectionString = process.env.AZURE_DOCUMENTDB_CONNECTION_STRING;
    if (!connectionString) {
        throw new Error('Environment variable AZURE_DOCUMENTDB_CONNECTION_STRING is not set.');
    }

    const client = new MongoClient(connectionString);
    try {
        await client.connect();
        const db = client.db(databaseName);
        await db.dropDatabase();
    } finally {
        await client.close(true);
    }
}

/**
 * Extracts the hotel search tool output from the planner agent's message history.
 * 
 * The planner agent calls the search_hotels_collection tool, which returns a 
 * formatted string containing hotel data. This function locates that tool's 
 * response message and extracts the content string.
 * 
 * @param plannerMessages - Array of messages from the planner agent execution
 * @returns The formatted hotel search results as a string, or empty string if not found
 */
export function extractPlannerToolOutput(plannerMessages: BaseMessage[]): string {
  const messages = plannerMessages || [];

  // Find the tool response message
  const toolMsg = messages.find((m: any) => {
    if (!m) return false;
    if (m?.name === TOOL_NAME) return true;
    if (m?.role === 'tool') return true;
    if (m?.tool_call_id) return true;
    return false;
  });

  if (!toolMsg) {
    console.warn(`Tool "${TOOL_NAME}" was not invoked by the planner agent.`);
    return '';
  }

  // Extract the tool's string content
  if (typeof toolMsg.content === 'string') {
    return toolMsg.content;
  }
  
  if (Array.isArray(toolMsg.content)) {
    return toolMsg.content
      .map((block: any) => block.text ?? JSON.stringify(block))
      .join('');
  }
  
  // Fallback: stringify object content
  return JSON.stringify(toolMsg.content);
}