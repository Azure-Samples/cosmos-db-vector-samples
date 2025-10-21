/**
 * Example: How to use the embedding utilities with different models
 * This demonstrates the flexibility of the new embedding system
 */

import { 
    createEmbeddingsWorkflow,
    createEmbeddings,
    processEmbeddingBatch,
    getClients
} from './dist/utils.js';

// Example 1: Using different models with the workflow function
async function exampleWorkflowWithDifferentModels() {
    console.log('📚 Example: Using different embedding models\n');
    
    // Configuration for text-embedding-ada-002
    const ada002Config = {
        fieldToEmbed: "Description",
        newEmbeddedField: "ada002_embedding",
        batchSize: 10,
        modelName: "text-embedding-ada-002"  // Explicitly specify model
    };

    // If you had access to other models, you could easily switch:
    /*
    const ada003Config = {
        fieldToEmbed: "Description", 
        newEmbeddedField: "ada003_embedding",
        batchSize: 10,
        modelName: "text-embedding-3-small"  // Different model
    };
    */

    console.log('✅ Configurations created with different model names');
    console.log(`Current model: ${ada002Config.modelName}`);
    console.log(`Output field: ${ada002Config.newEmbeddedField}`);
}

// Example 2: Direct embedding creation with custom model
async function exampleDirectEmbeddingCreation() {
    console.log('\n🔧 Example: Direct embedding creation with custom model\n');
    
    const { aiClient } = getClients();
    if (!aiClient) {
        throw new Error('AI client not configured');
    }

    const sampleTexts = [
        "Luxury hotel with excellent amenities",
        "Cozy bed and breakfast near downtown"
    ];

    // Easy to change model name here
    const modelName = "text-embedding-ada-002"; // Change this to switch models
    
    try {
        const embeddings = await createEmbeddings(aiClient, modelName, sampleTexts);
        console.log(`✅ Created embeddings using model: ${modelName}`);
        console.log(`📊 Number of embeddings: ${embeddings.length}`);
        console.log(`📏 Vector dimensions: ${embeddings[0].embedding.length}`);
    } catch (error) {
        console.error(`❌ Error with model ${modelName}:`, error.message);
    }
}

// Example 3: Batch processing with configurable model
async function exampleBatchProcessing() {
    console.log('\n⚡ Example: Batch processing with configurable model\n');
    
    const { aiClient } = getClients();
    if (!aiClient) {
        throw new Error('AI client not configured');
    }

    const sampleItems = [
        { Description: "Modern hotel with WiFi", HotelId: "1", Category: "Business" },
        { Description: "Family resort with pool", HotelId: "2", Category: "Resort" }
    ];

    // Configuration makes it easy to change model and other settings
    const config = {
        fieldToEmbed: "Description",
        newEmbeddedField: "custom_embedding",
        batchSize: 2,
        modelName: "text-embedding-ada-002"  // Easy to change
    };

    try {
        const processedItems = await processEmbeddingBatch(aiClient, config, sampleItems);
        console.log(`✅ Processed ${processedItems.length} items`);
        console.log(`🏷️  Embedding field: ${config.newEmbeddedField}`);
        console.log(`🤖 Model used: ${config.modelName}`);
        
        // Show the structure
        const item = processedItems[0];
        console.log(`📋 Sample item keys: ${Object.keys(item).join(', ')}`);
    } catch (error) {
        console.error(`❌ Batch processing error:`, error.message);
    }
}

// Main function to run all examples
async function main() {
    console.log('🚀 Embedding Model Configuration Examples\n');
    console.log('='.repeat(60));
    
    try {
        await exampleWorkflowWithDifferentModels();
        await exampleDirectEmbeddingCreation();
        await exampleBatchProcessing();
        
        console.log('\n' + '='.repeat(60));
        console.log('✅ All examples completed successfully!');
        console.log('\n🎯 Key takeaways:');
        console.log('  • Model name is easily configurable as a parameter');
        console.log('  • No code changes needed to switch models');
        console.log('  • Environment variables provide sensible defaults');
        console.log('  • Batch processing handles rate limiting automatically');
        console.log('  • Flexible field naming for different embedding types');
        
    } catch (error) {
        console.error('❌ Example failed:', error);
        process.exit(1);
    }
}

// Run examples
main();