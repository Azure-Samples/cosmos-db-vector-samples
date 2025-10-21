/**
 * Simple Hotel Search using Cosmos DB MongoDB vCore Vector Search
 * Direct search without LangChain agent - just raw vector search
 */

import { getClients, searchHotels } from './utils.js';

// ============================================================================
// Configuration
// ============================================================================

const config = {
    // Cosmos DB MongoDB vCore
    databaseName: process.env.MONGO_DB_NAME || 'Hotels',
   
    // Search parameters
    maxResults: parseInt(process.env.MAX_SEARCH_RESULTS || '5'),
    similarityThreshold: parseFloat(process.env.SIMILARITY_THRESHOLD || '0'),
    
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

// ============================================================================
// Search Queries
// ============================================================================

const searchQueries = [
    'quintessential lodging near running trails, eateries, retail'
];

// ============================================================================
// Main Search Function
// ============================================================================

async function performHotelSearch() {
    console.log('🚀 Starting Hotel Vector Search\n');
    console.log('Configuration:');
    console.log(`  Database: ${config.databaseName}`);
    console.log(`  Collection: ${activeCollection.name}`);
    console.log(`  Index: ${activeCollection.indexName}`);
    console.log(`  Algorithm: ${activeCollection.algorithm.toUpperCase()}`);
    console.log(`  Max Results: ${config.maxResults}`);
    console.log(`  Similarity Threshold: ${config.similarityThreshold}\n`);

    // Initialize clients
    const { embeddingClient, dbClient } = getClients();

    if (!embeddingClient || !dbClient) {
        throw new Error('❌ Clients are not configured. Please check your environment variables.');
    }

    try {
        // Connect to database
        console.log('📡 Connecting to Cosmos DB...');
        await dbClient.connect();
        console.log('✓ Connected to Cosmos DB\n');

        // Process each search query
        for (let i = 0; i < searchQueries.length; i++) {
            const query = searchQueries[i];
            
            console.log(`${'='.repeat(80)}`);
            console.log(`Search Query ${i + 1}: "${query}"`);
            console.log(`${'='.repeat(80)}\n`);

            try {
                // Perform vector search
                const results = await searchHotels(
                    embeddingClient,
                    dbClient,
                    activeCollection.name,
                    activeCollection.indexName,
                    activeCollection.algorithm,
                    query,
                    config.databaseName,
                    config.embeddedField,
                    config.similarityThreshold,
                    {},
                    config.maxResults
                );

                // Display results
                if (results.length === 0) {
                    console.log('❌ No hotels found matching your criteria.\n');
                } else {
                    console.log(`✅ Found ${results.length} hotels:\n`);
                    
                    results.forEach((hotel, idx) => {
                        console.log(`${idx + 1}. 🏨 ${hotel.HotelName || 'Unknown Hotel'}`);
                        console.log(`   ⭐ Rating: ${hotel.Rating || 'N/A'}`);
                        console.log(`   📍 Category: ${hotel.Category || 'N/A'}`);
                        console.log(`   🚗 Parking: ${hotel.ParkingIncluded ? 'Yes' : 'No'}`);
                        console.log(`   🎯 Relevance Score: ${hotel.score.toFixed(4)}`);
                        
                        if (hotel.Tags && hotel.Tags.length > 0) {
                            console.log(`   🏷️  Tags: ${hotel.Tags.slice(0, 3).join(', ')}`);
                        }
                        
                        if (hotel.Description) {
                            const shortDesc = hotel.Description.substring(0, 150);
                            console.log(`   📝 Description: ${shortDesc}${hotel.Description.length > 150 ? '...' : ''}`);
                        }
                        
                        console.log(''); // Empty line for readability
                    });
                }

            } catch (error) {
                console.error(`❌ Error searching for "${query}":`, error);
            }

            // Small delay between searches
            if (i < searchQueries.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        console.log(`${'='.repeat(80)}`);
        console.log('✅ All searches completed successfully!');
        console.log(`${'='.repeat(80)}\n`);

    } catch (error) {
        console.error('\n❌ Error during search:', error);
        throw error;
    } finally {
        // Close connection
        await dbClient.close();
        console.log('✓ Disconnected from Cosmos DB');
    }
}

// ============================================================================
// Run the search
// ============================================================================

async function main() {
    try {
        await performHotelSearch();
        console.log('\n🎉 Search completed successfully!');
    } catch (error) {
        console.error('\n💥 Search failed:', error);
        process.exit(1);
    }
}

main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});