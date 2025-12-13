# Source Code Overview

This document provides a comprehensive guide to the TypeScript source code in this LangChain agent application. Each section describes the purpose and functionality of the files, organized by their role in the application.

## Table of Contents

- [NPM Scripts and Entry Points](#npm-scripts-and-entry-points)
  - [agent.ts - Main Application (`npm run start`)](#agentts---main-application-npm-run-start)
  - [upload-documents.ts - Data Upload (`npm run upload`)](#upload-documentsts---data-upload-npm-run-upload)
  - [cleanup.ts - Database Cleanup (`npm run cleanup`)](#cleanupts---database-cleanup-npm-run-cleanup)
  - [scripts/test-auth.ts - Authentication Testing (`npm run auth`)](#scriptstest-authts---authentication-testing-npm-run-auth)
- [Verification Scripts](#verification-scripts)
  - [scripts/embed.ts](#scriptsembedts)
  - [scripts/llm-planner.ts](#scriptsllm-plannerts)
  - [scripts/llm-synth.ts](#scriptsllm-synthts)
  - [scripts/mongo.ts](#scriptsmongots)
- [Core Application Files](#core-application-files)
  - [vector-store.ts - Vector Store Management](#vector-storets---vector-store-management)
- [Utility Files](#utility-files)
  - [utils/clients.ts](#utilsclientsts)
  - [utils/prompts.ts](#utilspromptststs)
  - [utils/types.ts](#utilstypests)
  - [utils/debug-handlers.ts](#utilsdebug-handlersts)
  - [utils/mongo.ts](#utilsmongots)

---

## NPM Scripts and Entry Points

These are the main executable scripts that can be run via `npm run <script-name>`. Each compiles the TypeScript code and executes a specific entry point.

### agent.ts - Main Application (`npm run start`)

**Purpose**: The main LangChain agent application that implements a two-agent RAG (Retrieval-Augmented Generation) pipeline.

**Command**: `npm run start`

**What it does**:
1. **Planner Agent**: Takes user query → calls vector search tool → retrieves relevant hotel documents from Cosmos DB
2. **Synthesizer Agent**: Takes search results + original query → generates natural language response

**Key features**:
- Implements a two-model architecture:
  - Planner: Uses `gpt-4o-mini` for query planning and tool calling
  - Synthesizer: Uses `gpt-4o` for response generation
- Uses vector similarity search to find relevant hotels
- Supports both passwordless (Azure AD) and API key authentication
- Includes debug handlers for troubleshooting agent behavior

**Flow**:
```
User Query → Planner Agent → Vector Search Tool → Search Results → Synthesizer Agent → Final Response
```

**How it differs from vector-store.ts**: 
- `agent.ts` is the **orchestrator** - it runs the full agent pipeline
- `vector-store.ts` is a **library module** - it provides the vector store functions and tool definitions that `agent.ts` imports and uses

### upload-documents.ts - Data Upload (`npm run upload`)

**Purpose**: One-time script to upload hotel documents from JSON file to Azure Cosmos DB and create vector embeddings.

**Command**: `npm run upload`

**What it does**:
1. Reads hotel data from `data/HotelsData_toCosmosDB.JSON`
2. Connects to Azure OpenAI to generate embeddings
3. Connects to Cosmos DB MongoDB vCore
4. Creates vector index (IVF, HNSW, or DiskANN based on environment config)
5. Uploads documents with embedded vectors

**When to use**: Run this once after provisioning Azure resources and before running the agent for the first time.

**Environment variables used**:
- `DATA_FILE_WITHOUT_VECTORS`: Path to source JSON file
- `MONGO_DB_NAME`, `MONGO_DB_COLLECTION`: Target database and collection
- `AZURE_OPENAI_EMBEDDING_DEPLOYMENT`: Embedding model deployment name
- `VECTOR_INDEX_ALGORITHM`: Which vector index to create (ivf/hnsw/diskann)

### cleanup.ts - Database Cleanup (`npm run cleanup`)

**Purpose**: Deletes the entire MongoDB database to clean up resources.

**Command**: `npm run cleanup`

**What it does**:
1. Connects to Cosmos DB using passwordless OIDC authentication
2. Drops the specified database (defaults to `MONGO_DB_NAME` env var)
3. Closes the connection

**When to use**: 
- Before re-uploading documents with different configuration
- When tearing down the demo environment
- To reset the database to a clean state

**Note**: This is a destructive operation - it deletes all data in the database.

### scripts/test-auth.ts - Authentication Testing (`npm run auth`)

**Purpose**: Comprehensive test suite that validates authentication to all four Azure services.

**Command**: `npm run auth`

**What it does**:
1. Tests Azure OpenAI Embeddings API connection
2. Tests Azure OpenAI Chat API (Planner model)
3. Tests Azure OpenAI Chat API (Synthesizer model)
4. Tests Cosmos DB MongoDB connection with OIDC

**Key feature**: Imports and reuses test functions from individual verification scripts (embed.ts, llm-planner.ts, llm-synth.ts, mongo.ts) rather than duplicating authentication code.

**Output**: Clear pass/fail status for each service with summary report.

**When to use**: 
- After running `azd up` to verify all services are accessible
- When troubleshooting authentication issues
- Before running the main agent application

---

## Verification Scripts

These scripts in the `scripts/` folder are individual test utilities that can be imported and run independently. They are used by `test-auth.ts` but can also be run directly for targeted testing.

### scripts/embed.ts

**Purpose**: Verify Azure OpenAI Embeddings API authentication and connectivity.

**What it does**:
- Creates `AzureOpenAIEmbeddings` client with passwordless authentication
- Generates test embeddings for sample strings ("Hello world", "Bonjour le monde")
- Logs the resulting vector dimensions

**Export**: `testEmbeddings()` function

### scripts/llm-planner.ts

**Purpose**: Verify Azure OpenAI Chat API (Planner model) authentication and connectivity.

**What it does**:
- Creates `AzureChatOpenAI` client for the planner deployment (gpt-4o-mini)
- Sends test message ("Hi there!")
- Logs the response

**Export**: `testPlanner()` function

### scripts/llm-synth.ts

**Purpose**: Verify Azure OpenAI Chat API (Synthesizer model) authentication and connectivity.

**What it does**:
- Creates `AzureChatOpenAI` client for the synth deployment (gpt-4o)
- Sends test message ("Hi there!")
- Logs the response

**Export**: `testSynth()` function

### scripts/mongo.ts

**Purpose**: Verify Cosmos DB MongoDB connection with OIDC passwordless authentication.

**What it does**:
- Creates `MongoClient` with MONGODB-OIDC authentication mechanism
- Uses `DefaultAzureCredential` for token acquisition
- Connects to cluster and lists databases
- Closes connection

**Export**: `testMongoConnection()` function

---

## Core Application Files

### vector-store.ts - Vector Store Management

**Purpose**: Central module for managing Azure Cosmos DB MongoDB Vector Store operations and defining the vector search tool.

**What it provides**:

1. **Vector Store Creation Functions**:
   - `getStore()`: Creates vector store AND uploads documents from JSON file (used by upload-documents.ts)
   - `getExistingStore()`: Connects to existing vector store WITHOUT uploading (used by agent.ts)

2. **Vector Search Tool**:
   - `getHotelsToMatchSearchQuery`: LangChain tool definition for vector similarity search
   - Used by the Planner agent to search the hotel collection
   - Accepts: `query` (string) and `nearestNeighbors` (number)
   - Returns: JSON array of matching hotels with scores

3. **Configuration Management**:
   - Vector index configuration (IVF, HNSW, DiskANN)
   - Similarity type selection (cosine, L2, inner product)
   - Embedding dimensions and model settings

4. **Helper Functions**:
   - `extractPlannerToolOutput()`: Parses agent messages to extract tool call results
   - Index creation and management
   - Document transformation and filtering

**How it differs from agent.ts**:
- **vector-store.ts**: Library/module that provides reusable functions and tool definitions
- **agent.ts**: Application entry point that imports and orchestrates these functions

Think of it this way:
- `vector-store.ts` = The toolbox 🧰
- `agent.ts` = The craftsman using the tools 👷

---

## Utility Files

Shared utilities used across multiple parts of the application.

### utils/clients.ts

**Purpose**: Factory functions for creating Azure OpenAI and MongoDB clients with dual authentication support.

**What it provides**:

1. **Passwordless Authentication** (`createClientsPasswordless()`):
   - Uses `DefaultAzureCredential` from Azure Identity
   - OpenAI: Uses `getBearerTokenProvider` with scope `https://cognitiveservices.azure.com/.default`
   - MongoDB: Uses MONGODB-OIDC with scope `https://ossrdbms-aad.database.windows.net/.default`

2. **API Key Authentication** (`createClients()`):
   - Uses `AZURE_OPENAI_API_KEY` environment variable
   - Traditional connection string for MongoDB

**Returns**: Object with:
- `embeddingClient`: AzureOpenAIEmbeddings instance
- `plannerClient`: AzureChatOpenAI instance (gpt-4o-mini)
- `synthClient`: AzureChatOpenAI instance (gpt-4o)
- `mongoClient`: MongoClient instance
- `dbConfig`: Database configuration object

**Used by**: agent.ts, upload-documents.ts, all verification scripts

### utils/prompts.ts

**Purpose**: Centralized storage for all LLM system and user prompts.

**What it defines**:

1. **Tool Definition**:
   - `TOOL_NAME`: Name of the vector search tool
   - `TOOL_DESCRIPTION`: Detailed description for the LLM explaining how to use the tool

2. **Planner Prompts**:
   - `PLANNER_SYSTEM_PROMPT`: Instructions for the planner agent
   - Defines how to refine queries and when to call tools
   - Includes JSON response format requirements

3. **Synthesizer Prompts**:
   - `SYNTHESIZER_SYSTEM_PROMPT`: Instructions for the synthesizer agent
   - Defines how to generate user-friendly responses from search results
   - `createSynthesizerUserPrompt()`: Function to construct user messages with context

4. **Default Query**:
   - `DEFAULT_QUERY`: Default search query if none provided

**Why centralized**: Makes it easy to tune agent behavior by updating prompts in one place rather than scattered throughout the code.

### utils/types.ts

**Purpose**: TypeScript type definitions and interfaces for data structures.

**What it defines**:

1. **Hotel Interface**: Complete hotel document structure including:
   - Basic info (ID, name, description, category, tags)
   - Ratings and status
   - Address (street, city, state, postal code, country)
   - Location (GeoJSON Point with coordinates)
   - Rooms array

2. **HotelSearchResult Interface**: Simplified hotel structure returned from vector search:
   - Excludes French description, location coordinates, and rooms
   - Adds `Score` field for similarity ranking

3. **Room Interface**: Room details structure

4. **HotelsData Interface**: Type for the source JSON file structure

**Used by**: vector-store.ts, agent.ts, and any file working with hotel data

### utils/debug-handlers.ts

**Purpose**: LangChain callback handlers for debugging agent execution.

**What it provides**:

**`DEBUG_CALLBACKS` array** with handlers for:
- `handleLLMStart`: Logs when LLM generation begins
- `handleLLMNewToken`: Streams tokens as they're generated (real-time output)
- `handleLLMEnd`: Logs completion and tool call metadata
- `handleLLMError`: Logs LLM errors
- `handleAgentAction`: Logs agent decisions and tool selections
- `handleAgentEnd`: Logs final agent output
- `handleToolStart`: Logs tool execution start
- `handleToolEnd`: Logs tool results
- `handleToolError`: Logs tool errors

**When used**: Passed to agent invocation when `DEBUG=true` in environment variables

**Why useful**: 
- See exactly what the LLM is deciding
- Debug tool calling issues
- Understand agent reasoning flow
- Troubleshoot unexpected behavior

### utils/mongo.ts

**Purpose**: MongoDB utility functions using passwordless OIDC authentication.

**What it provides**:

1. **`azureIdentityTokenCallback()`**: OIDC token callback function
   - Uses `DefaultAzureCredential` to get access token
   - Returns token and expiration for MongoDB driver
   - Scope: `https://ossrdbms-aad.database.windows.net/.default`

2. **`deleteCosmosMongoDatabase()`**: Database deletion function
   - Creates MongoDB client with OIDC auth
   - Connects to cluster
   - Drops specified database
   - Closes connection

**Authentication**: Always uses passwordless OIDC (no API keys)

**Used by**: cleanup.ts (imports and calls `deleteCosmosMongoDatabase()`)

---

## Summary

### Entry Points (Run via NPM scripts):
- **agent.ts**: Main application - runs the two-agent RAG pipeline
- **upload-documents.ts**: One-time data upload with vector embeddings
- **cleanup.ts**: Database cleanup and teardown
- **scripts/test-auth.ts**: Comprehensive authentication test suite

### Verification Scripts (Imported by test-auth.ts):
- **scripts/embed.ts**, **llm-planner.ts**, **llm-synth.ts**, **mongo.ts**: Individual service tests

### Core Library:
- **vector-store.ts**: Vector store management and tool definitions (the toolbox)

### Utilities:
- **utils/clients.ts**: Client factory functions with dual auth support
- **utils/prompts.ts**: Centralized LLM prompts
- **utils/types.ts**: TypeScript type definitions
- **utils/debug-handlers.ts**: Debug callbacks for agent troubleshooting
- **utils/mongo.ts**: MongoDB utility functions with OIDC auth

### Key Distinction:
- **agent.ts** = Orchestrator that runs the agent pipeline
- **vector-store.ts** = Library module that provides functions and tools
- Think: agent.ts uses vector-store.ts (not the other way around)
