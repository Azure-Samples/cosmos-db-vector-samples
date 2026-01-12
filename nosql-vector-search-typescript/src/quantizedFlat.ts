/**
 * QuantizedFlat Vector Index Demo for Azure Cosmos DB NoSQL
 * 
 * QuantizedFlat uses quantization techniques (based on Microsoft's DiskANN research)
 * to compress vectors for faster and more efficient similarity search.
 * 
 * Key Characteristics:
 * - Best for: Moderate to large datasets
 * - Accuracy: Very high recall (~100%, slight trade-off for performance)
 * - Performance: Fast, significantly better than Flat
 * - Memory: Reduced storage through quantization
 * - Dimensions: Supports up to 4096 dimensions
 * 
 * Use Cases:
 * - Medium to large datasets where slight accuracy trade-off is acceptable
 * - Resource-efficient semantic search
 * - Cost-optimized AI applications
 * - Production workloads needing good balance of speed and accuracy
 */

import path from 'path';
import { readFileReturnJson, getClientsPasswordless } from './utils.js';
import { VectorEmbeddingPolicy, VectorEmbeddingDataType, VectorEmbeddingDistanceFunction, IndexingPolicy, VectorIndexType } from '@azure/cosmos';

// ESM specific features - create __dirname equivalent
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const config = {
    query: "boutique hotel with excellent amenities and concierge service",
    dbName: "Hotels",
    collectionName: "hotels-quantizedflat",
    dataFile: process.env.DATA_FILE_WITH_VECTORS!,
    batchSize: parseInt(process.env.LOAD_SIZE_BATCH! || '50', 10),
    embeddedField: process.env.EMBEDDED_FIELD!,
    embeddingDimensions: parseInt(process.env.EMBEDDING_DIMENSIONS!, 10),
    deployment: process.env.AZURE_OPENAI_EMBEDDING_MODEL!,
};

async function main() {

    const { aiClient, dbClient } = getClientsPasswordless();

    try {
        
        if (!aiClient) {
            throw new Error('OpenAI client is not configured properly. Please check your environment variables.');
        }

        if (!dbClient) {
            throw new Error('Cosmos DB client is not configured properly. Please check your environment variables.');
        }

        console.log('\n========================================');
        console.log('QuantizedFlat Vector Index Demo');
        console.log('========================================\n');

        // Get database reference
        const { database } = await dbClient.databases.createIfNotExists({ id: config.dbName });
        console.log(`Database '${config.dbName}' ready.`);

        // Create the vector embedding policy
        // This defines how vectors are stored and indexed
        const vectorEmbeddingPolicy: VectorEmbeddingPolicy = {
            vectorEmbeddings: [
                {
                    path: `/${config.embeddedField}`,
                    dataType: VectorEmbeddingDataType.Float32,
                    dimensions: config.embeddingDimensions,
                    distanceFunction: VectorEmbeddingDistanceFunction.Cosine,
                }
            ],
        };

        // Create the indexing policy with QuantizedFlat vector index
        // QuantizedFlat provides excellent balance between speed and accuracy
        const indexingPolicy: IndexingPolicy = {
            vectorIndexes: [
                { 
                    path: `/${config.embeddedField}`, 
                    type: VectorIndexType.QuantizedFlat 
                },
            ],
            includedPaths: [
                {
                    path: "/*",
                },
            ],
            excludedPaths: [
                {
                    path: `/${config.embeddedField}/*`,
                }
            ]
        };

        // Create container with vector indexing
        const { resource: containerdef } = await database.containers.createIfNotExists({
            id: config.collectionName,
            vectorEmbeddingPolicy: vectorEmbeddingPolicy,
            indexingPolicy: indexingPolicy,
            partitionKey: {
                paths: ['/HotelId']
            }
        });
        console.log(`Container '${config.collectionName}' created with QuantizedFlat index.\n`);

        // Get container reference
        const container = database.container(config.collectionName);

        // Load and insert hotel data with embeddings
        console.log('Loading hotel data with embeddings...');
        const data = await readFileReturnJson(path.join(__dirname, "..", config.dataFile));
        console.log(`Loaded ${data.length} hotels from file.`);

        console.log('\nInserting documents...');
        let inserted = 0;
        for (const doc of data.slice(0, config.batchSize)) {
            try {
                await container.items.create(doc);
                inserted++;
                if (inserted % 10 === 0) {
                    process.stdout.write(`\rInserted ${inserted}/${Math.min(config.batchSize, data.length)} documents...`);
                }
            } catch (error: any) {
                if (error.code !== 409) { // Ignore duplicate key errors
                    console.error(`\nError inserting document:`, error.message);
                }
            }
        }
        console.log(`\n✓ Inserted ${inserted} documents successfully.\n`);

        // Create embedding for the query
        console.log(`Query: "${config.query}"`);
        console.log('Generating embedding for query...');
        const createEmbeddedForQueryResponse = await aiClient.embeddings.create({
            model: config.deployment,
            input: [config.query]
        });
        console.log('✓ Query embedding generated.\n');

        // Perform the vector similarity search using VectorDistance
        console.log('Performing vector search with QuantizedFlat index...');
        const { resources, requestCharge } = await container.items
            .query({
                query: "SELECT TOP 5 c.HotelName, c.Description, c.Rating, VectorDistance(c[@embeddedField], @embedding) AS SimilarityScore FROM c ORDER BY VectorDistance(c[@embeddedField], @embedding)",
                parameters: [
                    { name: "@embedding", value: createEmbeddedForQueryResponse.data[0].embedding },
                    { name: "@embeddedField", value: config.embeddedField }
                ]
            })
            .fetchAll();

        console.log('✓ Search completed.\n');

        // Display results
        console.log('========================================');
        console.log('Top 5 Results (QuantizedFlat Index)');
        console.log('========================================\n');

        resources.forEach((item, index) => {
            console.log(`${index + 1}. ${item.HotelName}`);
            console.log(`   Similarity Score: ${item.SimilarityScore.toFixed(4)}`);
            console.log(`   Rating: ${item.Rating}/5.0`);
            console.log(`   Description: ${item.Description.substring(0, 120)}...`);
            console.log('');
        });

        console.log('========================================');
        console.log('Understanding Similarity Scores');
        console.log('========================================\n');
        console.log('Cosine Similarity Range: 0.0 to 1.0');
        console.log('- 1.0 = Identical vectors (perfect match)');
        console.log('- 0.9-0.99 = Very similar (highly relevant)');
        console.log('- 0.8-0.89 = Similar (relevant)');
        console.log('- 0.7-0.79 = Somewhat similar');
        console.log('- < 0.7 = Different (less relevant)\n');

        console.log('Note: QuantizedFlat provides ~100% accuracy');
        console.log('with significantly better performance than Flat index.\n');

        console.log(`Request Charge: ${requestCharge} RUs\n`);

    } catch (error) {
        console.error('App failed:', error);
        process.exitCode = 1;
    } 
}

// Execute the main function
main().catch(error => {
    console.error('Unhandled error:', error);
    process.exitCode = 1;
});
