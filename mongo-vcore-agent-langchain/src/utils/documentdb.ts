import {
  AzureCosmosDBMongoDBVectorStore,
  AzureCosmosDBMongoDBSimilarityType,
} from "@langchain/azure-cosmosdb";
import { AzureOpenAIEmbeddings, AzureChatOpenAI  } from "@langchain/openai";
import { readFileSync } from 'fs';
import { Document } from '@langchain/core/documents';
import { HotelsData } from './types.js';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { ChatPromptTemplate } from '@langchain/core/prompts';

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

const auth = {
  azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY!,
  azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME!
}


export const embeddingClient = new AzureOpenAIEmbeddings({
  ...auth,
  azureOpenAIApiEmbeddingsDeploymentName: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT!,
  azureOpenAIApiVersion: process.env.AZURE_OPENAI_EMBEDDING_API_VERSION!,
  maxRetries: 1,
});

export const plannerClient = new AzureChatOpenAI({
  ...auth,
  model: process.env.AZURE_OPENAI_PLANNER_DEPLOYMENT!,
  temperature: 0, // Deterministic for consistent query refinement
  maxRetries: 2,
  azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_PLANNER_DEPLOYMENT,
  azureOpenAIApiVersion: process.env.AZURE_OPENAI_PLANNER_API_VERSION,
});

export const synthClient = new AzureChatOpenAI({
  ...auth,
  model: process.env.AZURE_OPENAI_SYNTH_DEPLOYMENT!,
  temperature: 0.3, // Slightly creative for natural responses
  maxRetries: 1,
  azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_SYNTH_DEPLOYMENT,
  azureOpenAIApiVersion: process.env.AZURE_OPENAI_SYNTH_API_VERSION,
});

export async function insertDocs(
  dataFilePath: string,
  embeddingClient: AzureOpenAIEmbeddings
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
      connectionString: process.env.MONGO_CONNECTION_STRING,
      databaseName: process.env.MONGO_DB_NAME!,
      collectionName: process.env.MONGO_DB_COLLECTION!,
      indexOptions: getVectorIndexOptions(),
    }
  );

  return store;
}