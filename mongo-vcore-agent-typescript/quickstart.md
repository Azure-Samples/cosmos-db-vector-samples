# Quickstart: LangChain Agent with Vector Search in Azure Cosmos DB for MongoDB (vCore)

Use LangChain AI agents with vector search capabilities in Azure Cosmos DB for MongoDB (vCore) using TypeScript. This quickstart demonstrates how to build intelligent agents that can search and analyze hotel data using natural language queries.

This example uses a sample hotel dataset with vector embeddings from the `text-embedding-ada-002` model, combined with LangChain's agent framework to create sophisticated search and analysis workflows.

Find the [complete source code](https://github.com/Azure-Samples/cosmos-db-vector-samples/tree/main/mongo-vcore-agent-typescript) on GitHub.

## Prerequisites

• An Azure subscription
  ◦ If you don't have an Azure subscription, create a [free account](https://azure.microsoft.com/pricing/purchase-options/azure-account?cid=msft_learn) before you begin.

• [Visual Studio Code](https://code.visualstudio.com/download)
  ◦ [DocumentDB extension for Visual Studio Code](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-documentdb)

• [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli)

• [Node.js LTS](https://nodejs.org/download/)

• [TypeScript](https://www.typescriptlang.org/download): Install TypeScript globally:
  ```bash
  npm install -g typescript
  ```

• [Azure OpenAI resource](https://learn.microsoft.com/en-us/azure/ai-foundry/openai) with:
  ◦ [Role Based Access Control (RBAC) enabled](https://learn.microsoft.com/en-us/azure/developer/ai/keyless-connections)
  ◦ `text-embedding-ada-002` model deployed for embeddings
  ◦ `gpt-4o` model deployed for chat completions

• [Azure Cosmos DB for MongoDB (vCore) resource](https://learn.microsoft.com/en-us/azure/cosmos-db/mongodb/vcore/quickstart-portal) with:
  ◦ [Role Based Access Control (RBAC) enabled](https://learn.microsoft.com/en-us/azure/cosmos-db/mongodb/vcore/how-to-configure-entra-authentication)
  ◦ Firewall configured for your IP address
  ◦ M40 tier or higher for vector search capabilities

## Project Structure

This quickstart creates a LangChain agent project with the following structure:

```
mongo-vcore-agent-typescript/
├── src/
│   ├── agent.ts          # Main LangChain agent with search tools
│   ├── utils.ts          # Database and AI client utilities
│   ├── insert.ts         # Data insertion utilities
│   └── search.ts         # Vector search implementations
├── .env                  # Environment variables
├── package.json          # Dependencies and scripts
└── tsconfig.json         # TypeScript configuration
```

## Setup Environment Variables

Create a `.env` file in your project root with the following configuration:

```bash
# Shared Azure OpenAI Configuration
AZURE_OPENAI_API_KEY=your_openai_api_key
AZURE_OPENAI_ENDPOINT=https://your-openai-resource.openai.azure.com/

# Embedding Model Configuration
AZURE_OPENAI_EMBEDDING_MODEL=text-embedding-ada-002
AZURE_OPENAI_EMBEDDING_API_VERSION=2023-05-15

# Chat Model Configuration  
AZURE_OPENAI_CHAT_MODEL=gpt-4o
AZURE_OPENAI_CHAT_API_VERSION=2024-08-01-preview

# MongoDB Configuration
MONGO_CLUSTER_NAME=your-mongodb-cluster-name

# Agent Configuration
AGENT_MAX_ITERATIONS=10
AGENT_RETURN_INTERMEDIATE_STEPS=true

# Data Configuration
DATA_FILE_WITH_VECTORS=../data/HotelsData_toCosmosDB_Vector.json
EMBEDDED_FIELD=text_embedding_ada_002
EMBEDDING_DIMENSIONS=1536
```

Replace the placeholder values with your actual Azure resource information:
• `AZURE_OPENAI_API_KEY`: Your Azure OpenAI resource API key
• `AZURE_OPENAI_ENDPOINT`: Your Azure OpenAI resource endpoint URL
• `MONGO_CLUSTER_NAME`: Your MongoDB vCore cluster name

## Install Dependencies

Initialize your Node.js project and install the required packages:

```bash
npm init -y
npm pkg set type="module"

# Install core dependencies
npm install mongodb @azure/identity openai

# Install LangChain dependencies
npm install @langchain/core @langchain/openai @langchain/mongodb

# Install additional utilities
npm install zod @types/node typescript

# Install development dependencies
npm install -D @types/node
```

### Package Overview

• `mongodb`: MongoDB Node.js driver for database operations
• `@azure/identity`: Azure Identity library for passwordless authentication
• `openai`: OpenAI client library for embeddings and chat
• `@langchain/core`: Core LangChain framework components
• `@langchain/openai`: LangChain Azure OpenAI integration
• `@langchain/mongodb`: LangChain MongoDB vector store integration
• `zod`: Schema validation for tool parameters

## Configure TypeScript

Add a `tsconfig.json` file for TypeScript configuration:

```json
{
    "compilerOptions": {
        "target": "ES2020",
        "module": "NodeNext",
        "moduleResolution": "nodenext",
        "declaration": true,
        "outDir": "./dist",
        "strict": true,
        "esModuleInterop": true,
        "skipLibCheck": true,
        "noImplicitAny": false,
        "forceConsistentCasingInFileNames": true,
        "sourceMap": true,
        "resolveJsonModule": true
    },
    "include": [
        "src/**/*"
    ],
    "exclude": [
        "node_modules",
        "dist"
    ]
}
```

## Create NPM Scripts

Edit your `package.json` file and add these scripts:

```json
{
  "scripts": {
    "build": "tsc",
    "start": "npm run build && node --env-file .env dist/agent.js",
    "insert": "npm run build && node --env-file .env dist/insert.js",
    "search": "npm run build && node --env-file .env dist/search.js"
  }
}
```

## LangChain Agent Architecture

The core of this quickstart is a LangChain agent that provides intelligent tools for hotel search and analysis. The agent uses structured tools with Zod schemas for type safety and validation.

### Agent Tools Overview

The LangChain agent provides two main tools:

1. **Hotel Search Tool**: Performs vector similarity search to find hotels matching specific criteria
2. **Search Analysis Tool**: Analyzes search results and provides insights about hotel characteristics

### Hotel Search Tool Implementation

The Hotel Search Tool uses vector embeddings to find similar hotels based on natural language queries:

```typescript
// Tool schema for type validation
const hotelSearchSchema = z.object({
  query: z.string().describe("Search query for hotels (e.g., 'luxury hotels with spa near beach')"),
  limit: z.number().min(1).max(20).default(5).describe("Number of results to return"),
  threshold: z.number().min(0).max(1).default(0.7).describe("Minimum similarity score threshold")
});

// Tool implementation
const hotelSearchTool = new DynamicStructuredTool({
  name: "hotel_search",
  description: "Search for hotels using vector similarity based on natural language descriptions",
  schema: hotelSearchSchema,
  func: async ({ query, limit, threshold }) => {
    // Vector search implementation
    const results = await performVectorSearch(query, limit, threshold);
    return formatSearchResults(results);
  }
});
```

### Search Analysis Tool Implementation

The Search Analysis Tool provides intelligent insights about search results:

```typescript
const searchAnalysisSchema = z.object({
  hotels: z.array(z.string()).describe("List of hotel names to analyze"),
  analysis_type: z.enum(["price", "location", "amenities", "rating"]).describe("Type of analysis to perform")
});

const searchAnalysisTool = new DynamicStructuredTool({
  name: "search_analysis", 
  description: "Analyze hotel search results for patterns, pricing, amenities, or location insights",
  schema: searchAnalysisSchema,
  func: async ({ hotels, analysis_type }) => {
    // Analysis implementation
    const analysis = await analyzeHotels(hotels, analysis_type);
    return formatAnalysisResults(analysis);
  }
});
```

## Database Integration

The agent integrates with Azure Cosmos DB for MongoDB (vCore) through utility functions that handle both traditional authentication and passwordless RBAC authentication.

### Database Client Configuration

```typescript
// Passwordless authentication using Azure Identity
export function getClientsPasswordless(): { aiClient: AzureOpenAI | null; dbClient: MongoClient | null } {
    const credential = new DefaultAzureCredential();
    
    // Azure OpenAI client with RBAC
    const aiClient = new AzureOpenAI({
        apiVersion: process.env.AZURE_OPENAI_EMBEDDING_API_VERSION!,
        endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
        azureADTokenProvider: getBearerTokenProvider(credential, "https://cognitiveservices.azure.com/.default")
    });

    // MongoDB client with RBAC
    const dbClient = new MongoClient(
        `mongodb+srv://${process.env.MONGO_CLUSTER_NAME}.global.mongocluster.cosmos.azure.com/`,
        {
            authMechanism: 'MONGODB-OIDC',
            authMechanismProperties: {
                OIDC_CALLBACK: (params) => AzureIdentityTokenCallback(params, credential)
            }
        }
    );

    return { aiClient, dbClient };
}
```

### Vector Search Implementation

The core vector search functionality combines embedding generation with MongoDB aggregation:

```typescript
export async function performAgentVectorSearch(
    collection: Collection,
    aiClient: AzureOpenAI,
    query: string,
    limit: number = 5,
    threshold: number = 0.7
) {
    // Generate embedding for the search query
    const embeddingResponse = await aiClient.embeddings.create({
        model: process.env.AZURE_OPENAI_EMBEDDING_MODEL!,
        input: [query]
    });

    // Perform vector similarity search
    const searchResults = await collection.aggregate([
        {
            $search: {
                cosmosSearch: {
                    vector: embeddingResponse.data[0].embedding,
                    path: process.env.EMBEDDED_FIELD!,
                    k: limit
                }
            }
        },
        {
            $project: {
                score: { $meta: "searchScore" },
                document: "$$ROOT"
            }
        },
        {
            $match: {
                score: { $gte: threshold }
            }
        }
    ]).toArray();

    return searchResults;
}
```

## Agent Workflow Execution

The agent executes workflows by combining multiple tool calls to provide comprehensive responses:

```typescript
export async function executeHotelSearchWorkflow(
    agent: any,
    userQuery: string,
    config: any
) {
    try {
        console.log(`\n🔍 Executing hotel search workflow for: "${userQuery}"`);
        
        // Execute the agent with the user query
        const result = await agent.invoke({
            input: userQuery
        });

        // Process and return results
        return {
            success: true,
            output: result.output,
            steps: result.intermediateSteps || []
        };
    } catch (error) {
        console.error('Workflow execution failed:', error);
        return {
            success: false,
            error: error.message
        };
    }
}
```

## Running the Agent

### 1. Authenticate with Azure CLI

Sign in to Azure CLI to enable passwordless authentication:

```bash
az login
```

### 2. Insert Sample Data (First Time Setup)

Load the hotel dataset with vector embeddings:

```bash
npm run insert
```

This command will:
• Connect to your MongoDB cluster
• Create the `Hotels` database and `hotels` collection
• Insert hotel data with vector embeddings
• Create vector indexes for similarity search

### 3. Run Interactive Agent

Start the LangChain agent for interactive queries:

```bash
npm run start
```

### 4. Example Agent Interactions

Once the agent is running, you can ask natural language questions:

**Query**: "Find luxury hotels with spa facilities near the beach"

**Agent Response**:
```
🔍 Executing hotel search workflow for: "Find luxury hotels with spa facilities near the beach"

Using hotel_search tool with parameters:
- query: "luxury hotels with spa facilities near the beach"
- limit: 5
- threshold: 0.75

Search Results:
1. Ocean View Resort & Spa (Score: 0.8901)
2. Beachfront Luxury Suites (Score: 0.8756)
3. Royal Coastal Resort (Score: 0.8643)
4. Seaside Wellness Hotel (Score: 0.8521)
5. Paradise Beach Resort (Score: 0.8445)

Using search_analysis tool to analyze amenities...

Analysis: These hotels share common luxury amenities including:
- Full-service spas with wellness programs
- Oceanfront locations with beach access
- Premium dining options
- Concierge services
- High-end room accommodations
```

## Tool Usage Patterns

### Hotel Search Tool

The hotel search tool accepts various query types:

```typescript
// Location-based searches
"hotels in downtown Seattle with conference facilities"

// Amenity-based searches  
"pet-friendly hotels with swimming pools"

// Experience-based searches
"romantic hotels for honeymoon with vineyard views"

// Business-focused searches
"budget hotels near airport with shuttle service"
```

### Search Analysis Tool

The analysis tool provides insights across multiple dimensions:

```typescript
// Price analysis
{ hotels: ["Hotel A", "Hotel B"], analysis_type: "price" }

// Location analysis
{ hotels: ["Downtown Hotel", "Airport Hotel"], analysis_type: "location" }

// Amenity comparison
{ hotels: ["Resort A", "Resort B"], analysis_type: "amenities" }

// Rating analysis
{ hotels: ["Budget Inn", "Luxury Suite"], analysis_type: "rating" }
```

## Agent Configuration

### Customizing Agent Behavior

The agent can be configured through environment variables:

```bash
# Control agent iteration limits
AGENT_MAX_ITERATIONS=10

# Enable detailed step tracking
AGENT_RETURN_INTERMEDIATE_STEPS=true

# Adjust search parameters
VECTOR_SEARCH_LIMIT=5
SIMILARITY_THRESHOLD=0.7
```

### Advanced Agent Features

The agent supports sophisticated workflows including:

• **Multi-step reasoning**: Combining search results with analysis
• **Context awareness**: Maintaining conversation history
• **Error handling**: Graceful degradation when tools fail
• **Result formatting**: Structured output for downstream processing

## Performance Optimization

### Database Performance

The MongoDB client is configured for optimal performance:

```typescript
const dbClient = new MongoClient(connectionString, {
    maxPoolSize: 10,         // Limit concurrent connections
    minPoolSize: 1,          // Maintain minimum connections
    maxIdleTimeMS: 30000,    // Close idle connections
    connectTimeoutMS: 30000, // Connection timeout
    socketTimeoutMS: 360000  // Socket timeout for long operations
});
```

### Vector Search Optimization

Vector search performance is optimized through:

• **Batch processing**: Efficient handling of multiple queries
• **Index configuration**: Proper vector index setup for similarity search
• **Result filtering**: Threshold-based filtering to improve relevance
• **Projection optimization**: Returning only necessary fields

## Troubleshooting

### Common Issues

**Authentication Errors**:
```bash
# Ensure you're logged into Azure CLI
az login

# Verify your account has proper permissions
az account show
```

**Connection Timeouts**:
```bash
# Check firewall settings in Azure portal
# Verify network connectivity to Azure services
```

**Missing Vector Indexes**:
```bash
# Run the insert script to create indexes
npm run insert
```

### Debugging Agent Behavior

Enable detailed logging to troubleshoot agent execution:

```typescript
// Set environment variable for detailed logs
AGENT_RETURN_INTERMEDIATE_STEPS=true

// Monitor tool execution
console.log('Tool execution:', toolResult);
```

## Related Resources

• [Azure Cosmos DB for MongoDB vCore Vector Search](https://learn.microsoft.com/en-us/azure/cosmos-db/mongodb/vcore/vector-search)
• [LangChain Agent Documentation](https://js.langchain.com/docs/modules/agents/)
• [Azure OpenAI Service](https://learn.microsoft.com/en-us/azure/ai-services/openai/)
• [MongoDB Vector Search](https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-search-overview/)

## Next Steps

• Extend the agent with additional tools for hotel booking or reviews
• Implement conversation memory for multi-turn interactions  
• Add support for image-based hotel search using vision models
• Create custom vector indexes for specialized search scenarios
• Deploy the agent as a web service using Azure Container Apps