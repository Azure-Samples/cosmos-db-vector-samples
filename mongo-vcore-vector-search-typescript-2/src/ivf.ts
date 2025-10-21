import path from 'path';
import { 
    readFileReturnJson, 
    printSearchResults,
    completeVectorSearchWorkflow,
    createIVFIndexConfig,
    SearchConfig
} from './utils.js';

// ESM specific features - create __dirname equivalent
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const config: SearchConfig = {
    dbName: "Hotels2",
    collectionName: "Hotels_Search_2",
    indexName: "vectorIndex_ivf",
    dataFile: process.env.DATA_FILE_WITH_VECTORS!,
    batchSize: parseInt(process.env.LOAD_SIZE_BATCH! || '100', 10),
    embeddedField: process.env.EMBEDDED_FIELD!,
    embeddingDimensions: parseInt(process.env.EMBEDDING_DIMENSIONS!, 10),
    deployment: process.env.AZURE_OPENAI_EMBEDDING_MODEL!,
};

const query = "quintessential lodging near running trails, eateries, retail";

async function main() {
    try {
        // Read data from file
        const data = await readFileReturnJson(path.join(__dirname, "..", config.dataFile!));
        
        // Create IVF index configuration
        const ivfIndexConfig = createIVFIndexConfig(
            config.embeddingDimensions,
            10, // numLists
            'COS' // similarity
        );

        // Execute complete workflow
        const { insertSummary, vectorIndexSummary, searchResults } = await completeVectorSearchWorkflow(
            config,
            ivfIndexConfig,
            query,
            data,
            false, // usePasswordless
            5 // k (number of results)
        );

        // Print the results
        console.log('=== Search Results ===');
        console.log(searchResults);
        printSearchResults(insertSummary, vectorIndexSummary, searchResults);

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