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
    getChatClient,
    getChatClientPasswordless,
    performAgentVectorSearch,
    executeHotelSearchWorkflow,
    createAgentConfig,
    AgentConfig,
    SearchConfig,
    withRetry,
    DEFAULT_RETRY_CONFIG
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
            console.log(`🔧 Tool Called: search_hotels("${query}", max=${maxResults})`);
            return await executeHotelSearchWorkflow(config, query, maxResults);
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
🏨 Help users find hotels from the Hotels collection in Azure Cosmos DB
📊 Analyze search quality using the metrics returned by search_hotels
🎯 Make data-driven recommendations based on relevance scores and hotel features

**Available Tool:**
- search_hotels: Searches the Hotels collection and returns results with quality metrics

**Understanding Tool Results:**
The search_hotels tool returns:
- Hotel results (HotelName, Description, Tags, etc.)
- searchMetrics object with:
  * totalResults: Number of hotels found
  * maxScore, minScore, averageScore: Relevance score distribution
  * embeddingField: Vector field used for search
  * dimensions: Embedding dimensionality

**Analyzing Search Quality:**
When users ask about search quality, analyze the searchMetrics:
1. **Score Interpretation:**
   - > 0.8 = Excellent semantic match
   - 0.7-0.8 = Good match
   - 0.6-0.7 = Fair match  
   - < 0.6 = Poor match (suggest query refinement)

2. **Score Distribution:**
   - Look at range between maxScore and minScore
   - Narrow range (< 0.1) = consistent quality
   - Wide range (> 0.2) = mixed relevance

3. **Result Count:**
   - < 3 results = query might be too specific
   - 5-10 results = good balance
   - Consider suggesting broader/narrower queries

**Decision-Making Process:**
1. **Understand** user requirements (location, budget, amenities, purpose)
2. **Search** using the search_hotels tool with semantic queries
3. **Interpret** searchMetrics to assess result quality
4. **Recommend** best hotels with confidence based on scores
5. **Explain** why certain hotels match better (use scores as evidence)

**Communication Style:**
- Be conversational and helpful
- Reference specific scores to show confidence
- Explain what scores mean in plain language
- Suggest query refinements if scores are low
- Mention the IVF algorithm when users ask about the technology

**About the Technology:**
The Hotels collection uses IVF (Inverted File) vector search algorithm for fast 
semantic similarity matching. The system searches across hotel descriptions and 
features using 1536-dimensional embeddings from Azure OpenAI (text-embedding-ada-002).`
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
    console.log('   Step 1: Checking authentication method...');
    
    // Initialize the chat model (LLM that powers the agent)
    // Use passwordless authentication if enabled, otherwise fall back to API key
    const usePasswordless = process.env.USE_PASSWORDLESS === 'true';
    console.log(`   ✅ Using ${usePasswordless ? 'passwordless' : 'API key'} authentication`);
    
    console.log('   Step 2: Creating chat client...');
    // Configure retry behavior (5 retries with exponential backoff)
    const maxRetries = 5;
    
    try {
        const chatClient = usePasswordless 
            ? getChatClientPasswordless(maxRetries)
            : getChatClient(maxRetries);
        
        if (!chatClient) {
            throw new Error('Failed to create chat client - check environment variables');
        }
        
        console.log(`   ✅ Chat client configured with ${maxRetries} retries for quota/rate limit handling`);
        
        console.log('   Step 3: Creating tools...');
        // Create the tool the agent can use
        const tools = [
            createHotelSearchTool()
        ];
        
        console.log(`   ✅ Created ${tools.length} tool: ${tools.map(t => t.name).join(', ')}`);
        
        console.log('   Step 4: Creating agent prompt...');
        const prompt = createAgentPrompt();
        console.log('   ✅ Prompt created');
        
        console.log('   Step 5: Creating tool calling agent...');
        // Create the agent with tools and prompt
        const agent = await createToolCallingAgent({
            llm: chatClient,
            tools,
            prompt: prompt
        });
        
        console.log('   ✅ Tool calling agent created');
        
        console.log('   Step 6: Creating agent executor...');
        // Create the executor that manages the agent's execution
        // Control LangChain internal logging with DEBUG environment variable
        const showLangChainLogs = process.env.DEBUG === 'true';
        
        let llmCallCount = 0;
        
        const agentExecutor = new AgentExecutor({
            agent,
            tools,
            maxIterations: 5, // Prevent infinite loops
            verbose: showLangChainLogs, // LangChain's internal logs (controlled by DEBUG env var)
            callbacks: [
                {
                    handleLLMStart: async (_llm: any, prompts: string[]) => {
                        llmCallCount++;
                        console.log(`   🤖 LLM Call #${llmCallCount}: Agent making decision with Azure OpenAI...`);
                        if (prompts && prompts.length > 0) {
                            const firstPrompt = prompts[0];
                            const preview = firstPrompt.substring(0, 100).replace(/\n/g, ' ');
                            console.log(`   📝 Prompt preview: "${preview}..."`);
                        }
                    },
                    handleLLMEnd: async (output: any) => {
                        console.log(`   ✅ LLM Response #${llmCallCount}: Received`);
                        // Show what the LLM decided to do
                        if (output?.generations?.[0]?.[0]?.text) {
                            const responsePreview = output.generations[0][0].text.substring(0, 100).replace(/\n/g, ' ');
                            console.log(`   📝 Response preview: "${responsePreview}..."`);
                        }
                    },
                    handleToolStart: async (tool: any) => {
                        console.log(`   🔧 Tool Start: ${tool.name}`);
                    },
                    handleToolEnd: async (output: string) => {
                        console.log(`   ✅ Tool Complete: Returned ${output.length} characters`);
                    },
                    handleAgentAction: async (action: any) => {
                        console.log(`   📋 Agent Decision: Calling tool "${action.tool}" with input`);
                    },
                    handleAgentEnd: async () => {
                        console.log('   🎯 Agent Complete: Synthesizing final response...\n');
                    }
                }
            ]
        });
        
        console.log('   ✅ Agent executor ready\n');
        
        return agentExecutor;
    } catch (error) {
        console.error('\n   ' + '='.repeat(70));
        console.error('   ❌ AGENT CREATION FAILED');
        console.error('   ' + '='.repeat(70));
        console.error(`   💥 Error: ${(error as Error)?.message || 'Unknown error'}`);
        console.error(`   🔍 Type: ${(error as any)?.constructor?.name || 'Unknown'}`);
        console.error('   📍 Failed during: Agent initialization/configuration');
        
        if ((error as Error)?.stack) {
            console.error('   📚 Stack:');
            (error as Error).stack?.split('\n').slice(0, 5).forEach(line => {
                console.error(`      ${line}`);
            });
        }
        console.error('   ' + '='.repeat(70) + '\n');
        throw error;
    }
}

// ============================================================================
// PROCESS MANAGEMENT UTILITIES
// ============================================================================

/**
 * Sets up graceful shutdown handlers for process termination signals
 */
function setupGracefulShutdown() {
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
}

/**
 * Measures execution time of an async operation
 */
async function measureExecutionTime<T>(operation: () => Promise<T>): Promise<{ result: T; duration: number }> {
    const startTime = Date.now();
    const result = await operation();
    const duration = Date.now() - startTime;
    return { result, duration };
}

/**
 * Formats and displays agent response with timing information
 */
function displayAgentResponse(output: string, duration: number) {
    console.log('🤖 AGENT RESPONSE:');
    console.log('-'.repeat(80));
    console.log(output);
    console.log('-'.repeat(80));
    console.log(`⏱️  Execution time: ${duration}ms\n`);
}

// ============================================================================
// MAIN APPLICATION - Putting It All Together
// ============================================================================

async function main() {
    console.log('🚀 Starting LangChain Hotel Search Agent\n');
    console.log('📋 Initialization Phase:');
    
    setupGracefulShutdown();
    console.log('   ✅ Graceful shutdown handlers registered');
    
    // Add timeout to prevent hanging
    const TIMEOUT_MS = 120000; // 2 minutes
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Agent execution timed out after ${TIMEOUT_MS/1000}s`)), TIMEOUT_MS);
    });
    
    try {
        console.log('\n🔧 Agent Creation Phase:');
        console.log('   (This may take 10-30 seconds on first run...)');
        const agent = await Promise.race([
            createHotelSearchAgent(),
            timeoutPromise
        ]) as any;
        console.log('✅ Agent created successfully\n');
        
        const query = "I need a luxury hotel with a spa and fitness center for a business trip";
        console.log('🔍 Query Execution Phase:');
        console.log(`   Query: "${query}"`);
        console.log('   Status: Sending to agent...\n');
        
        // Track tool executions
        const toolExecutions: string[] = [];
        let llmCallCount = 0;
        
        // Create custom callbacks for this execution
        const executionCallbacks = [{
            handleLLMStart: async () => {
                llmCallCount++;
                console.log(`   🤖 LLM Call #${llmCallCount}: Agent making decision with Azure OpenAI...`);
            },
            handleLLMEnd: async () => {
                console.log(`   ✅ LLM Response #${llmCallCount}: Received`);
            },
            handleAgentAction: async (action: any) => {
                toolExecutions.push(action.tool);
                console.log(`   📋 Agent Decision: Will call tool "${action.tool}"`);
            },
            handleAgentEnd: async () => {
                console.log('   🎯 Agent Complete: Synthesizing final response...\n');
            }
        }];
        
        // Execute the agent query
        // The chat client already has maxRetries=5 configured with exponential backoff
        // This handles rate limits at the LLM level while maintaining agent state
        console.log('🧠 Agent Processing:');
        console.log('   - Agent will analyze query and decide which tools to use');
        console.log('   - Waiting for response (max 2 minutes)...\n');
        
        const { result, duration } = await measureExecutionTime(() => 
            Promise.race([
                agent.invoke({ input: query }, { callbacks: executionCallbacks }),
                timeoutPromise
            ])
        );
        
        // Display execution summary
        console.log('\n' + '='.repeat(80));
        console.log('📊 EXECUTION SUMMARY');
        console.log('='.repeat(80));
        console.log(`🤖 LLM Calls Made: ${llmCallCount}`);
        console.log(`🔧 Tools Executed: ${toolExecutions.length}`);
        if (toolExecutions.length > 0) {
            toolExecutions.forEach((tool, idx) => {
                console.log(`   ${idx + 1}. ${tool}`);
            });
        }
        console.log(`⏱️  Total Duration: ${duration}ms`);
        console.log('='.repeat(80) + '\n');
        
        console.log('✅ Agent Response Received\n');
        
        displayAgentResponse(result.output, duration);
        
    } catch (error) {
        console.error('\n' + '='.repeat(80));
        console.error('❌ AGENT EXECUTION FAILED');
        console.error('='.repeat(80));
        
        const errorType = (error as any)?.constructor?.name || 'Unknown';
        const errorMessage = (error as Error)?.message || 'No message';
        
        console.error('\n📍 Context: Agent was processing user query and calling LangChain tools');
        console.error('🔧 Operation: Agent.invoke() - LLM decision making and tool execution');
        console.error('\n💥 Error Details:');
        console.error(`   Type: ${errorType}`);
        console.error(`   Message: ${errorMessage}`);
        
        // Provide specific guidance based on error type
        if (errorType === 'RateLimitError' || errorMessage.includes('429') || errorMessage.includes('Rate limit')) {
            console.error('\n🔍 Root Cause: Azure OpenAI Rate Limit Exceeded');
            console.error('   The agent successfully:');
            console.error('   ✅ Created tools and connected to MongoDB');
            console.error('   ✅ Executed vector search and found results');
            console.error('   ❌ But hit rate limits when calling Azure OpenAI LLM');
            console.error('\n💡 Solutions:');
            console.error('   1. Wait 60 seconds and try again');
            console.error('   2. Request quota increase in Azure Portal');
            console.error('   3. Use a different deployment with higher quota');
            console.error('   4. Implement request throttling in your application');
        } else if (errorType === 'APIConnectionError' || errorMessage.includes('Connection error')) {
            console.error('\n🔍 Root Cause: Network connectivity issue');
            console.error('   Cannot reach Azure OpenAI endpoint');
            console.error('\n💡 Solutions:');
            console.error('   1. Check internet connection');
            console.error('   2. Verify Azure OpenAI endpoint URL in .env');
            console.error('   3. Check firewall/proxy settings');
        } else if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
            console.error('\n🔍 Root Cause: Operation timed out');
            console.error('   Agent took too long to respond (>2 minutes)');
            console.error('\n💡 Solutions:');
            console.error('   1. Check Azure OpenAI service health');
            console.error('   2. Simplify the query');
            console.error('   3. Increase timeout value');
        }
        
        const stack = (error as Error)?.stack;
        if (stack) {
            console.error('\n📚 Stack Trace:');
            stack.split('\n').slice(0, 10).forEach(line => {
                console.error(`   ${line}`);
            });
        }
        
        console.error('\n' + '='.repeat(80));
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
    createAgentPrompt,
    config as agentConfig
};

// ============================================================================
// RUN IF CALLED DIRECTLY
// ============================================================================

// Convert Windows backslashes to forward slashes for path comparison
const normalizedArgPath = process.argv[1]?.replace(/\\/g, '/');
const normalizedMetaUrl = import.meta.url.replace('file:///', '').replace('file://', '');
const isMainModule = normalizedMetaUrl === normalizedArgPath;

if (isMainModule) {
    main().catch(error => {
        console.error('❌ Unhandled application error:', error);
        process.exit(1);
    });
}