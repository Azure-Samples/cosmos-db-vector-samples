import path from 'path';
import { 
    readFileReturnJson, 
    printSearchResults,
    completeVectorSearchWorkflow,
    createDiskANNIndexConfig,
    SearchConfig
} from './utils.js';

// ESM specific features - create __dirname equivalent
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const config: SearchConfig = {
    dbName: "Hotels2",
    collectionName: "Hotels_Search_DiskANN",
    indexName: "vectorIndex_diskann",
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
        
        // Create DiskANN index configuration
        const diskannIndexConfig = createDiskANNIndexConfig(
            config.embeddingDimensions,
            20, // maxDegree - edges per node (20-2048)
            10, // lBuild - candidate neighbors evaluated (10-500)
            'COS' // similarity
        );

        // Execute complete workflow
        const { insertSummary, vectorIndexSummary, searchResults } = await completeVectorSearchWorkflow(
            config,
            diskannIndexConfig,
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