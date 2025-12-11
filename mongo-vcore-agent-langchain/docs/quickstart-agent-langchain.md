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

Build an intelligent AI agent using LangChain and Azure DocumentDB (with MongoDB compatibility). This quickstart demonstrates a two-agent architecture that performs semantic hotel search and generates personalized recommendations.

**Architecture:**
- **Planner Agent** (`gpt-4o-mini`): Refines queries and executes vector search using a custom LangChain tool
- **Synthesizer Agent** (`gpt-4o`): Analyzes search results and provides comparative recommendations

The sample uses a hotel dataset with on-the-fly embedding generation via `text-embedding-3-small` and supports multiple vector index algorithms (IVF, HNSW, DiskANN).

Find the [complete source code](https://github.com/Azure-Samples/cosmos-db-vector-samples/tree/main/mongo-vcore-agent-langchain) on GitHub.

## Prerequisites

### Azure resources

- **Azure OpenAI resource** with the following model deployments in Microsoft Azure AI Foundry:
  - `gpt-4o` deployment (Synthesizer Agent)
    - Recommended: **50,000 tokens per minute (TPM)** capacity
    - Pricing: ~$2.50 per 1M input tokens, ~$10.00 per 1M output tokens
  - `gpt-4o-mini` deployment (Planner Agent)
    - Recommended: **30,000 tokens per minute (TPM)** capacity
    - Pricing: ~$0.15 per 1M input tokens, ~$0.60 per 1M output tokens
  - `text-embedding-3-small` deployment (Embeddings)
    - Recommended: **10,000 tokens per minute (TPM)** capacity
    - Pricing: ~$0.02 per 1M tokens
  - **Token quotas**: Configure sufficient TPM for each deployment to avoid rate limiting
    - See [Manage Azure OpenAI quotas](https://learn.microsoft.com/azure/ai-services/openai/how-to/quota) for quota management
    - If you encounter 429 errors, increase your TPM quota or reduce request frequency
  <!-- TODO: Add tabbed conceptual for passwordless authentication -->
  <!-- Tab 1: API Key (default) - current content above -->
  <!-- Tab 2: Passwordless (Microsoft Entra ID) -->
  <!-- - RBAC role required: Cognitive Services OpenAI User or Cognitive Services OpenAI Contributor -->
  <!-- - Assign role in Azure Portal: Azure OpenAI resource → Access control (IAM) → Add role assignment -->
  <!-- - See [Azure OpenAI RBAC roles](https://learn.microsoft.com/azure/ai-services/openai/how-to/role-based-access-control) -->

- **Azure DocumentDB (with MongoDB compatibility) cluster** with vector search support:
  - **Cluster tier requirements** based on vector index algorithm:
    - **IVF (Inverted File Index)**: M10 or higher (default algorithm)
    - **HNSW (Hierarchical Navigable Small World)**: M30 or higher (graph-based)
    - **DiskANN**: M30 or higher (optimized for large-scale)
  - **Firewall configuration**: REQUIRED - Add your client IP address to the cluster's firewall rules
    - Find your IP: `curl -4 ifconfig.me`
    - Configure in Azure Portal: DocumentDB cluster → Networking → Firewall
    - See [Configure firewall rules](https://learn.microsoft.com/azure/cosmos-db/mongodb/vcore/how-to-configure-firewall) for detailed instructions
    - Without proper firewall configuration, connection attempts will fail
  <!-- TODO: Add tabbed conceptual for passwordless authentication -->
  <!-- Tab 1: Connection String (default) - current content above -->
  <!-- Tab 2: Passwordless (Microsoft Entra ID) -->
  <!-- - RBAC role required: DocumentDB Account Contributor or custom role with read/write permissions -->
  <!-- - Assign role in Azure Portal: DocumentDB account → Access control (IAM) → Add role assignment -->
  <!-- - Configure Microsoft Entra authentication on cluster -->
  <!-- - See [DocumentDB RBAC](https://learn.microsoft.com/azure/cosmos-db/mongodb/vcore/security) -->

### Development tools

- [Node.js LTS](https://nodejs.org/download/)
- [TypeScript](https://www.typescriptlang.org/download): Install TypeScript globally:

    ```bash
    npm install -g typescript
    ```

- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) for authentication
  <!-- TODO: Add tabbed conceptual for authentication methods -->
  <!-- Tab 1: API Key / Connection String (default) - Azure CLI used for resource management only -->
  <!-- Tab 2: Passwordless (Microsoft Entra ID) - Azure CLI required for identity-based authentication, must be signed in with `az login` -->

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
    npm install @langchain/azure-cosmosdb @langchain/openai @langchain/core langchain zod mongodb
    ```

    - `@langchain/azure-cosmosdb`: LangChain integration for DocumentDB
    - `@langchain/openai`: LangChain integration for Azure OpenAI
    - `@langchain/core`: Core LangChain functionality
    - `langchain`: Main LangChain library with agent framework
    - `zod`: Schema validation for tool parameters
    - `mongodb`: MongoDB driver for database operations

1. Install development dependencies:

    ```bash
    npm install --save-dev @types/node typescript
    ```

1. Create a `.env` file in your project root. You can copy the sample from the repository:

    ```bash
    curl -o .env https://raw.githubusercontent.com/Azure-Samples/cosmos-db-vector-samples/main/mongo-vcore-agent-langchain/.env.sample
    ```

    **Important**: This quickstart uses a two-agent architecture (Planner + Synthesizer) with three model deployments (two chat models + embeddings). The standard LangChain environment variable pattern supports a single model, so this sample uses custom environment variables for each model deployment:
    
    - **Planner Agent**: `AZURE_OPENAI_PLANNER_DEPLOYMENT` and `AZURE_OPENAI_PLANNER_API_VERSION`
    - **Synthesizer Agent**: `AZURE_OPENAI_SYNTH_DEPLOYMENT` and `AZURE_OPENAI_SYNTH_API_VERSION`
    - **Embeddings**: `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` and `AZURE_OPENAI_EMBEDDING_API_VERSION`

    <!-- TODO: Add tabbed conceptual for passwordless authentication -->
    <!-- Tab 1: API Key / Connection String (default) -->
    Edit the `.env` file and replace these placeholder values:
    - `AZURE_OPENAI_API_KEY`: Your Azure OpenAI API key
    - `AZURE_OPENAI_API_INSTANCE_NAME`: Your Azure OpenAI resource name
    - `AZURE_OPENAI_PLANNER_DEPLOYMENT`: Your gpt-4o-mini deployment name
    - `AZURE_OPENAI_SYNTH_DEPLOYMENT`: Your gpt-4o deployment name
    - `AZURE_OPENAI_EMBEDDING_DEPLOYMENT`: Your text-embedding-3-small deployment name
    - `AZURE_DOCUMENTDB_MONGODB_CONNECTION_STRING`: Your Azure DocumentDB connection string
    - `MONGO_CLUSTER_NAME`: Your DocumentDB cluster name
    <!-- Tab 2: Passwordless (Microsoft Entra ID) -->
    <!-- Set `USE_PASSWORDLESS=true` in .env -->
    <!-- Remove or comment out: AZURE_OPENAI_API_KEY and AZURE_DOCUMENTDB_MONGODB_CONNECTION_STRING -->
    <!-- Ensure you're signed in with Azure CLI: `az login` -->
    <!-- Your Azure identity must have appropriate RBAC roles assigned (see Prerequisites) -->

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

Create the source directory structure:

```bash
mkdir -p src/utils
```

Create these files:

```bash
touch src/agent.ts
touch src/vector-store.ts
touch src/utils/prompts.ts
touch src/utils/clients.ts
touch src/utils/types.ts
touch src/utils/debug-handlers.ts
```

## Create utility files

The sample uses utility files to organize configuration and shared functionality. You can find the complete implementation in the [GitHub repository](https://github.com/Azure-Samples/cosmos-db-vector-samples/tree/main/mongo-vcore-agent-langchain/src/utils):

- **`src/utils/types.ts`**: TypeScript interfaces for Hotel data structures
- **`src/utils/clients.ts`**: Azure OpenAI client configuration for embeddings, planner, and synthesizer models. Supports both API key and passwordless authentication with Azure Identity.
- **`src/utils/prompts.ts`**: System prompts and tool descriptions for the two-agent architecture
- **`src/utils/debug-handlers.ts`**: Optional debug callbacks for development and troubleshooting

## Create the vector store module

The `src/vector-store.ts` file consolidates all vector database operations. This section shows the key components. See the [complete implementation on GitHub](https://github.com/Azure-Samples/cosmos-db-vector-samples/blob/main/mongo-vcore-agent-langchain/src/vector-store.ts).

### Initialize the vector store

The `getStore()` function performs the complete vector store setup: reads hotel documents from JSON, generates vector embeddings, creates the database and collection if they don't exist, inserts documents into DocumentDB, and creates the vector index for the selected algorithm:

```typescript
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

  console.log(`Inserted ${documents.length} documents into DocumentDB vector store.`);
  return store;
}
```

This code demonstrates:
- **Read documents**: Loads hotel data from JSON file using `readFileSync()` and parses into HotelsData array
- **Data transformation**: Uses TypeScript destructuring to exclude unnecessary fields (Description_fr, Location, Rooms)
- **Document creation**: Combines hotel name and description in pageContent for semantic search
- **Generate vectors**: `fromDocuments()` calls the embedding client to create vector embeddings for each document
- **Create database and collection**: Automatically creates the DocumentDB database and collection if they don't already exist
- **Insert documents**: Stores documents with their embeddings into DocumentDB collection
- **Create vector index**: Automatically creates the vector index based on the selected algorithm (IVF, HNSW, or DiskANN) via `getVectorIndexOptions()`

### Configure vector index algorithms

The `getVectorIndexOptions()` function supports three vector search algorithms with configurable parameters:

```typescript
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
```

Algorithm characteristics:
- **IVF (Inverted File Index)**: Default algorithm, balances speed and accuracy with configurable `numLists` parameter
- **HNSW (Hierarchical Navigable Small World)**: Graph-based algorithm with `m` (connections per node) and `efConstruction` (index build quality) parameters
- **DiskANN**: Microsoft Research algorithm optimized for large-scale vector search

All algorithms support three similarity types: `COS` (cosine), `L2` (Euclidean distance), and `IP` (inner product).

### Define the vector search tool

The `getHotelsToMatchSearchQuery` tool enables the planner agent to execute semantic searches. This LangChain tool definition includes schema validation and vector search logic:

```typescript
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
```

This tool implementation demonstrates:
- **Zod schema validation**: Ensures `query` is a string and `nearestNeighbors` is a number (defaults to 5)
- **Context injection**: Accesses the vector store and embedding client passed from the agent
- **Query embedding**: Converts natural language query to vector using the same embedding model
- **Vector similarity search**: Uses `similaritySearchVectorWithScore()` to find nearest neighbors with relevance scores
  - Similarity scores range from 0 to 1 (0% to 100% similarity)
  - A threshold of 0.7 means results with 70% or higher similarity are returned
  - Higher scores indicate closer semantic matches to the query
- **Result formatting**: Structures hotel data and scores for the synthesizer agent to analyze

## Create the Azure client connection code

The `src/utils/clients.ts` file creates Azure OpenAI clients for embeddings, planner, and synthesizer models. Create `src/utils/clients.ts` or see the [complete implementation on GitHub](https://github.com/Azure-Samples/cosmos-db-vector-samples/blob/main/mongo-vcore-agent-langchain/src/utils/clients.ts):

```typescript
import { AzureCosmosDBMongoDBVectorStore } from "@langchain/azure-cosmosdb";

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

<!-- TODO: Add tabbed conceptual for passwordless authentication -->
<!-- Tab 1: API Key / Connection String (default) - createClients() shown above -->
<!-- Tab 2: Passwordless (Microsoft Entra ID) - show createClientsPasswordless() implementation -->
export function createClientsPasswordless(): ClientConfig {
  // Passwordless authentication using Azure Identity
  // Note: Requires RBAC roles configured on both Azure OpenAI and Cosmos DB
  throw new Error("Passwordless authentication not yet implemented");
  /* Implementation would use:
  - new DefaultAzureCredential() for Azure Identity
  - azureADTokenProvider for Azure OpenAI clients
  - MongoDB connection string with Azure AD authentication
  - See complete implementation at: https://github.com/Azure-Samples/cosmos-db-vector-samples/blob/main/mongo-vcore-agent-langchain/src/utils/clients.ts
  */
}
```

## Create prompt templates

Paste the following code into `src/utils/prompts.ts` or see the [complete implementation on GitHub](https://github.com/Azure-Samples/cosmos-db-vector-samples/blob/main/mongo-vcore-agent-langchain/src/utils/prompts.ts):

```typescript
export const TOOL_NAME = "search_hotels_collection";

export const TOOL_DESCRIPTION = `REQUIRED TOOL - You MUST call this tool for EVERY hotel search request. This is the ONLY way to search the hotel database.

Performs vector similarity search on the Hotels collection using Azure DocumentDB (with MongoDB compatibility).

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

## Create debug handlers

The `src/utils/debug-handlers.ts` file provides optional debug callbacks for development and troubleshooting. When `DEBUG=true` is set in your environment, these callbacks log LLM and tool calls.

See the complete implementation in [`src/utils/debug-handlers.ts`](https://github.com/Azure-Samples/cosmos-db-vector-samples/blob/main/mongo-vcore-agent-langchain/src/utils/debug-handlers.ts) on GitHub.

## Create the main agent code

The main `src/agent.ts` file orchestrates the two-agent workflow. Create `src/agent.ts` or see the [complete implementation on GitHub](https://github.com/Azure-Samples/cosmos-db-vector-samples/blob/main/mongo-vcore-agent-langchain/src/agent.ts):

```typescript
import { AzureCosmosDBMongoDBVectorStore } from "@langchain/azure-cosmosdb";
import { TOOL_NAME, PLANNER_SYSTEM_PROMPT, SYNTHESIZER_SYSTEM_PROMPT, createSynthesizerUserPrompt } from './utils/prompts.js';
import { z } from 'zod';
import { createAgent } from "langchain";
import { createClientsPasswordless, createClients } from './utils/clients.js';
import { DEBUG_CALLBACKS } from './utils/debug-handlers.js';
import { extractPlannerToolOutput, getStore, getHotelsToMatchSearchQuery, deleteCosmosMongoDatabase } from './vector-store.js';

// Authentication
const clients =
  process.env.USE_PASSWORDLESS === "true" || process.env.USE_PASSWORDLESS === "1"
    ? createClientsPasswordless()
    : createClients();
const { embeddingClient, plannerClient, synthClient, dbConfig } = clients;

console.log(`DEBUG mode is ${process.env.DEBUG === 'true' ? 'ON' : 'OFF'}`);
console.log(`DEBUG_CALLBACKS length: ${DEBUG_CALLBACKS.length}`);

// Planner agent uses Vector Search Tool
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
  const searchResultsAsText = extractPlannerToolOutput(plannerMessages);
  
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
  return finalAnswer as string;
}

// Get vector store (get docs, create embeddings, insert docs)
const store = await getStore(
  process.env.DATA_FILE_WITHOUT_VECTORS!,
  embeddingClient,
  dbConfig);

const query = process.env.QUERY || "quintessential lodging near running trails, eateries, retail";
const nearestNeighbors = parseInt(process.env.NEAREST_NEIGHBORS || '5', 10);

// Run planner agent
const hotelContext = await runPlannerAgent(query, store, nearestNeighbors);
if (process.env.DEBUG==='true') console.log(hotelContext);

// Run synth agent
const finalAnswer = await runSynthesizerAgent(query, hotelContext);

// // Get final recommendation (data + AI)
console.log('\n--- FINAL ANSWER ---');
console.log(finalAnswer);

// Clean up (delete database)
await store.close();
await deleteCosmosMongoDatabase();
```

This main module demonstrates:

- **Authentication**: Supports both API key and passwordless authentication
- **Two-agent workflow**: Planner executes tool, Synthesizer analyzes results
- **Tool invocation**: Planner agent calls vector search with validated parameters
- **Context passing**: Search results flow from planner to synthesizer
- **Resource cleanup**: Closes connections and deletes test database
- Performs semantic similarity search and returns scored results
- Provides intelligent, context-aware hotel recommendations

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

## Clean up resources

The application automatically deletes the test database after execution. Delete the resource group, DocumentDB account, and Azure OpenAI resource when you don't need them to avoid extra costs.

## Common issues

### Connection failures to DocumentDB

If you receive connection timeout or authentication errors:

1. **Verify firewall configuration**: Ensure your client IP is added to the DocumentDB cluster firewall rules
   - Run `curl -4 ifconfig.me` to get your current IP address
   - Add the IP in Azure Portal: DocumentDB cluster → Networking → Firewall
   - See [Configure firewall rules](https://learn.microsoft.com/azure/cosmos-db/mongodb/vcore/how-to-configure-firewall)

2. **Check connection string**: Verify your `AZURE_DOCUMENTDB_MONGODB_CONNECTION_STRING` is correct and includes authentication credentials

### Rate limiting (429 errors)

If you encounter "Rate limit exceeded" errors:

1. **Increase token quotas**: Your deployment TPM may be insufficient
   - Review [Manage Azure OpenAI quotas](https://learn.microsoft.com/azure/ai-services/openai/how-to/quota)
   - Request quota increases in Azure Portal: Azure OpenAI resource → Quotas

2. **Verify deployment capacity**: Ensure each model deployment has the recommended TPM:
   - gpt-4o: 50,000 TPM
   - gpt-4o-mini: 30,000 TPM
   - text-embedding-3-small: 10,000 TPM

### Vector index errors

If vector index creation fails:

1. **Verify cluster tier**: Ensure your DocumentDB cluster meets the minimum tier requirement for your chosen algorithm:
   - IVF: M10+
   - HNSW: M30+
   - DiskANN: M30+

## Related content

- [Vector store in Azure DocumentDB](vector-search.md)
- [LangChain Azure DocumentDB Integration](https://js.langchain.com/docs/integrations/vectorstores/azure_cosmosdb)
- [LangChain Agent Framework](https://js.langchain.com/docs/concepts/agents)
