/**
 * LangChain Decision Agent with Vector Search
 * 
 * LEARNING OBJECTIVES:
 * - Understanding LangChain agents and tool calling
 * - Creating structured tools with Zod schemas
 * - Building decision-making prompts for AI agents
 * - Integrating vector search with conversational AI
 * - Agent executor patterns and error handling
 */

import { AzureChatOpenAI } from '@langchain/openai';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { z } from 'zod';
import { 
    getClients,
    getClientsPasswordless,
    performAgentVectorSearch,
    executeHotelSearchWorkflow,
    executeSearchAnalysisWorkflow,
    createAgentConfig,
    AgentConfig,
    SearchConfig
} from './utils.js';

// ============================================================================
// Agent Configuration (moved complex logic to utils)
// ============================================================================

const config: AgentConfig = createAgentConfig();
const activeCollection = config.collections[config.activeCollectionIndex];

console.log('🏨 Agent Configuration:');
console.log(`  Database: ${config.databaseName}`);
console.log(`  Collection: ${activeCollection.name}`);
console.log(`  Algorithm: ${activeCollection.algorithm}`);

// ============================================================================
// LANGCHAIN TOOL CREATION - Core Learning Concept #1
// ============================================================================

/**
 * Creates a LangChain tool for hotel vector search
 * 
 * KEY CONCEPTS:
 * - DynamicStructuredTool: Allows runtime tool creation with custom schemas
 * - Zod schema: Defines and validates tool input parameters
 * - Tool description: Tells the agent when and how to use this tool
 * - Async func: The actual business logic the tool executes
 */
function createHotelSearchTool() {
    return new DynamicStructuredTool({
        // Tool identification and description for the agent
        name: 'search_hotels',
        description: `Search for hotels using semantic vector similarity.
        
        Use this tool when users ask about:
        - Finding hotels with specific features (luxury, budget, family-friendly)
        - Hotels near locations or with amenities (pool, parking, wifi, spa)
        - Hotel recommendations based on preferences
        
        Returns relevant hotels with scores, ratings, and amenities.`,
        
        // Define tool input schema using Zod
        schema: z.object({
            query: z.string().describe('Search query describing desired hotel features or requirements'),
            maxResults: z.number().optional().default(5).describe('Maximum number of results (1-10)')
        }),
        
        // The actual function that executes when the agent calls this tool
        func: async ({ query, maxResults = 5 }) => {
            return await executeHotelSearchWorkflow(config, query, maxResults);
        }
    });
}

/**
 * Creates a tool for analyzing search performance
 * 
 * LEARNING CONCEPT: Multiple tools can work together in an agent
 */
function createSearchAnalysisTool() {
    return new DynamicStructuredTool({
        name: 'analyze_search_performance',
        description: `Analyze the quality and performance of vector search results.
        
        Use this when users want to:
        - Understand search result quality
        - Get insights about relevance scores
        - Learn about the search algorithm performance`,
        
        schema: z.object({
            query: z.string().describe('Query to analyze'),
            sampleSize: z.number().optional().default(5).describe('Number of results to analyze')
        }),
        
        func: async ({ query, sampleSize = 5 }) => {
            return await executeSearchAnalysisWorkflow(config, query, sampleSize);
        }
    });
}

// ============================================================================
// AGENT PROMPT DESIGN - Core Learning Concept #2
// ============================================================================

/**
 * Creates the system prompt that defines the agent's behavior and capabilities
 * 
 * KEY CONCEPTS:
 * - System message: Sets the agent's role and expertise
 * - Placeholders: Enable conversation history and dynamic input
 * - Decision-making guidance: Helps agent understand when to use tools
 */
function createAgentPrompt() {
    return ChatPromptTemplate.fromMessages([
        [
            'system',
            `You are an expert hotel recommendation assistant using vector search technology.

**Your Role:**
🏨 Help users find hotels that match their specific needs and preferences
📊 Analyze search results and explain your recommendations
🎯 Make data-driven decisions based on relevance scores and hotel features

**Available Tools:**
- search_hotels: Find hotels using semantic similarity search
- analyze_search_performance: Get insights about search quality and performance

**Decision-Making Process:**
1. **Understand** user requirements (location, budget, amenities, purpose)
2. **Search** using the hotel search tool with well-crafted queries  
3. **Analyze** results considering relevance scores (>0.8 = excellent match)
4. **Recommend** best options with clear explanations
5. **Use analysis tool** when users want performance insights

**Communication Style:**
- Be conversational and helpful
- Explain why you recommend specific hotels
- Mention relevance scores to show confidence
- Suggest alternatives if results aren't ideal
- Use the analysis tool to explain search performance when asked

The system uses IVF (Inverted File) vector search algorithm, which provides 
excellent performance for large hotel datasets with semantic similarity matching.`
        ],
        ['placeholder', '{chat_history}'],
        ['human', '{input}'],
        ['placeholder', '{agent_scratchpad}']
    ]);
}

// ============================================================================
// AGENT CREATION - Core Learning Concept #3
// ============================================================================

/**
 * Creates and configures the LangChain agent
 * 
 * KEY CONCEPTS:
 * - createToolCallingAgent: Uses function calling for structured tool use
 * - AgentExecutor: Manages tool execution and conversation flow
 * - Error handling: Graceful failure and recovery patterns
 */
async function createHotelSearchAgent() {
    console.log('🤖 Creating LangChain Hotel Search Agent...');
    
    // Initialize the chat model (LLM that powers the agent)
    const chatClient = new AzureChatOpenAI({
        azureOpenAIApiKey: process.env.AZURE_OPENAI_EMBEDDING_KEY,
        azureOpenAIApiVersion: process.env.AZURE_OPENAI_EMBEDDING_API_VERSION,
        azureOpenAIEndpoint: process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT,
        azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_CHAT_MODEL || 'gpt-4o',
        temperature: 0.7, // Balanced creativity vs consistency
    });
    
    // Create the tools the agent can use
    const tools = [
        createHotelSearchTool(),
        createSearchAnalysisTool()
    ];
    
    // Create the agent with tools and prompt
    const agent = await createToolCallingAgent({
        llm: chatClient,
        tools,
        prompt: createAgentPrompt()
    });
    
    // Create the executor that manages the agent's execution
    const agentExecutor = new AgentExecutor({
        agent,
        tools,
        maxIterations: 5, // Prevent infinite loops
        verbose: false // Set to true for detailed execution logs
    });
    
    return agentExecutor;
}

// ============================================================================
// EXAMPLE QUERIES AND TESTING - Learning Resource
// ============================================================================

const EXAMPLE_QUERIES = [
    // Basic hotel search
    "I need a luxury hotel with a spa and fitness center for a business trip",
    
    // Location and amenities specific
    "Find family-friendly hotels near parks with pools and parking",
    
    // Performance analysis
    "Show me boutique hotels and analyze the search performance",
    
    // Original test query
    "quintessential lodging near running trails, eateries, retail"
];

// ============================================================================
// MAIN APPLICATION - Putting It All Together
// ============================================================================

async function main() {
    console.log('🚀 Starting LangChain Hotel Search Agent\n');
    
    // Handle process termination signals for graceful shutdown
    let isShuttingDown = false;
    const gracefulShutdown = async (signal: string) => {
        if (isShuttingDown) return;
        isShuttingDown = true;
        console.log(`\n🚨 Received ${signal}. Shutting down gracefully...`);
        console.log('✅ Agent process terminated');
        process.exit(0);
    };
    
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    
    try {
        // Create the agent
        const agent = await createHotelSearchAgent();
        
        // Determine if running in test mode
        const runTests = process.argv.includes('--test');
        
        if (runTests) {
            console.log('🧪 Running Example Queries...\n');
            
            // Run through example queries to demonstrate capabilities
            for (const [index, query] of EXAMPLE_QUERIES.entries()) {
                console.log('\n' + '='.repeat(100));
                console.log(`🔍 EXAMPLE ${index + 1}: ${query}`);
                console.log('='.repeat(100));
                
                const startTime = Date.now();
                
                try {
                    // Execute the agent with the query
                    const result = await agent.invoke({ input: query });
                    
                    const duration = Date.now() - startTime;
                    
                    console.log('\n🤖 AGENT RESPONSE:');
                    console.log('-'.repeat(80));
                    console.log(result.output);
                    console.log('-'.repeat(80));
                    console.log(`⏱️  Execution time: ${duration}ms\n`);
                } catch (queryError) {
                    console.error(`❌ Query ${index + 1} failed:`, queryError);
                    // Continue with next query instead of failing completely
                }
                
                // Brief pause between queries
                if (index < EXAMPLE_QUERIES.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        } else {
            console.log('💬 Interactive Mode - Demo with first example query');
            console.log('   Add --test flag to run all examples\n');
            
            // Run just the first example query for demo
            const query = EXAMPLE_QUERIES[0];
            console.log(`🔍 Demo Query: ${query}\n`);
            
            const result = await agent.invoke({ input: query });
            console.log('🤖 AGENT RESPONSE:');
            console.log(result.output);
        }
        
    } catch (error) {
        console.error('❌ Agent execution failed:', error);
        process.exitCode = 1;
    } finally {
        console.log('\n🔌 Agent process completed');
        process.exit(process.exitCode || 0);
    }
}

// ============================================================================
// EXPORT FOR EXTERNAL USE - Making it Reusable
// ============================================================================

export {
    createHotelSearchAgent,
    createHotelSearchTool,
    createSearchAnalysisTool,
    createAgentPrompt,
    config as agentConfig,
    EXAMPLE_QUERIES
};

// ============================================================================
// RUN IF CALLED DIRECTLY
// ============================================================================

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(error => {
        console.error('❌ Unhandled application error:', error);
        process.exit(1);
    });
}