import {
  AzureCosmosDBMongoDBVectorStore,
  AzureCosmosDBMongoDBSimilarityType,
  AzureCosmosDBMongoDBConfig
} from "@langchain/azure-cosmosdb";
import { AzureOpenAIEmbeddings  } from "@langchain/openai";
import { readFileSync } from 'fs';
import { Document } from '@langchain/core/documents';
import { HotelsData } from './types.js';

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