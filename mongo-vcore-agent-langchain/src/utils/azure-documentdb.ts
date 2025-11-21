import {
  AzureCosmosDBMongoDBVectorStore,
  AzureCosmosDBMongoDBSimilarityType,
  AzureCosmosDBMongoDBConfig
} from "@langchain/azure-cosmosdb";
import type { AzureOpenAIEmbeddings  } from "@langchain/openai";
import { readFileSync } from 'fs';
import { Document } from '@langchain/core/documents';
import { HotelsData } from './types.js';
import { TOOL_NAME, TOOL_DESCRIPTION } from './prompts.js';
import { z } from 'zod';
import { tool } from "langchain";


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

export async function getStore(dataFilePath: string, embeddingClient: AzureOpenAIEmbeddings, dbConfig: AzureCosmosDBMongoDBConfig): Promise<AzureCosmosDBMongoDBVectorStore> {

  return insertDocs(dataFilePath, embeddingClient, dbConfig);
}

export async function insertDocs(
  dataFilePath: string,
  embeddingClient: AzureOpenAIEmbeddings,
  dbConfig: AzureCosmosDBMongoDBConfig
): Promise<AzureCosmosDBMongoDBVectorStore> {

  const hotelsData: HotelsData = JSON.parse(readFileSync(dataFilePath, 'utf-8'));

  const documents = hotelsData.map(hotel => new Document({
    pageContent: `Hotel: ${hotel.HotelName}\n\n${hotel.Description}`,
    metadata: {
      HotelId: hotel.HotelId,
      HotelName: hotel.HotelName,
      Description: hotel.Description,
      Category: hotel.Category,
      Tags: hotel.Tags,
      ParkingIncluded: hotel.ParkingIncluded,
      IsDeleted: hotel.IsDeleted,
      LastRenovationDate: hotel.LastRenovationDate,
      Rating: hotel.Rating,
      Address: hotel.Address,
      Location: hotel.Location,
    },
    id: hotel.HotelId.toString()
  }));

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