/**
 * Simple LangChain Agent with Vector Search Tool
 * Decision-making agent that uses Cosmos DB vector search
 */

import { MongoClient } from 'mongodb';
import { ChatOpenAI, AzureChatOpenAI, OpenAIEmbeddings, AzureOpenAIEmbeddings, AzureOpenAI, } from '@langchain/openai';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { z } from 'zod';
import { getClients, searchHotels } from './utils.js';

// ============================================================================
// Configuration
// ============================================================================

const config = {
    // Cosmos DB MongoDB vCore
    databaseName: process.env.MONGO_DB_NAME || 'Hotels',
   
    // Search parameters
    maxResults: parseInt(process.env.MAX_SEARCH_RESULTS || '5'),
    similarityThreshold: parseFloat(process.env.SIMILARITY_THRESHOLD || '0.7'),

    // Batch configuration
    batchSize: parseInt(process.env.LOAD_SIZE_BATCH!, 10),
    
    // Vector configuration
    embeddedField: process.env.EMBEDDED_FIELD!,
    embeddingDimensions: parseInt(process.env.EMBEDDING_DIMENSIONS!, 10),


    // Collections with their respective algorithms
    collections: [
        {
            name: 'hotels_ivf',
            indexName: 'vectorIndex_ivf',
            algorithm: 'ivf' as const
        },
        // {
        //     name: 'hotels_hnsw',
        //     indexName: 'vectorIndex_hnsw',
        //     algorithm: 'hnsw' as const
        // },
        // {
        //     name: 'hotels_diskann',
        //     indexName: 'vectorIndex_diskann',
        //     algorithm: 'diskann' as const
        // }
    ],
    
    // Select which collection to use (index into collections array)
    // Change this to test different algorithms: 0 = ivf, 1 = hnsw, 2 = diskann
    activeCollectionIndex: 0
};

// Get the active collection configuration
const activeCollection = config.collections[config.activeCollectionIndex];

console.log('Active Collection Configuration:');
console.log(`  Collection: ${activeCollection.name}`);
console.log(`  Index: ${activeCollection.indexName}`);
console.log(`  Algorithm: ${activeCollection.algorithm}`);
console.log(config);

// ============================================================================
// LangChain Tool Definition
// ============================================================================

function createVectorSearchTool(
    embeddingClient: AzureOpenAIEmbeddings,
    dbClient: MongoClient,
    collectionName: string,
    indexName: string,
    algorithm: string
) {
    return new DynamicStructuredTool({
        name: 'search_hotels',
        description: `Search for hotels using semantic similarity. Use this tool when users ask about:
- Finding hotels with specific features (luxury, budget, family-friendly)
- Hotels near locations or with amenities (pool, parking, wifi)
- Hotel recommendations based on preferences
Returns a list of relevant hotels with names, descriptions, ratings, and amenities.`,
        schema: z.object({
            query: z.string().describe('The search query describing what kind of hotel the user is looking for'),
            maxResults: z.number().optional().describe('Maximum number of results to return (1-10)'),
        }),
        func: async ({ query, maxResults = 5 }) => {
            console.log(`🔍 Searching hotels: "${query}"`);
            
            const results = await searchHotels(
                embeddingClient,
                dbClient,
                collectionName,
                indexName,
                algorithm,
                query,
                config.databaseName,
                config.embeddedField,
                config.similarityThreshold,
                {},
                Math.min(maxResults, 10)
            );
            
            if (results.length === 0) {
                return JSON.stringify({ message: 'No hotels found matching your criteria.' });
            } else {
                console.log(`Found ${results.length} hotels matching the query.`);
            }

            // Format results for agent
            const formattedResults = results.map((hotel, idx) => ({
                rank: idx + 1,
                name: hotel.HotelName,
                description: hotel.Description?.substring(0, 200) + '...',
                rating: hotel.Rating,
                category: hotel.Category,
                tags: hotel.Tags?.slice(0, 5),
                parking: hotel.ParkingIncluded,
                relevanceScore: hotel.score.toFixed(3)
            }));

            return JSON.stringify({
                count: results.length,
                hotels: formattedResults
            }, null, 2);
        }
    });
}

// ============================================================================
// Agent Setup
// ============================================================================

async function createDecisionAgent(
    embeddingClient: AzureOpenAIEmbeddings,
    dbClient: MongoClient,
    collectionName: string,
    indexName: string,
    algorithm: string,
    chatClient: AzureChatOpenAI
) {
    const llm = chatClient;
    // Create tools
    const tools = [createVectorSearchTool(embeddingClient, dbClient, collectionName, indexName, algorithm)];

    // Define agent prompt
    const prompt = ChatPromptTemplate.fromMessages([
        [
            'system',
            `You are a helpful hotel recommendation assistant. You help users find hotels based on their preferences.

Your decision-making process:
1. Understand what the user is looking for
2. Use the search_hotels tool to find relevant hotels.If not end the analysis here.
3. Analyze the results (scores, ratings, amenities)
4. Make informed recommendations based on the data
5. Provide clear explanations for your recommendations

When making decisions:
- Consider relevance scores (higher is better)
- Consider hotel ratings
- Match user preferences to hotel features
- Be transparent about why you recommend specific hotels
- If no good matches found, suggest alternatives or ask for clarification`
        ],
        ['placeholder', '{chat_history}'],
        ['human', '{input}'],
        ['placeholder', '{agent_scratchpad}']
    ]);

    // Create agent
    console.log('🤖 Creating Decision-Making Agent...');
    const agent = await createToolCallingAgent({
        llm,
        tools,
        prompt
    });

    // Create executor
    console.log('🛠️ Creating Agent Executor...');
    const agentExecutor = new AgentExecutor({
        agent,
        tools,
        //verbose: true,
        maxIterations: 3
    });

    return agentExecutor;
}

// ============================================================================
// Main Application
// ============================================================================

async function main() {
    console.log('🚀 Starting LangChain Agent with Vector Search\n');

    const { embeddingClient, llmClient, dbClient } = getClients();

    await dbClient.connect();

    try {
        // Create agent with vector search configuration
        console.log('📡 Creating Decision-Making Agent with Vector Search...');
        const agent = await createDecisionAgent(
            embeddingClient,
            dbClient,
            activeCollection.name,
            activeCollection.indexName,
            activeCollection.algorithm,
            llmClient
        );

        // Example queries demonstrating decision-making
        const testQueries = [
            'quintessential lodging near running trails, eateries, retail'
        ];

        // Run agent on test queries
        for (const query of testQueries) {
            console.log('\n' + '='.repeat(80));
            console.log(`USER: ${query}`);
            console.log('='.repeat(80) + '\n');

            const result = await agent.invoke({
                input: query
            });

            console.log('\n📋 AGENT RESPONSE:');
            console.log(result.output);
            console.log('\n' + '='.repeat(80));
            
            // Small delay between queries
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

    } finally {
        await dbClient.close();
    }

    console.log('\n✅ Agent execution completed');
}

// ============================================================================
// Run Application
// ============================================================================

main().catch(error => {
    console.error('❌ Error:', error);
    process.exit(1);
});
