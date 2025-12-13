# Functional Specification: Hotel Recommendation RAG Agent

> **Purpose**: This document provides a language-agnostic specification of the hotel recommendation system so it can be implemented in any programming language or framework.

## Table of Contents

- [Overview](#overview)
- [System Architecture](#system-architecture)
- [Data Model](#data-model)
- [Azure Resources Required](#azure-resources-required)
- [Authentication](#authentication)
- [Core Workflows](#core-workflows)
- [Application Entry Points](#application-entry-points)
- [Vector Search Implementation](#vector-search-implementation)
- [Agent Pipeline Specification](#agent-pipeline-specification)
- [Environment Configuration](#environment-configuration)

---

## Overview

**Application Type**: Retrieval-Augmented Generation (RAG) system using a two-agent pipeline

**Domain**: Hotel recommendation based on natural language queries

**Technology Stack** (framework agnostic):
- Vector database: Azure Cosmos DB for MongoDB vCore
- LLM Provider: Azure OpenAI Service
- Embedding Model: text-embedding-3-small (1536 dimensions)
- Chat Models: gpt-4o-mini (planner), gpt-4o (synthesizer)

**Core Capability**: User provides natural language query → System returns ranked hotel recommendations with comparative analysis

---

## System Architecture

### High-Level Flow

```
User Query
    ↓
[Planner Agent] ← Uses Chat Model (gpt-4o-mini)
    ↓
[Vector Search Tool] ← Generates embedding & queries Cosmos DB
    ↓
[Search Results] → JSON array of hotels with similarity scores
    ↓
[Synthesizer Agent] ← Uses Chat Model (gpt-4o)
    ↓
Final Recommendation → Natural language response
```

### Component Breakdown

1. **Planner Agent**:
   - **Input**: User's natural language query
   - **Process**: Refines query and calls vector search tool
   - **Output**: Structured search results (JSON)

2. **Vector Search Tool**:
   - **Input**: Refined query string + number of neighbors (k)
   - **Process**: Generate embedding → Execute vector similarity search
   - **Output**: Top-k hotels with metadata and similarity scores

3. **Synthesizer Agent**:
   - **Input**: Original query + search results
   - **Process**: Analyze and compare top 3 results
   - **Output**: Natural language recommendation with tradeoffs

---

## Data Model

### Hotel Document Structure

Each hotel document must contain the following fields:

```json
{
  "HotelId": "string (unique identifier)",
  "HotelName": "string",
  "Description": "string (English description)",
  "Category": "string (e.g., 'Budget', 'Luxury')",
  "Tags": ["array", "of", "strings"],
  "ParkingIncluded": "boolean",
  "IsDeleted": "boolean",
  "LastRenovationDate": "ISO 8601 date string",
  "Rating": "number (0-5)",
  "Address": {
    "StreetAddress": "string",
    "City": "string",
    "StateProvince": "string (optional)",
    "PostalCode": "string",
    "Country": "string"
  }
}
```

**Fields NOT stored in vector database** (excluded during upload):
- `Description_fr`: French description
- `Location`: GeoJSON coordinates
- `Rooms`: Room details array

### Vector Store Configuration

**Embedding Field**: 
- Field name: `contentVector`
- Dimensions: 1536
- Generated from: Concatenation of `HotelName` and `Description`

**Vector Index Types** (configurable):
1. **IVF (Inverted File Index)**: Default, balanced performance
   - Parameter: `numLists` (default: 10)
2. **HNSW (Hierarchical Navigable Small World)**: Fast queries
   - Parameters: `m` (default: 16), `efConstruction` (default: 64)
3. **DiskANN**: Memory-efficient for large datasets

**Similarity Metric** (configurable):
- Cosine (COS) - default
- L2 (Euclidean distance)
- IP (Inner Product)

---

## Azure Resources Required

### 1. Azure OpenAI Service

**Models to Deploy**:
1. **Embeddings**: `text-embedding-3-small`
   - API Version: 2024-08-01-preview or later
   
2. **Planner Chat Model**: `gpt-4o-mini`
   - API Version: 2024-08-01-preview or later
   
3. **Synthesizer Chat Model**: `gpt-4o`
   - API Version: 2024-08-01-preview or later

**Required Outputs**:
- OpenAI instance name
- Each model's deployment name
- API versions for each model

### 2. Azure Cosmos DB for MongoDB vCore

**Requirements**:
- MongoDB vCore cluster (not standard Cosmos DB)
- Vector search capability enabled
- Database name (e.g., `hotels`)
- Collection name (e.g., `hotel_data`)

**Required Outputs**:
- Cluster name (e.g., `my-cluster`)
- Connection format: `mongodb+srv://{cluster}.global.mongocluster.cosmos.azure.com/`

### 3. Managed Identity (Recommended)

**Purpose**: Passwordless authentication to Azure services

**Type**: User-assigned managed identity

**Required Role Assignments**:
- Azure OpenAI: `Cognitive Services OpenAI User`
- Cosmos DB: MongoDB user with read/write permissions

---

## Authentication

### Two Authentication Modes

#### Mode 1: Passwordless (Recommended)

**Azure OpenAI**:
- Use Azure AD bearer token
- Token scope: `https://cognitiveservices.azure.com/.default`
- Refresh token automatically when expired

**Cosmos DB MongoDB**:
- Use MONGODB-OIDC authentication mechanism
- Token scope: `https://ossrdbms-aad.database.windows.net/.default`
- Provide OIDC callback function to retrieve token

**Implementation Requirements**:
- Azure Identity library (or equivalent)
- DefaultAzureCredential (supports managed identity, Azure CLI, etc.)

#### Mode 2: API Keys

**Azure OpenAI**:
- Use API key from Azure portal
- Pass in header: `api-key: {key}`

**Cosmos DB MongoDB**:
- Use standard MongoDB connection string with username/password

---

## Core Workflows

### Workflow 1: Data Upload (One-time Setup)

**Purpose**: Load hotel data into vector database

**Steps**:
1. Read hotel data from JSON file
2. Connect to embedding model (passwordless or API key)
3. Connect to MongoDB database
4. For each hotel document:
   - Create page content: `"Hotel: {HotelName}\n\n{Description}"`
   - Exclude: `Description_fr`, `Location`, `Rooms`
   - Generate embedding for page content
   - Insert document with embedding into collection
5. Create vector index on collection (IVF/HNSW/DiskANN)
6. Close connections

**Input**: JSON file with array of hotel objects

**Output**: Populated collection with vector index

### Workflow 2: Vector Search Query

**Purpose**: Find hotels matching a natural language query

**Steps**:
1. Receive search query (string) and k (number of neighbors)
2. Generate embedding for query using embedding model
3. Execute vector similarity search against collection:
   - Field: `contentVector`
   - Similarity metric: cosine/L2/IP
   - Limit: k results
4. Retrieve documents with similarity scores
5. Format results as JSON array with hotel metadata + scores
6. Return formatted results

**Input**: 
- Query: string
- k: integer (1-20)

**Output**: JSON array of hotels with scores

### Workflow 3: Agent Pipeline

**Purpose**: Generate natural language recommendation from user query

**Steps**:
1. Receive user query
2. **Planner Agent**:
   - Input: User query
   - System prompt: Instructs to refine query and call search tool
   - Action: Calls vector search tool with refined query + k value
   - Output: Search results (JSON)
3. **Parse Results**: Extract tool output from planner response
4. **Synthesizer Agent**:
   - Input: Original query + search results
   - System prompt: Instructs to compare top 3 and recommend
   - Output: Natural language recommendation
5. Display final recommendation to user

---

## Application Entry Points

### Entry Point 1: Authentication Test

**Purpose**: Verify connectivity to all Azure services

**Requirements**:
- Test embedding API
- Test planner chat model
- Test synthesizer chat model  
- Test MongoDB connection

**Success Criteria**: All 4 services return successful responses

### Entry Point 2: Data Upload

**Purpose**: Initialize database with hotel data

**Requirements**:
- Run once after infrastructure provisioning
- Creates collection, inserts documents, creates vector index

**Success Criteria**: Collection exists with N documents and vector index

### Entry Point 3: Agent Application

**Purpose**: Run hotel recommendation agent

**Requirements**:
- Connect to existing vector store (no upload)
- Accept user query as input
- Execute two-agent pipeline
- Return final recommendation

**Success Criteria**: Natural language recommendation displayed

### Entry Point 4: Database Cleanup

**Purpose**: Delete database and all data

**Requirements**:
- Use passwordless authentication
- Drop specified database
- Confirm deletion

**Success Criteria**: Database no longer exists

---

## Vector Search Implementation

### Query Execution Details

**Algorithm**:
```
1. Input: query_text, k
2. embedding = generate_embedding(query_text)
3. results = vector_search(
     collection="hotel_data",
     vector_field="contentVector", 
     query_vector=embedding,
     k=k,
     similarity="cosine"
   )
4. For each result:
     - Add similarity score
     - Format hotel metadata
5. Return formatted_results
```

### MongoDB Vector Search Query Structure

When using MongoDB's vector search capability, the query should use the aggregation pipeline:

```
db.hotel_data.aggregate([
  {
    "$search": {
      "vectorSearch": {
        "queryVector": [/* embedding array */],
        "path": "contentVector",
        "numCandidates": k * 10,  // Oversampling factor
        "limit": k,
        "similarity": "cosine"
      }
    }
  },
  {
    "$project": {
      "score": { "$meta": "searchScore" },
      "document": "$$ROOT"
    }
  }
])
```

### Result Format

Each search result must include:
- All hotel metadata fields (see Data Model)
- Similarity score (0-1 for cosine, varies by metric)

---

## Agent Pipeline Specification

This section is covered in detail in the separate **AGENT-ORCHESTRATION.md** document.

**Key Concepts**:
- Two-agent architecture (Planner + Synthesizer)
- Tool calling / function calling
- System prompts and user prompts
- Context passing between agents

See **AGENT-ORCHESTRATION.md** for implementation details.

---

## Environment Configuration

### Required Environment Variables

**Authentication Mode**:
- `USE_PASSWORDLESS`: `"true"` or `"false"` (default: false)

**Azure OpenAI**:
- `AZURE_OPENAI_API_INSTANCE_NAME`: Instance name
- `AZURE_OPENAI_API_KEY`: API key (if not passwordless)
- `AZURE_OPENAI_EMBEDDING_DEPLOYMENT`: Deployment name for embeddings
- `AZURE_OPENAI_EMBEDDING_API_VERSION`: API version
- `AZURE_OPENAI_PLANNER_DEPLOYMENT`: Deployment name for planner
- `AZURE_OPENAI_PLANNER_API_VERSION`: API version
- `AZURE_OPENAI_SYNTH_DEPLOYMENT`: Deployment name for synthesizer
- `AZURE_OPENAI_SYNTH_API_VERSION`: API version

**Cosmos DB MongoDB**:
- `MONGO_CLUSTER_NAME`: Cluster name (for passwordless)
- `MONGO_CONNECTION_STRING`: Full connection string (if not passwordless)
- `MONGO_DB_NAME`: Database name (e.g., `hotels`)
- `MONGO_DB_COLLECTION`: Collection name (e.g., `hotel_data`)

**Application Settings**:
- `DATA_FILE_WITHOUT_VECTORS`: Path to hotel JSON file
- `QUERY`: Default search query (optional)
- `NEAREST_NEIGHBORS`: Default k value (optional, default: 5)
- `DEBUG`: Enable debug logging (`"true"` or `"false"`)

**Vector Index Configuration** (optional):
- `VECTOR_INDEX_ALGORITHM`: `"vector-ivf"` | `"vector-hnsw"` | `"vector-diskann"`
- `VECTOR_SIMILARITY`: `"COS"` | `"L2"` | `"IP"`
- `EMBEDDING_DIMENSIONS`: Number (default: 1536)
- `IVF_NUM_LISTS`: Number (default: 10)
- `HNSW_M`: Number (default: 16)
- `HNSW_EF_CONSTRUCTION`: Number (default: 64)

---

## Implementation Checklist

To implement this system in any language/framework:

- [ ] Azure resource provisioning (OpenAI + Cosmos DB + Managed Identity)
- [ ] Authentication implementation (passwordless + API key modes)
- [ ] MongoDB client with vector search capability
- [ ] Embedding generation client
- [ ] Chat completion client (with tool/function calling support)
- [ ] Data upload workflow with vector index creation
- [ ] Vector search tool implementation
- [ ] Two-agent pipeline orchestration
- [ ] Environment configuration management
- [ ] Authentication test suite
- [ ] Error handling and logging

---

## Next Steps

1. Read **AGENT-ORCHESTRATION.md** for detailed agent implementation patterns
2. Review the TypeScript implementation in `src/` as a reference
3. Adapt the workflows and specifications to your language/framework
4. Test authentication before implementing the full pipeline
5. Start with data upload, then search, then agent orchestration

---

## Additional Resources

- **CODE.md**: Language-specific implementation details (TypeScript/LangChain)
- **AGENT-ORCHESTRATION.md**: Framework-agnostic agent patterns
- **SCRIPTS.md**: Verification and testing procedures
- **azure-architecture.mmd**: Infrastructure diagram
