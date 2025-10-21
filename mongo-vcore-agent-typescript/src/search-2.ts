/**
 * Simplified Hotel Search using Cosmos DB MongoDB vCore Vector Search
 * Based directly on the vector search project's ivf.ts implementation
 * Everything self-contained - no utils dependencies
 */

import { MongoClient } from 'mongodb';
import { AzureOpenAI } from 'openai/index.js';

// ============================================================================
// Configuration
// ============================================================================

const config = {
    query: "quintessential lodging near running trails, eateries, retail",
    dbName: "Hotels2", // Test with Hotels2 first to see if it works
    collectionName: "hotels_ivf",
    indexName: "vectorIndex_ivf",
    embeddedField: process.env.EMBEDDED_FIELD!,
    embeddingDimensions: parseInt(process.env.EMBEDDING_DIMENSIONS!, 10),
    deployment: process.env.AZURE_OPENAI_EMBEDDING_MODEL!,
};

// ============================================================================
// Client Setup (copied from vector search project)
// ============================================================================

function getClients(): { aiClient: AzureOpenAI; dbClient: MongoClient } {
    // Azure OpenAI client setup (matching vector search project)
    const apiKey = process.env.AZURE_OPENAI_KEY!;
    const apiVersion = process.env.AZURE_OPENAI_EMBEDDING_API_VERSION!;
    const endpoint = `https://${process.env.AZURE_OPENAI_INSTANCE!}.openai.azure.com`;
    const deployment = process.env.AZURE_OPENAI_EMBEDDING_MODEL!;
    
    const aiClient = new AzureOpenAI({
        apiKey,
        apiVersion,
        endpoint,
        deployment
    });

    // MongoDB client setup (matching vector search project)
    const dbClient = new MongoClient(process.env.MONGO_CONNECTION_STRING!, {
        // Performance optimizations
        maxPoolSize: 10,         // Limit concurrent connections
        minPoolSize: 1,          // Maintain at least one connection
        maxIdleTimeMS: 30000,    // Close idle connections after 30 seconds
        connectTimeoutMS: 30000, // Connection timeout
        socketTimeoutMS: 360000, // Socket timeout (for long-running operations)
        writeConcern: {          // Optimize write concern for bulk operations
            w: 1,                // Acknowledge writes after primary has written
            j: false             // Don't wait for journal commit
        }
    });

    return { aiClient, dbClient };
}

// ============================================================================
// Main Search Function (copied and simplified from vector search project)
// ============================================================================

async function main() {
    console.log('🚀 Starting simplified hotel vector search');
    console.log(`Database: ${config.dbName}`);
    console.log(`Collection: ${config.collectionName}`);
    console.log(`Query: "${config.query}"`);
    console.log('');

    const { aiClient, dbClient } = getClients();

    try {
        if (!aiClient) {
            throw new Error('AI client is not configured. Please check your environment variables.');
        }
        if (!dbClient) {
            throw new Error('Database client is not configured. Please check your environment variables.');
        }

        console.log('📡 Connecting to MongoDB...');
        await dbClient.connect();
        console.log('✓ Connected to MongoDB');

        const db = dbClient.db(config.dbName);
        const collection = db.collection(config.collectionName);

        // Verify collection exists and has documents
        const docCount = await collection.countDocuments();
        console.log(`✓ Collection ${config.collectionName} has ${docCount} documents`);

        if (docCount === 0) {
            console.log('❌ No documents found in collection. Make sure to run the insert script first.');
            return;
        }

        console.log('🧠 Creating embedding for query...');
        // Create embedding for the query (exactly like vector search project)
        const createEmbeddedForQueryResponse = await aiClient.embeddings.create({
            model: config.deployment,
            input: [config.query]
        });

        console.log('✓ Query embedding created');
        console.log(`Embedding dimensions: ${createEmbeddedForQueryResponse.data[0].embedding.length}`);

        console.log('🔍 Performing vector similarity search...');
        console.log(`Using embedding field: ${config.embeddedField}`);
        console.log(`Index name: ${config.indexName}`);
        
        const queryVector = createEmbeddedForQueryResponse.data[0].embedding;
        console.log(`Query vector length: ${queryVector.length}`);
        console.log(`First 5 vector values: [${queryVector.slice(0, 5).join(', ')}]`);
        
        const pipeline = [
            {
                $search: {
                    cosmosSearch: {
                        vector: queryVector,
                        path: "text_embedding_ada_002", // Use the exact field name without config
                        k: 5
                    },
                    returnStoredSource: true
                }
            },
            {
                $project: {
                    score: {
                        $meta: "searchScore"
                    },
                    document: "$$ROOT"
                }
            }
        ];
        
        console.log('📋 Pipeline:', JSON.stringify(pipeline, null, 2));
        
        // Perform the vector similarity search (exactly like vector search project)
        const searchResults = await collection.aggregate(pipeline).toArray();

        console.log(`✓ Search completed. Found ${searchResults.length} results`);
        console.log('');

        // Print the results (simplified format)
        if (searchResults.length === 0) {
            console.log('❌ No results found');
        } else {
            console.log('📊 Search Results:');
            console.log('================');
            
            searchResults.forEach((result, index) => {
                const { document, score } = result;
                console.log(`${index + 1}. 🏨 ${document.HotelName || 'Unknown Hotel'}`);
                console.log(`   Score: ${score.toFixed(4)}`);
                console.log(`   Category: ${document.Category || 'N/A'}`);
                console.log(`   Rating: ${document.Rating || 'N/A'}`);
                if (document.Description) {
                    const shortDesc = document.Description.substring(0, 100);
                    console.log(`   Description: ${shortDesc}${document.Description.length > 100 ? '...' : ''}`);
                }
                console.log('');
            });
        }

        // Also output raw results for debugging (like vector search project)
        console.log('🔧 Raw Results (for debugging):');
        console.log(JSON.stringify(searchResults, null, 2));

    } catch (error) {
        console.error('❌ Search failed:', error);
        process.exitCode = 1;
    } finally {
        console.log('📡 Closing database connection...');
        if (dbClient) await dbClient.close();
        console.log('✓ Database connection closed');
    }
}

// ============================================================================
// Execute the main function
// ============================================================================

main().catch(error => {
    console.error('💥 Unhandled error:', error);
    process.exitCode = 1;
});