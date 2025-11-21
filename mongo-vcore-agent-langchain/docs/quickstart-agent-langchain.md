---
title: Quickstart - LangChain Agent with Vector Search in Node.js
description: Learn how to build an AI agent using LangChain with vector search in Azure DocumentDB with Node.js. Create intelligent hotel recommendation agents that use semantic search.
author: diberry
ms.author: diberry
ms.reviewer: khelan
ms.date: 11/21/2025
ms.devlang: typescript
ms.topic: quickstart-sdk
ms.custom:
  - devx-track-ts
  - devx-track-ts-ai
# CustomerIntent: As a developer, I want to learn how to build AI agents with LangChain and vector search in Node.js applications with Azure DocumentDB.
---

# Quickstart: LangChain Agent with vector search in Azure DocumentDB

Build an intelligent AI agent using LangChain with the Azure DocumentDB Node.js client library. This agent uses vector search to find relevant hotels and provides personalized recommendations.

This quickstart demonstrates a two-agent architecture:
- **Planner Agent** (`gpt-4o-mini`, 30K tokens/min recommended): Transforms user queries and executes vector search using a custom tool
- **Synthesizer Agent** (`gpt-4o`, 50K tokens/min recommended): Analyzes search results and provides comparative recommendations

The sample uses a hotel dataset in JSON format. The planner agent creates embeddings on-the-fly using the `text-embedding-3-small` model, performs vector similarity search, and the synthesizer agent generates natural language recommendations.

Find the [sample code](https://github.com/Azure-Samples/cosmos-db-vector-samples/tree/main/mongo-vcore-agent-langchain) on GitHub.

## Prerequisites

[!INCLUDE[Prerequisites - Vector Search Quickstart](includes/prerequisite-quickstart-vector-search.md)]

- [Node.js LTS](https://nodejs.org/download/)
- [TypeScript](https://www.typescriptlang.org/download): Install TypeScript globally:

    ```bash
    npm install -g typescript
    ```

## Create a Node.js project

1. Create a new directory for your project and open it in Visual Studio Code:

    ```bash
    mkdir agent-vector-search
    cd agent-vector-search
    code .
    ```

1. In the terminal, initialize a Node.js project:

    ```bash
    npm init -y
    npm pkg set type="module"
    ```

1. Install the required packages:

    ```bash
    npm install @langchain/azure-cosmosdb @langchain/openai @langchain/core langchain zod @types/node
    ```

    - `@langchain/azure-cosmosdb`: LangChain integration for Azure Cosmos DB vector store
    - `@langchain/openai`: LangChain integration for Azure OpenAI
    - `@langchain/core`: Core LangChain functionality
    - `langchain`: Main LangChain library with agent framework
    - `zod`: Schema validation for tool parameters
    - `@types/node`: Type definitions for Node.js

1. Create a `.env` file in your project root for environment variables:

    ```ini
    DEBUG=false
    USE_PASSWORDLESS=false

    # Azure OpenAI Shared Settings
    AZURE_OPENAI_API_KEY="<your-azure-openai-api-key>"
    AZURE_OPENAI_ENDPOINT="https://<your-resource-name>.openai.azure.com/"
    AZURE_OPENAI_API_INSTANCE_NAME="<your-resource-name>"

    # Synthesizer Model (generates final recommendations)
    AZURE_OPENAI_SYNTH_API_VERSION="2025-01-01-preview"
    AZURE_OPENAI_SYNTH_DEPLOYMENT="gpt-4o"

    # Planner Model (handles tool calls and search)
    AZURE_OPENAI_PLANNER_DEPLOYMENT="gpt-4o-mini"
    AZURE_OPENAI_PLANNER_API_VERSION="2025-01-01-preview"

    # Azure OpenAI Embedding Model Settings
    AZURE_OPENAI_EMBEDDING_DEPLOYMENT="text-embedding-3-small"
    AZURE_OPENAI_EMBEDDING_API_VERSION="2023-05-15"

    FIELD_TO_EMBED="Description"
    EMBEDDED_FIELD="vectors"
    EMBEDDING_DIMENSIONS="1536"
    EMBEDDING_BATCH_SIZE="16"

    # Data File Paths and Vector Configuration
    DATA_FILE_WITHOUT_VECTORS="../data/HotelsData_toCosmosDB.JSON"
    QUERY="quintessential lodging near running trails, eateries, retail"

    # Data Loading and Processing Settings
    LOAD_SIZE_BATCH="100"

    # MongoDB/Cosmos DB Connection Settings
    AZURE_COSMOSDB_MONGODB_CONNECTION_STRING="<your-cosmos-db-connection-string>"
    MONGO_CLUSTER_NAME="<your-cluster-name>"
    MONGO_DB_NAME="Hotels"
    MONGO_DB_COLLECTION="Hotels_ivf"
    MONGO_DB_INDEX_NAME="vectorIndex_ivf"

    # Vector Index Algorithm: vector-ivf (default), vector-hnsw, or vector-diskann
    VECTOR_INDEX_ALGORITHM="vector-ivf"
    VECTOR_SEARCH_STRATEGY="documentdb"  # or mongo or auto

    # Vector Index Parameters
    VECTOR_SIMILARITY="COS"  # Options: COS (cosine), L2 (euclidean), IP (inner product)
    IVF_NUM_LISTS="10"  # Number of clusters for IVF index

    # Agent Search Configuration
    MAX_SEARCH_RESULTS="5"
    SIMILARITY_THRESHOLD="0.7"

    # Optional Settings
    LANGSMITH_TRACING="false"
    LANGSMITH_ENDPOINT="https://api.smith.langchain.com"
    LANGSMITH_API_KEY=""
    LANGSMITH_PROJECT=""
    ```

    Replace the placeholder values in the `.env` file with your own information:
    - `AZURE_OPENAI_API_KEY`: Your Azure OpenAI API key
    - `AZURE_OPENAI_ENDPOINT`: Your Azure OpenAI resource endpoint URL
    - `AZURE_OPENAI_API_INSTANCE_NAME`: Your Azure OpenAI resource name
    - `AZURE_COSMOSDB_MONGODB_CONNECTION_STRING`: Your Azure Cosmos DB connection string
    - `MONGO_CLUSTER_NAME`: Your Cosmos DB cluster name

1. Add a `tsconfig.json` file to configure TypeScript:

    ```json
    {
      "compilerOptions": {
        "target": "ES2022",
        "module": "ES2022",
        "lib": ["ES2022"],
        "moduleResolution": "node",
        "outDir": "./dist",
        "rootDir": "./src",
        "strict": true,
        "esModuleInterop": true,
        "skipLibCheck": true,
        "forceConsistentCasingInFileNames": true,
        "resolveJsonModule": true,
        "allowSyntheticDefaultImports": true
      },
      "include": ["src/**/*"],
      "exclude": ["node_modules"]
    }
    ```

1. Copy the `HotelsData_toCosmosDB.JSON` [raw data file](https://raw.githubusercontent.com/Azure-Samples/cosmos-db-vector-samples/refs/heads/main/data/HotelsData_toCosmosDB.JSON) to a `data` directory in the parent folder.

## Create npm scripts

Edit the `package.json` file and add these scripts:

```json
"scripts": {
  "build": "tsc",
  "start": "npm run build && node --env-file .env dist/agent.js"
}
```

## Create the project structure

Create the source directory structure for your TypeScript files:

```bash
mkdir -p src/utils
```

Create the following files:

```bash
touch src/agent.ts
touch src/utils/prompts.ts
touch src/utils/clients.ts
touch src/utils/types.ts
touch src/utils/azure-documentdb.ts
touch src/utils/mongodb-cleanup.ts
touch src/utils/tool-results-extraction.ts
touch src/utils/debug-handlers.ts
```

## Create type definitions

Paste the following code into `src/utils/types.ts`:

```typescript
export interface HotelData {
  HotelId?: string;
  HotelName?: string;
  Description?: string;
  Category?: string;
  Tags?: string[];
  ParkingIncluded?: boolean;
  IsDeleted?: boolean;
  LastRenovationDate?: string;
  Rating?: number;
  Address?: {
    StreetAddress?: string;
    City?: string;
    StateProvince?: string;
    PostalCode?: string;
    Country?: string;
  };
  Score?: number;
}

export interface JsonData {
  [key: string]: unknown;
}
```

## Create client configuration

Paste the following code into `src/utils/clients.ts`:

```typescript
import { AzureChatOpenAI, AzureOpenAIEmbeddings } from "@langchain/openai";

export interface ClientConfig {
  embeddingClient: AzureOpenAIEmbeddings;
  plannerClient: AzureChatOpenAI;
  synthClient: AzureChatOpenAI;
  dbConfig: {
    connectionString: string;
    databaseName: string;
    collectionName: string;
    indexName: string;
    embeddingKey: string;
    textKey: string;
    vectorSearchStrategy: string;
    clusterName: string;
  };
}

export function createClients(): ClientConfig {
  const embeddingClient = new AzureOpenAIEmbeddings({
    azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
    azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
    azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
    azureOpenAIApiVersion: process.env.AZURE_OPENAI_EMBEDDING_API_VERSION,
  });

  const plannerClient = new AzureChatOpenAI({
    azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
    azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
    azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_PLANNER_DEPLOYMENT,
    azureOpenAIApiVersion: process.env.AZURE_OPENAI_PLANNER_API_VERSION,
    temperature: 0,
  });

  const synthClient = new AzureChatOpenAI({
    azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
    azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
    azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_SYNTH_DEPLOYMENT,
    azureOpenAIApiVersion: process.env.AZURE_OPENAI_SYNTH_API_VERSION,
    temperature: 0.3,
  });

  return {
    embeddingClient,
    plannerClient,
    synthClient,
    dbConfig: {
      connectionString: process.env.AZURE_COSMOSDB_MONGODB_CONNECTION_STRING!,
      databaseName: process.env.MONGO_DB_NAME!,
      collectionName: process.env.MONGO_DB_COLLECTION!,
      indexName: process.env.MONGO_DB_INDEX_NAME!,
      embeddingKey: process.env.EMBEDDED_FIELD!,
      textKey: process.env.FIELD_TO_EMBED!,
      vectorSearchStrategy: process.env.VECTOR_SEARCH_STRATEGY!,
      clusterName: process.env.MONGO_CLUSTER_NAME!,
    },
  };
}

export function createClientsPasswordless(): ClientConfig {
  // Passwordless authentication using Azure Identity
  // Note: Requires RBAC roles configured on both Azure OpenAI and Cosmos DB
  throw new Error("Passwordless authentication not yet implemented");
}
```

## Create prompt templates

Paste the following code into `src/utils/prompts.ts`:

```typescript
export const TOOL_NAME = "search_hotels_collection";

export const TOOL_DESCRIPTION = `REQUIRED TOOL - You MUST call this tool for EVERY hotel search request. This is the ONLY way to search the hotel database.

Performs vector similarity search on the Hotels collection using Azure Cosmos DB for MongoDB vCore.

INPUT REQUIREMENTS:
- query (string, REQUIRED): Natural language search query describing desired hotel characteristics. Should be detailed and specific (e.g., "budget hotel near downtown with parking and wifi" not just "hotel").
- nearestNeighbors (number, REQUIRED): Number of results to return (1-20). Use 3-5 for specific requests, 10-15 for broader searches.

SEARCH BEHAVIOR:
- Uses semantic vector search to find hotels matching the query description
- Returns hotels ranked by similarity score
- Includes hotel details: name, description, category, tags, rating, location, parking info

MANDATORY: Every user request about finding, searching, or recommending hotels REQUIRES calling this tool. Do not attempt to answer without calling this tool first.`;

export const PLANNER_SYSTEM_PROMPT = `You are a hotel search planner. Transform the user's request into a clear, detailed search query for a vector database.

CRITICAL REQUIREMENT: You MUST ALWAYS call the "search_hotels_collection" tool. This is MANDATORY for every request.

Your response must be ONLY this JSON structure:
{"tool": "search_hotels_collection", "args": {"query": "<refined query>", "nearestNeighbors": <1-20>}}

QUERY REFINEMENT RULES:
- If vague (e.g., "nice hotel"), add specific attributes: "hotel with high ratings and good amenities"
- If minimal (e.g., "cheap"), expand: "budget hotel with good value"
- Preserve specific details from user (location, amenities, business/leisure)
- Keep natural language - this is for semantic search
- Don't just echo the input - improve it for better search results
- nearestNeighbors: Use 3-5 for specific requests, 10-15 for broader requests, max 20

EXAMPLES:
User: "cheap hotel" → {"tool": "search_hotels_collection", "args": {"query": "budget-friendly hotel with good value and affordable rates", "nearestNeighbors": 10}}
User: "hotel near downtown with parking" → {"tool": "search_hotels_collection", "args": {"query": "hotel near downtown with good parking and wifi", "nearestNeighbors": 5}}
User: "nice place to stay" → {"tool": "search_hotels_collection", "args": {"query": "hotel with high ratings, good reviews, and quality amenities", "nearestNeighbors": 10}}

DO NOT return any other format. ALWAYS include the tool and args structure.`;

export const SYNTHESIZER_SYSTEM_PROMPT = `You are an expert hotel recommendation assistant using vector search results.
Only use the TOP 3 results provided. Do not request additional searches or call other tools.

GOAL: Provide a concise comparative recommendation to help the user choose between the top 3 options.

REQUIREMENTS:
- Compare only the top 3 results across the most important attributes: rating, score, location, price-level (if available), and key tags (parking, wifi, pool).
- Identify the main tradeoffs in one short sentence per tradeoff.
- Give a single clear recommendation with one short justification sentence.
- Provide up to two alternative picks (one sentence each) explaining when they are preferable.

FORMAT CONSTRAINTS:
- Plain text only (no markdown).
- Keep the entire response under 220 words.
- Use simple bullets (•) or numbered lists and short sentences (preferably <25 words per sentence).
- Preserve hotel names exactly as provided in the tool summary.

Do not add extra commentary, marketing language, or follow-up questions. If information is missing and necessary to choose, state it in one sentence and still provide the best recommendation based on available data.`;

export function createSynthesizerUserPrompt(
  userQuery: string,
  toolSummary: string
): string {
  return `User asked: ${userQuery}

Tool summary:
${toolSummary}

Analyze the TOP 3 results by COMPARING them across all attributes (rating, score, tags, parking, location, category, rooms).

Structure your response:
1. COMPARISON SUMMARY: Compare the top 3 options highlighting key differences and tradeoffs
2. BEST OVERALL: Recommend the single best option with clear reasoning
3. ALTERNATIVE PICKS: Briefly explain when the other options might be preferred (e.g., "Choose X if budget is priority" or "Choose Y if location matters most")

Your goal is to help the user DECIDE between the options, not just describe them.

Format your response using plain text (NO markdown formatting like ** or ###). Use simple numbered lists, bullet points (•), and use the exact hotel names from the tool summary (preserve original capitalization).`;
}
```

## Create DocumentDB utilities

Paste the following code into `src/utils/azure-documentdb.ts`:

```typescript
import { AzureCosmosDBMongoDBVectorStore } from "@langchain/azure-cosmosdb";
import { AzureOpenAIEmbeddings } from "@langchain/openai";
import { readFileSync } from "fs";
import { JsonData } from "./types.js";

export async function getStore(
  dataFilePath: string,
  embeddingClient: AzureOpenAIEmbeddings,
  dbConfig: {
    connectionString: string;
    databaseName: string;
    collectionName: string;
    indexName: string;
    embeddingKey: string;
    textKey: string;
    vectorSearchStrategy: string;
  }
): Promise<AzureCosmosDBMongoDBVectorStore> {
  
  // Read and parse data file
  const rawData = readFileSync(dataFilePath, "utf-8");
  const data = JSON.parse(rawData) as JsonData[];
  console.log(`Loaded ${data.length} documents from ${dataFilePath}`);

  // Create documents for vector store
  const documents = data.map((doc) => ({
    pageContent: doc[dbConfig.textKey] as string,
    metadata: doc,
  }));

  // Initialize vector store with automatic embedding generation
  const store = await AzureCosmosDBMongoDBVectorStore.fromDocuments(
    documents,
    embeddingClient,
    {
      connectionString: dbConfig.connectionString,
      databaseName: dbConfig.databaseName,
      collectionName: dbConfig.collectionName,
      indexName: dbConfig.indexName,
      embeddingKey: dbConfig.embeddingKey,
      textKey: dbConfig.textKey,
      vectorSearchStrategy: dbConfig.vectorSearchStrategy as any,
    }
  );

  console.log(`Vector store initialized with ${documents.length} documents`);
  return store;
}
```

## Create cleanup utilities

Paste the following code into `src/utils/mongodb-cleanup.ts`:

```typescript
import { MongoClient } from "mongodb";

export async function deleteCosmosMongoDatabase(): Promise<void> {
  const connectionString = process.env.AZURE_COSMOSDB_MONGODB_CONNECTION_STRING;
  const databaseName = process.env.MONGO_DB_NAME;

  if (!connectionString || !databaseName) {
    console.log("Skipping database cleanup - connection details not provided");
    return;
  }

  const client = new MongoClient(connectionString);

  try {
    await client.connect();
    console.log("Connected to MongoDB for cleanup");

    await client.db(databaseName).dropDatabase();
    console.log(`Deleted database: ${databaseName}`);
  } catch (error) {
    console.error("Error during cleanup:", error);
  } finally {
    await client.close();
    console.log("MongoDB connection closed");
  }
}
```

## Create tool result extraction

Paste the following code into `src/utils/tool-results-extraction.ts`:

```typescript
import { BaseMessage } from "@langchain/core/messages";

export function extractPlannerToolOutput(
  messages: BaseMessage[],
  nearestNeighbors: number
): string {
  // Find the tool message in the agent's message history
  const toolMessage = messages.find((msg) => msg.name === "search_hotels_collection");

  if (!toolMessage) {
    console.warn(`No tool message found for search_hotels_collection`);
    return "No search results available.";
  }

  const content = toolMessage.content as string;
  console.log(`Extracted ${nearestNeighbors} results from tool output`);
  return content;
}
```

## Create debug handlers

Paste the following code into `src/utils/debug-handlers.ts`:

```typescript
export const DEBUG_CALLBACKS = process.env.DEBUG === "true" ? [
  {
    handleLLMStart: (llm: any, prompts: string[]) => {
      console.log("LLM Start:", JSON.stringify(prompts, null, 2));
    },
    handleLLMEnd: (output: any) => {
      console.log("LLM End:", JSON.stringify(output, null, 2));
    },
    handleChainStart: (chain: any) => {
      console.log("Chain Start:", chain);
    },
    handleChainEnd: (outputs: any) => {
      console.log("Chain End:", outputs);
    },
  },
] : [];
```

## Create the main agent code

Paste the following code into `src/agent.ts`:

```typescript
import { AzureCosmosDBMongoDBVectorStore } from "@langchain/azure-cosmosdb";
import { AzureOpenAIEmbeddings } from "@langchain/openai";
import {
  TOOL_NAME,
  TOOL_DESCRIPTION,
  PLANNER_SYSTEM_PROMPT,
  SYNTHESIZER_SYSTEM_PROMPT,
  createSynthesizerUserPrompt,
} from "./utils/prompts.js";
import { z } from "zod";
import { createAgent, tool } from "langchain";
import { createClientsPasswordless, createClients } from "./utils/clients.js";
import { DEBUG_CALLBACKS } from "./utils/debug-handlers.js";
import { extractPlannerToolOutput } from "./utils/tool-results-extraction.js";
import { deleteCosmosMongoDatabase } from "./utils/mongodb-cleanup.js";
import { getStore } from "./utils/azure-documentdb.js";

// Authentication
const clients =
  process.env.USE_PASSWORDLESS === "true" || process.env.USE_PASSWORDLESS === "1"
    ? createClientsPasswordless()
    : createClients();
const { embeddingClient, plannerClient, synthClient, dbConfig } = clients;

console.log(`DEBUG mode is ${process.env.DEBUG === "true" ? "ON" : "OFF"}`);

// Vector Search Tool
const getHotelsToMatchSearchQuery = tool(
  async ({ query, nearestNeighbors }, config): Promise<string> => {
    try {
      const store = config.context.store as AzureCosmosDBMongoDBVectorStore;
      const embeddingClient = config.context.embeddingClient as AzureOpenAIEmbeddings;

      // Create an embedding for the query
      const queryVector = await embeddingClient.embedQuery(query);

      // Perform similarity search
      const results = await store.similaritySearchVectorWithScore(
        queryVector,
        nearestNeighbors
      );
      console.log(`Found ${results.length} documents from vector store`);

      // Map results to hotel data
      const hotels = results.map(([doc, score]) => {
        const md = (doc.metadata || {}) as Record<string, any>;
        return {
          HotelId: md.HotelId,
          HotelName: md.HotelName,
          Description: md.Description,
          Category: md.Category,
          Tags: md.Tags || [],
          ParkingIncluded: md.ParkingIncluded,
          Rating: md.Rating,
          Address: md.Address,
          Score: score,
        };
      });

      // Format results for the synthesizer
      const formatted = hotels
        .map((h) => {
          const addr = (h.Address || {}) as Record<string, any>;
          const tags = Array.isArray(h.Tags) ? h.Tags.join(", ") : String(h.Tags || "");
          return [
            "--- HOTEL START ---",
            `HotelName: ${h.HotelName ?? "N/A"}`,
            `Description: ${h.Description ?? ""}`,
            `Category: ${h.Category ?? ""}`,
            `Tags: ${tags}`,
            `ParkingIncluded: ${h.ParkingIncluded === true}`,
            `Rating: ${h.Rating ?? ""}`,
            `Address.City: ${addr?.City ?? ""}`,
            `Address.StateProvince: ${addr?.StateProvince ?? ""}`,
            `Score: ${Number(h.Score ?? 0).toFixed(6)}`,
            "--- HOTEL END ---",
          ].join("\n");
        })
        .join("\n\n");

      return formatted;
    } catch (error) {
      console.error("Error in search tool:", error);
      return "Error occurred while searching for hotels.";
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

// Planner Agent
async function runPlannerAgent(
  userQuery: string,
  store: AzureCosmosDBMongoDBVectorStore,
  nearestNeighbors = 5
): Promise<string> {
  console.log("\n--- PLANNER ---");

  const userMessage = `Call the "${TOOL_NAME}" tool with nearestNeighbors="${nearestNeighbors}" and query="${userQuery}". Respond ONLY with a tool response JSON output`;

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
    { messages: [{ role: "user", content: userMessage }] },
    // @ts-ignore
    { context: { store, embeddingClient }, callbacks: DEBUG_CALLBACKS }
  );

  const plannerMessages = agentResult.messages || [];
  const searchResultsAsText = extractPlannerToolOutput(plannerMessages, nearestNeighbors);

  return searchResultsAsText;
}

// Synthesizer Agent
async function runSynthesizerAgent(
  userQuery: string,
  hotelContext: string
): Promise<string> {
  console.log("\n--- SYNTHESIZER ---");

  const agent = createAgent({
    model: synthClient,
    systemPrompt: SYNTHESIZER_SYSTEM_PROMPT,
  });

  const agentResult = await agent.invoke({
    messages: [
      {
        role: "user",
        content: createSynthesizerUserPrompt(userQuery, hotelContext),
      },
    ],
  });

  const synthMessages = agentResult.messages;
  const finalAnswer = synthMessages[synthMessages.length - 1].content;
  console.log(`Output: ${(finalAnswer as string).length} characters`);
  return finalAnswer as string;
}

// Main execution
const store = await getStore(
  process.env.DATA_FILE_WITHOUT_VECTORS!,
  embeddingClient,
  dbConfig
);

const query =
  process.env.QUERY || "quintessential lodging near running trails, eateries, retail";

// Run planner agent
const hotelContext = await runPlannerAgent(query, store, 5);
if (process.env.DEBUG === "true") console.log(hotelContext);

// Run synthesizer agent
const finalAnswer = await runSynthesizerAgent(query, hotelContext);

console.log("\n--- FINAL ANSWER ---");
console.log(finalAnswer);

// Cleanup
await store.close();
await deleteCosmosMongoDatabase();
```

This main module provides these features:

- Creates two specialized AI agents using LangChain's agent framework
- Defines a custom vector search tool with schema validation
- **Planner Agent**: Refines queries and executes the vector search tool
- **Synthesizer Agent**: Analyzes results and generates comparative recommendations
- Connects to Azure Cosmos DB for MongoDB vCore with vector search
- Creates embeddings on-the-fly for hotel descriptions
- Performs semantic similarity search and returns scored results
- Provides intelligent, context-aware hotel recommendations

## Authenticate with Azure CLI

Sign in to Azure CLI before you run the application so it can access Azure resources securely:

```bash
az login
```

## Build and run the application

Build the TypeScript files and run the agent:

```bash
npm run build
npm run start
```

The app logging and output shows:

- Data loading from the JSON file
- Vector store initialization with embeddings
- Planner agent execution with tool call
- Vector search results with similarity scores
- Synthesizer agent analysis
- Final comparative recommendation

```output
Loaded 50 documents from ../data/HotelsData_toCosmosDB.JSON
Vector store initialized with 50 documents

--- PLANNER ---
Found 5 documents from vector store
Extracted 5 results from tool output

--- SYNTHESIZER ---
Output: 215 characters

--- FINAL ANSWER ---
1. COMPARISON SUMMARY:
The top 3 hotels for lodging near trails, eateries, and retail are:
• Roach Motel (score: 0.8399) - highest match, near trails and restaurants
• Royal Cottage Resort (score: 0.8385) - close alternative with resort amenities
• Economy Universe Motel (score: 0.8360) - budget-friendly option

2. BEST OVERALL:
Roach Motel is the best match with the highest similarity score and optimal location near running trails and dining.

3. ALTERNATIVE PICKS:
• Choose Royal Cottage Resort if you prefer resort-style amenities
• Choose Economy Universe Motel if budget is the primary concern

Closing database connection...
Database connection closed
Deleted database: Hotels
```

## View and manage data in Visual Studio Code

1. Select the [DocumentDB extension](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-documentdb) in Visual Studio Code to connect to your Azure DocumentDB account.

1. View the data and indexes in the Hotels database (before cleanup).

## Understanding the two-agent architecture

This quickstart demonstrates a sophisticated two-agent pattern:

### Planner Agent (Tool Executor)

- Uses `gpt-4o-mini` for efficient tool execution
- Refines user queries for better semantic search
- Calls the vector search tool with optimized parameters
- Returns structured search results

### Synthesizer Agent (Recommendation Generator)

- Uses `gpt-4o` for high-quality natural language generation
- Analyzes top search results comparatively
- Identifies tradeoffs between options
- Provides actionable recommendations with alternatives

This architecture separates concerns:
- **Search optimization** (planner) from **result interpretation** (synthesizer)
- **Tool execution** from **content generation**
- **Data retrieval** from **decision support**

## Clean up resources

The application automatically deletes the test database after execution. Delete the resource group, DocumentDB account, and Azure OpenAI resource when you don't need them to avoid extra costs.

## Related content

- [Vector store in Azure DocumentDB](vector-search.md)
- [LangChain Azure Cosmos DB Integration](https://js.langchain.com/docs/integrations/vectorstores/azure_cosmosdb)
- [LangChain Agent Framework](https://js.langchain.com/docs/concepts/agents)
