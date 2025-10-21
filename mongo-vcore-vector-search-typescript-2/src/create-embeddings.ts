/**
 * Module for creating embedding vectors using OpenAI API
 * Supports text embedding models for generating embeddings
 * that can be used with Cosmos DB MongoDB vCore vector search
 */
import * as path from "node:path";
import { 
    createEmbeddingsWorkflow, 
    EmbeddingConfig,
    getClients,
    getClientsPasswordless 
} from "./utils.js";

// ESM specific features - create __dirname equivalent
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration from environment variables
const dataWithVectors = process.env.DATA_FILE_WITH_VECTORS!;
const dataWithoutVectors = process.env.DATA_FILE_WITHOUT_VECTORS!;
const fieldToEmbed = process.env.FIELD_TO_EMBED! || "description";
const newEmbeddedField = process.env.EMBEDDED_FIELD! || process.env.AZURE_OPENAI_EMBEDDING_MODEL!;
const batchSize = parseInt(process.env.EMBEDDING_BATCH_SIZE || '16', 10);
const usePasswordless = process.env.USE_PASSWORDLESS === 'true';
const modelName = process.env.AZURE_OPENAI_EMBEDDING_MODEL || 'text-embedding-ada-002';

// Create embedding configuration
const embeddingConfig: EmbeddingConfig = {
    fieldToEmbed,
    newEmbeddedField,
    batchSize,
    modelName
};

// File paths
const inputFilePath = path.join(__dirname, "..", dataWithoutVectors);
const outputFilePath = path.join(__dirname, "..", dataWithVectors);

console.log('🎯 Embedding Configuration:');
console.log(`  Model: ${modelName}`);
console.log(`  Field to embed: ${fieldToEmbed}`);
console.log(`  New embedded field: ${newEmbeddedField}`);
console.log(`  Batch size: ${batchSize}`);
console.log(`  Use passwordless: ${usePasswordless}`);

async function main() {
    // Handle process termination signals for graceful shutdown
    let isShuttingDown = false;
    const gracefulShutdown = async (signal: string) => {
        if (isShuttingDown) return;
        isShuttingDown = true;
        console.log(`\n🚨 Received ${signal}. Shutting down gracefully...`);
        console.log('✅ Embedding process terminated');
        process.exit(0);
    };
    
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

    try {
        console.log('🚀 Starting embedding creation workflow...');
        
        // Run the complete embedding workflow
        const result = await createEmbeddingsWorkflow(
            embeddingConfig,
            inputFilePath,
            outputFilePath,
            usePasswordless
        );

        console.log('\n✅ Embedding creation completed successfully!');
        console.log(`📊 Summary:`);
        console.log(`  Input items: ${result.inputItems}`);
        console.log(`  Processed items: ${result.processedItems}`);
        console.log(`  Model used: ${result.modelUsed}`);
        console.log(`  Output file: ${result.outputFile}`);

    } catch (error) {
        console.error(`❌ Failed to create embeddings: ${(error as Error).message}`);
        process.exitCode = 1;
    } finally {
        console.log('🔌 Embedding process completed');
        process.exit(process.exitCode || 0);
    }
}

// Execute main function
main().catch(error => {
    console.error('❌ Unhandled error in embedding creation:', error);
    process.exit(1);
});