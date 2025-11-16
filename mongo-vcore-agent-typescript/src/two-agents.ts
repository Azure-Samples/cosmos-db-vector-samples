/**
 * Two-Agent System: Search Agent → Analysis Agent
 * 
 * ARCHITECTURE:
 * Agent 1 (Search Agent): Performs vector search and retrieves hotel documents
 * Agent 2 (Analysis Agent): Analyzes the search results and provides insights
 * 
 * LEARNING OBJECTIVES:
 * - Multi-agent orchestration patterns
 * - Sequential agent execution
 * - Data flow between specialized agents
 * - Separation of concerns (retrieval vs analysis)
 */

import { AzureChatOpenAI } from '@langchain/openai';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { z } from 'zod';
import { 
    getChatClient,
    getChatClientPasswordless,
    executeHotelSearchWorkflow,
    createAgentConfig,
    AgentConfig
} from './utils.js';

// ============================================================================
// Configuration
// ============================================================================

const config: AgentConfig = createAgentConfig();
const activeCollection = config.collections[config.activeCollectionIndex];

console.log('🤖 Two-Agent System Configuration:');
console.log(`  Database: ${config.databaseName}`);
console.log(`  Collection: ${activeCollection.name}`);
console.log(`  Algorithm: ${activeCollection.algorithm}`);
console.log(`  Agent 1: Search & Retrieval`);
console.log(`  Agent 2: Analysis & Insights\n`);

// ============================================================================
// AGENT 1: SEARCH AGENT - Handles vector search and data retrieval
// ============================================================================

/**
 * Creates the search tool for Agent 1
 * This agent is responsible ONLY for finding relevant hotels
 */
function createSearchTool() {
    return new DynamicStructuredTool({
        name: 'search_hotels',
        description: `Search for hotels using semantic vector similarity.
        
        Use this tool to find hotels matching the user's requirements.
        Returns hotel data with similarity scores.`,
        
        schema: z.object({
            query: z.string().describe('Search query describing hotel requirements'),
            maxResults: z.number().optional().default(5).describe('Maximum results (1-10)')
        }),
        
        func: async ({ query, maxResults = 5 }) => {
            console.log(`\n🔍 Agent 1 - Search Tool Called: "${query}"`);
            return await executeHotelSearchWorkflow(config, query, maxResults);
        }
    });
}

/**
 * Creates the prompt for Agent 1 (Search Agent)
 * Focused on understanding search intent and retrieving relevant data
 */
function createSearchAgentPrompt() {
    return ChatPromptTemplate.fromMessages([
        [
            'system',
            `You are a hotel search specialist. Your job is to:

1. Understand the user's hotel requirements
2. Use the search_hotels tool to find relevant hotels
3. Return the raw search results to be analyzed by another agent

Be concise. Just execute the search and return the results.
Do not analyze or interpret - that's the next agent's job.`
        ],
        ['placeholder', '{chat_history}'],
        ['human', '{input}'],
        ['placeholder', '{agent_scratchpad}']
    ]);
}

/**
 * Creates Agent 1: Search Agent
 */
async function createSearchAgent(chatClient: AzureChatOpenAI): Promise<AgentExecutor> {
    const tools = [createSearchTool()];
    const prompt = createSearchAgentPrompt();
    
    const agent = await createToolCallingAgent({
        llm: chatClient,
        tools,
        prompt
    });
    
    return new AgentExecutor({
        agent,
        tools,
        maxIterations: 3,
        verbose: process.env.DEBUG === 'true'
    });
}

// ============================================================================
// AGENT 2: ANALYSIS AGENT - Analyzes search results and provides insights
// ============================================================================

/**
 * Creates the analysis tool for Agent 2
 * This tool receives search results and metadata for analysis
 */
function createAnalysisTool() {
    return new DynamicStructuredTool({
        name: 'analyze_results',
        description: `Analyze hotel search results and provide insights.
        
        This tool receives search results with:
        - Hotel names, descriptions, ratings
        - Similarity scores (0-1, higher = better match)
        - Search metadata (score distribution, result count)
        
        Provide insights about quality, recommendations, and patterns.`,
        
        schema: z.object({
            searchResults: z.string().describe('JSON string of search results from Agent 1'),
        }),
        
        func: async ({ searchResults }) => {
            console.log(`\n📊 Agent 2 - Analysis Tool Called`);
            
            try {
                const data = JSON.parse(searchResults);
                
                // Extract insights from the data
                const insights = {
                    resultsProvided: true,
                    totalResults: data.totalResults || 0,
                    searchQuery: data.searchQuery || 'unknown',
                    algorithm: data.algorithm || 'unknown',
                    metrics: data.searchMetrics || {},
                    resultsPreview: data.results ? data.results.substring(0, 500) : 'No results'
                };
                
                return JSON.stringify(insights, null, 2);
            } catch (error) {
                return JSON.stringify({
                    error: 'Failed to parse search results',
                    message: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        }
    });
}

/**
 * Creates the prompt for Agent 2 (Analysis Agent)
 * Focused on interpreting results and providing insights
 */
function createAnalysisAgentPrompt() {
    return ChatPromptTemplate.fromMessages([
        [
            'system',
            `You are a hotel recommendation analyst. Your job is to:

1. Receive search results from the search agent
2. Use the analyze_results tool to extract insights
3. Provide a thoughtful analysis including:
   - Quality assessment based on similarity scores
   - Top recommendations with reasoning
   - Score distribution patterns
   - Whether the search was successful

**Understanding Similarity Scores:**
- 0.9-1.0: Excellent match (rare, nearly perfect)
- 0.8-0.9: Very good match (high relevance)
- 0.7-0.8: Good match (relevant)
- 0.6-0.7: Fair match (somewhat relevant)
- Below 0.6: Poor match (low relevance)

**Score Distribution:**
- Narrow range (e.g., 0.85-0.87): Consistently relevant results
- Wide range (e.g., 0.65-0.90): Mixed quality results

Provide clear, actionable recommendations to the user.`
        ],
        ['placeholder', '{chat_history}'],
        ['human', '{input}'],
        ['placeholder', '{agent_scratchpad}']
    ]);
}

/**
 * Creates Agent 2: Analysis Agent
 */
async function createAnalysisAgent(chatClient: AzureChatOpenAI): Promise<AgentExecutor> {
    const tools = [createAnalysisTool()];
    const prompt = createAnalysisAgentPrompt();
    
    const agent = await createToolCallingAgent({
        llm: chatClient,
        tools,
        prompt
    });
    
    return new AgentExecutor({
        agent,
        tools,
        maxIterations: 3,
        verbose: process.env.DEBUG === 'true'
    });
}

// ============================================================================
// ORCHESTRATION: Execute both agents sequentially
// ============================================================================

/**
 * Orchestrates the two-agent system
 * Agent 1 searches → Agent 2 analyzes
 */
async function executeTwoAgentSystem(query: string): Promise<void> {
    console.log('\n' + '='.repeat(80));
    console.log('🚀 TWO-AGENT SYSTEM: Sequential Execution');
    console.log('='.repeat(80));
    console.log(`Query: "${query}"\n`);
    
    try {
        // Initialize chat client
        const chatClient = config.usePasswordless ? 
            getChatClientPasswordless()! : 
            getChatClient();
        
        // ===== AGENT 1: SEARCH =====
        console.log('📍 Phase 1: Search Agent (Vector Retrieval)');
        console.log('-'.repeat(80));
        
        const searchAgent = await createSearchAgent(chatClient);
        const searchResult = await searchAgent.invoke({ 
            input: query 
        });
        
        console.log('\n✅ Agent 1 Complete');
        console.log(`   Output: ${searchResult.output.length} characters\n`);
        
        // ===== AGENT 2: ANALYSIS =====
        // console.log('📍 Phase 2: Analysis Agent (Insights & Recommendations)');
        // console.log('-'.repeat(80));
        
        // const analysisAgent = await createAnalysisAgent(chatClient);
        
        // // Pass Agent 1's output to Agent 2
        // const analysisPrompt = `Analyze these search results and provide recommendations:\n\n${searchResult.output}`;
        
        // const analysisResult = await analysisAgent.invoke({
        //     input: analysisPrompt
        // });
        
        // console.log('\n✅ Agent 2 Complete\n');
        
        // // ===== FINAL OUTPUT =====
        // console.log('='.repeat(80));
        // console.log('📊 FINAL ANALYSIS & RECOMMENDATIONS');
        // console.log('='.repeat(80));
        // console.log(analysisResult.output);
        // console.log('='.repeat(80) + '\n');
        
    } catch (error) {
        console.error('\n❌ Two-Agent System Failed');
        console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        throw error;
    }
}

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

function setupGracefulShutdown() {
    let isShuttingDown = false;
    
    const gracefulShutdown = async (signal: string) => {
        if (isShuttingDown) return;
        isShuttingDown = true;
        
        console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
        process.exit(0);
    };
    
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
    console.log('🚀 Starting Two-Agent Hotel Search System\n');
    
    setupGracefulShutdown();
    
    // Example query
    const query = "I need a luxury hotel with a spa and fitness center for a business trip";
    
    try {
        await executeTwoAgentSystem(query);
        console.log('🎉 Two-Agent System completed successfully\n');
    } catch (error) {
        console.error('💥 System failed:', error);
        process.exit(1);
    }
}

// Run the main function
main();
