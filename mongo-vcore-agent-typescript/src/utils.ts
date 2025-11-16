import { MongoClient, OIDCResponse, OIDCCallbackParams } from 'mongodb';
import { AzureOpenAI } from 'openai/index.js';
import { promises as fs } from "fs";
import { AccessToken, DefaultAzureCredential, TokenCredential, getBearerTokenProvider } from '@azure/identity';
import { Document } from '@langchain/core/documents';
import { AzureChatOpenAI } from '@langchain/openai';

// Define a type for JSON data
export type JsonData = Record<string, any>;

// ============================================================================
// RETRY AND QUOTA HANDLING UTILITIES
// ============================================================================

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
    maxRetries: number;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
    retryableStatusCodes: number[];
    respectRetryAfter?: boolean;  // Whether to respect server's Retry-After header
}

/**
 * Default retry configuration for Azure OpenAI operations
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxRetries: 5,
    initialDelayMs: 1000,      // Start with 1 second
    maxDelayMs: 60000,         // Cap at 60 seconds (even if server says longer)
    backoffMultiplier: 2,      // Exponential backoff
    retryableStatusCodes: [429, 503, 500, 502, 504], // Rate limit, service unavailable, server errors
    respectRetryAfter: true    // Honor server's Retry-After header
};

/**
 * Sleep utility for retry delays
 */
export async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay with jitter
 */
export function calculateBackoffDelay(
    attemptNumber: number,
    config: RetryConfig = DEFAULT_RETRY_CONFIG
): number {
    const exponentialDelay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attemptNumber);
    const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);
    // Add jitter (±25%) to prevent thundering herd
    const jitter = cappedDelay * (0.75 + Math.random() * 0.5);
    return Math.floor(jitter);
}

/**
 * Check if an error is retriable based on status code or error type
 */
export function isRetriableError(error: any, config: RetryConfig = DEFAULT_RETRY_CONFIG): boolean {
    // Check HTTP status codes
    if (error.status && config.retryableStatusCodes.includes(error.status)) {
        return true;
    }
    
    // Check error codes
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
        return true;
    }
    
    // Check for rate limit messages
    if (error.message && (
        error.message.includes('rate limit') ||
        error.message.includes('quota') ||
        error.message.includes('too many requests')
    )) {
        return true;
    }
    
    return false;
}

/**
 * Extract Retry-After header from error response (for 429 errors)
 */
export function getRetryAfterMs(error: any): number | null {
    if (!error.headers) return null;
    
    // Check for Retry-After header
    const retryAfter = error.headers.get?.('retry-after') || error.headers['retry-after'];
    if (!retryAfter) return null;
    
    // Parse as seconds or HTTP date
    const retryAfterNum = parseInt(retryAfter, 10);
    if (!isNaN(retryAfterNum)) {
        return retryAfterNum * 1000; // Convert seconds to milliseconds
    }
    
    // Try parsing as HTTP date
    const retryDate = new Date(retryAfter);
    if (!isNaN(retryDate.getTime())) {
        return Math.max(0, retryDate.getTime() - Date.now());
    }
    
    return null;
}

/**
 * Generic retry wrapper with exponential backoff and quota handling
 * 
 * @example
 * const result = await withRetry(
 *   () => chatClient.invoke({ input: "Hello" }),
 *   { maxRetries: 3, onRetry: (attempt, delay) => console.log(`Retry ${attempt} after ${delay}ms`) }
 * );
 */
export async function withRetry<T>(
    operation: () => Promise<T>,
    options: {
        config?: Partial<RetryConfig>;
        operationName?: string;
        onRetry?: (attempt: number, delay: number, error: any) => void;
    } = {}
): Promise<T> {
    const config: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...options.config };
    const operationName = options.operationName || 'Operation';
    
    let lastError: any;
    
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error: any) {
            lastError = error;
            
            // Don't retry on last attempt
            if (attempt === config.maxRetries) {
                console.error(`❌ ${operationName} failed after ${config.maxRetries} retries`);
                throw error;
            }
            
            // Check if error is retriable
            if (!isRetriableError(error, config)) {
                console.error(`❌ ${operationName} failed with non-retriable error:`, error.message);
                throw error;
            }
            
            // Calculate delay - respect Retry-After header if present and enabled
            let delay: number;
            const retryAfterMs = getRetryAfterMs(error);
            
            if (retryAfterMs !== null && config.respectRetryAfter) {
                // Server told us how long to wait
                delay = Math.min(retryAfterMs, config.maxDelayMs);
                if (retryAfterMs > config.maxDelayMs) {
                    console.warn(
                        `⚠️  Server requested ${(retryAfterMs / 1000).toFixed(0)}s wait, ` +
                        `but capping at ${(config.maxDelayMs / 1000).toFixed(0)}s`
                    );
                }
            } else {
                // Use exponential backoff
                delay = calculateBackoffDelay(attempt, config);
            }
            
            // Call onRetry callback if provided (for custom logging)
            if (options.onRetry) {
                options.onRetry(attempt + 1, delay, error);
            } else {
                // Default minimal logging only if no callback provided
                console.log(`⏳ Retry ${attempt + 1}: ${(delay / 1000).toFixed(0)}s`);
            }
            
            // Wait before retrying
            await sleep(delay);
        }
    }
    
    // Should never reach here, but TypeScript doesn't know that
    throw lastError;
}

export const AzureIdentityTokenCallback = async (params: OIDCCallbackParams, credential: TokenCredential): Promise<OIDCResponse> => {
    const tokenResponse: AccessToken | null = await credential.getToken(['https://ossrdbms-aad.database.windows.net/.default']);
    return {
        accessToken: tokenResponse?.token || '',
        expiresInSeconds: (tokenResponse?.expiresOnTimestamp || 0) - Math.floor(Date.now() / 1000)
    };
};
export function getClients(): { aiClient: AzureOpenAI; dbClient: MongoClient } {
    const apiKey = process.env.AZURE_OPENAI_API_KEY!;
    const apiVersion = process.env.AZURE_OPENAI_EMBEDDING_API_VERSION!;
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT!;
    const deployment = process.env.AZURE_OPENAI_EMBEDDING_MODEL!;
    const aiClient = new AzureOpenAI({
        apiKey,
        apiVersion,
        endpoint,
        deployment
    });
    const dbClient = new MongoClient(process.env.MONGO_CONNECTION_STRING!, {
        // Performance optimizations
        maxPoolSize: 10,         // Limit concurrent connections
        minPoolSize: 1,          // Maintain at least one connection
        maxIdleTimeMS: 30000,    // Close idle connections after 30 seconds
        connectTimeoutMS: 30000, // Connection timeout
        socketTimeoutMS: 120000, // Reduced from 6 minutes to 2 minutes
        serverSelectionTimeoutMS: 30000, // Add server selection timeout
        writeConcern: {          // Optimize write concern for bulk operations
            w: 1,                // Acknowledge writes after primary has written
            j: false             // Don't wait for journal commit
        }
    });

    return { aiClient, dbClient };
}

export function getClientsPasswordless(): { aiClient: AzureOpenAI | null; dbClient: MongoClient | null } {
    let aiClient: AzureOpenAI | null = null;
    let dbClient: MongoClient | null = null;

    // For Azure OpenAI with DefaultAzureCredential
    const apiVersion = process.env.AZURE_OPENAI_EMBEDDING_API_VERSION!;
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT!;
    const deployment = process.env.AZURE_OPENAI_EMBEDDING_MODEL!;

    if (apiVersion && endpoint && deployment) {
        const credential = new DefaultAzureCredential();
        const scope = "https://cognitiveservices.azure.com/.default";
        const azureADTokenProvider = getBearerTokenProvider(credential, scope);
        aiClient = new AzureOpenAI({
            apiVersion,
            endpoint,
            deployment,
            azureADTokenProvider
        });
    }

    // For Cosmos DB with DefaultAzureCredential
    const clusterName = process.env.MONGO_CLUSTER_NAME!;

    if (clusterName) {
        const credential = new DefaultAzureCredential();

        dbClient = new MongoClient(
            `mongodb+srv://${clusterName}.mongocluster.cosmos.azure.com/`, {
            connectTimeoutMS: 30000,
            tls: true,
            retryWrites: true,
            authMechanism: 'MONGODB-OIDC',
            authMechanismProperties: {
                OIDC_CALLBACK: (params: OIDCCallbackParams) => AzureIdentityTokenCallback(params, credential),
                ALLOWED_HOSTS: ['*.azure.com']
            }
        }
        );
    }

    return { aiClient, dbClient };
}

/**
 * Get chat client for LangChain agents with API key authentication
 * Includes retry configuration for quota/rate limit handling
 */
export function getChatClient(maxRetries: number = 5): AzureChatOpenAI {
    const apiKey = process.env.AZURE_OPENAI_API_KEY!;
    const apiVersion = process.env.AZURE_OPENAI_CHAT_API_VERSION!;
    const instanceName = process.env.AZURE_OPENAI_API_INSTANCE_NAME!;
    const deployment = process.env.AZURE_OPENAI_CHAT_MODEL!;
    
    // Construct custom subdomain endpoint (required for LangChain)
    const endpoint = `https://${instanceName}.openai.azure.com/`;

    return new AzureChatOpenAI({
        azureOpenAIApiKey: apiKey,
        azureOpenAIApiVersion: apiVersion,
        azureOpenAIEndpoint: endpoint,
        azureOpenAIApiInstanceName: instanceName,
        azureOpenAIApiDeploymentName: deployment,
        maxRetries,              // Configure retry behavior with exponential backoff
        timeout: 60000,          // 60 second timeout per request
        maxConcurrency: 1,       // Limit to 1 concurrent request to prevent quota exhaustion
    });
}

/**
 * Get chat client for LangChain agents with passwordless authentication
 * Includes retry configuration for quota/rate limit handling
 * 
 * IMPORTANT: Passwordless authentication requires the Azure OpenAI resource to have
 * a custom subdomain enabled. If your resource uses the regional endpoint format
 * (e.g., swedencentral.api.cognitive.microsoft.com), passwordless auth will NOT work.
 * 
 * To enable custom subdomain:
 * 1. The resource must be created with --custom-domain flag, OR
 * 2. You must use API key authentication instead (set USE_PASSWORDLESS=false)
 */
export function getChatClientPasswordless(maxRetries: number = 5): AzureChatOpenAI | null {
    const apiVersion = process.env.AZURE_OPENAI_CHAT_API_VERSION!;
    const instanceName = process.env.AZURE_OPENAI_API_INSTANCE_NAME!;
    const deployment = process.env.AZURE_OPENAI_CHAT_MODEL!;

    if (!apiVersion || !instanceName || !deployment) {
        console.warn('⚠️  Missing required environment variables for passwordless chat client');
        return null;
    }

    const credential = new DefaultAzureCredential();
    const scope = "https://cognitiveservices.azure.com/.default";
    const azureADTokenProvider = getBearerTokenProvider(credential, scope);

    // For token auth, MUST provide BOTH the custom subdomain endpoint AND instance name
    const endpoint = `https://${instanceName}.openai.azure.com/`;
    
    console.log(`🔐 Attempting passwordless auth to: ${endpoint}`);
    
    return new AzureChatOpenAI({
        azureOpenAIApiVersion: apiVersion,
        azureOpenAIApiInstanceName: instanceName,
        azureOpenAIEndpoint: endpoint,
        azureOpenAIApiDeploymentName: deployment,
        azureADTokenProvider,
        maxRetries,              // Configure retry behavior with exponential backoff
        timeout: 60000,          // 60 second timeout per request
        maxConcurrency: 1,       // Limit to 1 concurrent request to prevent quota exhaustion
    });
}

export async function readFileReturnJson(filePath: string): Promise<JsonData[]> {

    console.log(`Reading JSON file from ${filePath}`);

    const fileAsString = await fs.readFile(filePath, "utf-8");
    return JSON.parse(fileAsString);
}
export async function writeFileJson(filePath: string, jsonData: JsonData): Promise<void> {
    const jsonString = JSON.stringify(jsonData, null, 2);
    await fs.writeFile(filePath, jsonString, "utf-8");

    console.log(`Wrote JSON file to ${filePath}`);
}
export async function insertData(config, collection, data) {
    console.log(`Processing in batches of ${config.batchSize}...`);
    const totalBatches = Math.ceil(data.length / config.batchSize);

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < totalBatches; i++) {
        const start = i * config.batchSize;
        const end = Math.min(start + config.batchSize, data.length);
        const batch = data.slice(start, end);

        try {
            const result = await collection.insertMany(batch, { ordered: false });
            inserted += result.insertedCount || 0;
            console.log(`Batch ${i + 1} complete: ${result.insertedCount} inserted`);
        } catch (error: any) {
            if (error?.writeErrors) {
                // Some documents may have been inserted despite errors
                console.error(`Error in batch ${i + 1}: ${error?.writeErrors.length} failures`);
                failed += error?.writeErrors.length;
                inserted += batch.length - error?.writeErrors.length;
            } else {
                console.error(`Error in batch ${i + 1}:`, error);
                failed += batch.length;
            }
        }

        // Small pause between batches to reduce resource contention
        if (i < totalBatches - 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    const indexColumns = [
        "HotelId",
        "Category",
        "Description",
        "Description_fr"
    ];
    for (const col of indexColumns) {
        const indexSpec = {};
        indexSpec[col] = 1; // Ascending index
        await collection.createIndex(indexSpec);
    }

    return { total: data.length, inserted, updated, skipped, failed };
}

export function printSearchResults(insertSummary, indexSummary, searchResults) {


    if (!searchResults || searchResults.length === 0) {
        console.log('No search results found.');
        return;
    }

    searchResults.map((result, index) => {

        const { document, score } = result as any;

        console.log(`${index + 1}. HotelName: ${document.HotelName}, Score: ${score.toFixed(4)}`);
        //console.log(`   Description: ${document.Description}`);
    });

}

// Define types for vector index configurations
export type VectorIndexType = 'vector-ivf' | 'vector-hnsw' | 'vector-diskann';

export interface BaseVectorIndexConfig {
    kind: VectorIndexType;
    similarity: 'COS' | 'L2' | 'IP';
    dimensions: number;
}

export interface IVFIndexConfig extends BaseVectorIndexConfig {
    kind: 'vector-ivf';
    numLists: number;
}

export interface HNSWIndexConfig extends BaseVectorIndexConfig {
    kind: 'vector-hnsw';
    m: number;
    efConstruction: number;
}

export interface DiskANNIndexConfig extends BaseVectorIndexConfig {
    kind: 'vector-diskann';
    maxDegree: number;
    lBuild: number;
}

export type VectorIndexConfig = IVFIndexConfig | HNSWIndexConfig | DiskANNIndexConfig;

export interface SearchConfig {
    dbName: string;
    collectionName: string;
    indexName: string;
    embeddedField: string;
    embeddingDimensions: number;
    deployment: string;
    batchSize?: number;
    dataFile?: string;
}

// ============================================================================
// Agent Configuration Types
// ============================================================================

export interface CollectionConfig {
    name: string;
    indexName: string;
    algorithm: VectorIndexType;
    description: string;
}

export interface AgentConfig {
    databaseName: string;
    maxResults: number;
    similarityThreshold: number;
    batchSize: number;
    embeddedField: string;
    embeddingDimensions: number;
    deployment: string;
    usePasswordless: boolean;
    collections: Array<CollectionConfig>;
    activeCollectionIndex: number;
}

/**
 * Creates a default agent configuration from environment variables
 */
export function createAgentConfig(): AgentConfig {
    return {
        // Database configuration
        databaseName: process.env.MONGO_DB_NAME || 'Hotels26',
        
        // Search parameters
        maxResults: parseInt(process.env.MAX_SEARCH_RESULTS || '5'),
        similarityThreshold: parseFloat(process.env.SIMILARITY_THRESHOLD || '0.7'),
        
        // Vector configuration
        batchSize: parseInt(process.env.LOAD_SIZE_BATCH || '100', 10),
        embeddedField: process.env.EMBEDDED_FIELD || 'text_embedding_ada_002',
        embeddingDimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || '1536', 10),
        deployment: process.env.AZURE_OPENAI_EMBEDDING_MODEL || 'text-embedding-ada-002',
        
        // Authentication
        usePasswordless: process.env.USE_PASSWORDLESS === 'true',
        
        // Available collections with different vector index algorithms
        collections: [
            {
                name: 'Hotels_Search_27',
                indexName: 'vectorIndex_ivf',
                algorithm: 'vector-ivf',
                description: 'IVF (Inverted File) - Good for large datasets with batch queries'
            }
            // Additional algorithms can be added here when available
        ],
        
        // Active collection index (0 = IVF only)
        activeCollectionIndex: 0
    };
}

/**
 * Enhanced vector search with formatted results for agents
 */
export async function performAgentVectorSearch(
    aiClient: AzureOpenAI,
    collection: any,
    query: string,
    config: SearchConfig,
    maxResults: number = 5
): Promise<{
    searchResults: [Document, number][];
    formattedResults: string;
    metadata: any;
}> {
    // Perform the basic vector search
    const rawSearchResults = await performVectorSearch(
        aiClient,
        collection,
        query,
        config,
        maxResults
    );

    // Convert MongoDB results to LangChain Document format
    const searchResults = convertToDocumentFormat(rawSearchResults);
    
    // Log result count
    console.log(`✅ Found ${searchResults.length} result${searchResults.length !== 1 ? 's' : ''}`);

    // Format results for display using shared utility
    const formattedResults = formatSearchResults(searchResults);

    // Calculate metadata from the converted results
    const scores = searchResults.map(([_, score]) => score);
    const metadata = {
        totalResults: searchResults.length,
        maxScore: scores.length > 0 ? Math.max(...scores) : 0,
        minScore: scores.length > 0 ? Math.min(...scores) : 0,
        averageScore: scores.length > 0 ? 
            scores.reduce((sum, score) => sum + score, 0) / scores.length : 0,
        embeddingField: config.embeddedField,
        dimensions: config.embeddingDimensions
    };

    return {
        searchResults,
        formattedResults,
        metadata
    };
}

/**
 * Complete hotel search workflow for LangChain tools
 * Handles the full lifecycle: client initialization, connection, search, and cleanup
 * Returns JSON string suitable for LangChain tool responses
 */
export async function executeHotelSearchWorkflow(
    agentConfig: AgentConfig,
    query: string,
    maxResults: number = 5
): Promise<string> {
    console.log(`   🔍 Tool: search_hotels - Starting workflow`);
    console.log(`      Query: "${query}"`);
    console.log(`      Max results: ${maxResults}`);
    
    // Get database clients
    console.log(`      Step 1: Getting database clients...`);
    const { aiClient, dbClient } = agentConfig.usePasswordless ? 
        getClientsPasswordless() : getClients();
    
    if (!aiClient || !dbClient) {
        console.log(`      ❌ Failed to initialize clients`);
        return JSON.stringify({ 
            error: 'Failed to initialize clients. Check configuration.' 
        });
    }
    console.log(`      ✅ Clients initialized`);
    
    try {
        console.log(`      Step 2: Connecting to MongoDB...`);
        await dbClient.connect();
        console.log(`      ✅ Connected to MongoDB`);
        
        // Get active collection configuration
        const activeCollection = agentConfig.collections[agentConfig.activeCollectionIndex];
        console.log(`      Step 3: Using collection "${activeCollection.name}"`);
        
        // Create search configuration
        const searchConfig: SearchConfig = {
            dbName: agentConfig.databaseName,
            collectionName: activeCollection.name,
            indexName: activeCollection.indexName,
            embeddedField: agentConfig.embeddedField,
            embeddingDimensions: agentConfig.embeddingDimensions,
            deployment: agentConfig.deployment
        };
        
        // Get database collection
        const db = dbClient.db(agentConfig.databaseName);
        const collection = db.collection(activeCollection.name);
        console.log(`      ✅ Collection ready`);
        
        // Perform enhanced vector search
        console.log(`      Step 4: Performing vector search...`);
        const { searchResults, formattedResults, metadata } = await performAgentVectorSearch(
            aiClient,
            collection,
            query,
            searchConfig,
            Math.min(maxResults, 10)
        );
        console.log(`      ✅ Vector search completed: ${searchResults.length} results found`);
        console.log(`      📊 Score range: ${metadata.minScore.toFixed(3)} - ${metadata.maxScore.toFixed(3)}`);
        
        // Return results in JSON format for the agent
        const response = JSON.stringify({
            searchQuery: query,
            algorithm: activeCollection.algorithm,
            totalResults: searchResults.length,
            results: formattedResults,
            searchMetrics: metadata
        }, null, 2);
        
        console.log(`      ✅ Returning ${response.length} bytes to agent\n`);
        return response;
        
    } catch (error) {
        console.error('\n      ' + '='.repeat(70));
        console.error('      ❌ TOOL EXECUTION FAILED: search_hotels');
        console.error('      ' + '='.repeat(70));
        console.error(`      🔧 Tool: search_hotels`);
        console.error(`      📍 Query: "${query}"`);
        console.error(`      💥 Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        console.error(`      🔍 Type: ${(error as any)?.constructor?.name || 'Unknown'}`);
        
        if ((error as Error)?.stack) {
            console.error('      📚 Stack:');
            (error as Error).stack?.split('\n').slice(0, 5).forEach(line => {
                console.error(`         ${line}`);
            });
        }
        console.error('      ' + '='.repeat(70) + '\n');
        
        return JSON.stringify({
            error: 'Search failed',
            message: error instanceof Error ? error.message : 'Unknown error',
            type: (error as any)?.constructor?.name || 'Unknown'
        });
    } finally {
        try {
            await dbClient.close();
            console.log(`      ✅ MongoDB connection closed\n`);
        } catch (closeError) {
            console.error('      ❌ Error closing database connection:', closeError);
        }
    }
}

/**
 * Search performance analysis workflow for LangChain tools
 * Analyzes search quality and provides insights about the results
 * 
 * @deprecated This function is no longer needed. The search_hotels tool already
 * returns searchMetrics with all analysis data (scores, averages, counts).
 * Let the LLM analyze these metrics directly instead of performing a duplicate search.
 * 
 * Use executeHotelSearchWorkflow() instead - it returns both results and metrics.
 */
export async function executeSearchAnalysisWorkflow(
    agentConfig: AgentConfig,
    query: string,
    sampleSize: number = 5
): Promise<string> {
    // Minimal logging - only log if DEBUG env var is set
    if (process.env.DEBUG === 'true') {
        console.log(`📊 Search Analysis: "${query}"`);
    }
    
    // Get database clients
    const { aiClient, dbClient } = agentConfig.usePasswordless ? 
        getClientsPasswordless() : getClients();
    
    if (!aiClient || !dbClient) {
        return JSON.stringify({ error: 'Failed to initialize clients' });
    }
    
    try {
        await dbClient.connect();
        
        const activeCollection = agentConfig.collections[agentConfig.activeCollectionIndex];
        
        const searchConfig: SearchConfig = {
            dbName: agentConfig.databaseName,
            collectionName: activeCollection.name,
            indexName: activeCollection.indexName,
            embeddedField: agentConfig.embeddedField,
            embeddingDimensions: agentConfig.embeddingDimensions,
            deployment: agentConfig.deployment
        };
        
        const db = dbClient.db(agentConfig.databaseName);
        const collection = db.collection(activeCollection.name);
        
        const { searchResults, formattedResults, metadata } = await performAgentVectorSearch(
            aiClient,
            collection,
            query,
            searchConfig,
            sampleSize
        );
        
        return JSON.stringify({
            query,
            algorithmUsed: activeCollection.algorithm,
            algorithmDescription: activeCollection.description,
            performance: {
                resultCount: searchResults.length,
                scoreDistribution: {
                    highest: metadata.maxScore,
                    lowest: metadata.minScore,
                    average: metadata.averageScore,
                    range: metadata.maxScore - metadata.minScore
                },
                qualityAssessment: metadata.maxScore > 0.8 ? 'Excellent' : 
                                 metadata.maxScore > 0.7 ? 'Good' : 
                                 metadata.maxScore > 0.6 ? 'Fair' : 'Poor'
            },
            insights: {
                recommendation: "IVF algorithm provides good balance of speed and accuracy for large datasets",
                aboutScores: "Higher relevance scores indicate better semantic similarity to your query"
            }
        }, null, 2);
        
    } catch (error) {
        return JSON.stringify({
            error: 'Analysis failed',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    } finally {
        try {
            await dbClient.close();
        } catch (closeError) {
            console.error('❌ Error closing database connection:', closeError);
        }
    }
}

/**
 * Creates a vector index on a MongoDB collection
 */
export async function createVectorIndex(
    db: any,
    config: SearchConfig,
    vectorIndexConfig: VectorIndexConfig
): Promise<any> {
    const indexOptions = {
        createIndexes: config.collectionName,
        indexes: [
            {
                name: config.indexName,
                key: {
                    [config.embeddedField]: 'cosmosSearch'
                },
                cosmosSearchOptions: vectorIndexConfig
            }
        ]
    };
    
    const vectorIndexSummary = await db.command(indexOptions);
    console.log('Created vector index:', config.indexName);
    return vectorIndexSummary;
}

/**
 * Performs vector similarity search
 */
export async function performVectorSearch(
    aiClient: AzureOpenAI,
    collection: any,
    query: string,
    config: SearchConfig,
    k: number = 5
): Promise<any[]> {
    // Create embedding for the query
    const createEmbeddedForQueryResponse = await aiClient.embeddings.create({
        model: config.deployment,
        input: [query]
    });

    // Perform the vector similarity search
    const searchResults = await collection.aggregate([
        {
            $search: {
                cosmosSearch: {
                    vector: createEmbeddedForQueryResponse.data[0].embedding,
                    path: config.embeddedField,
                    k: k
                },
                returnStoredSource: true
            }
        },
        {
            $project: {
                score: {
                    $meta: "searchScore"
                },
                // Only include essential fields - exclude vector embeddings and unnecessary data
                // This dramatically reduces payload size sent to LLM (~12KB per doc reduced to ~1KB)
                document: {
                    HotelId: "$HotelId",
                    HotelName: "$HotelName",
                    Description: "$Description",
                    Category: "$Category",
                    Tags: "$Tags",
                    ParkingIncluded: "$ParkingIncluded",
                    LastRenovationDate: "$LastRenovationDate",
                    Rating: "$Rating",
                    Address: "$Address"
                }
            }
        }
    ]).toArray();

    // Calculate approximate size of results (for debugging/optimization)
    const resultSize = JSON.stringify(searchResults).length;
    console.log(`📦 Result payload size: ${(resultSize / 1024).toFixed(2)} KB (${searchResults.length} documents)`);

    return searchResults;
}

/**
 * Complete vector search workflow: setup collection, insert data, create index, and search
 */
export async function completeVectorSearchWorkflow(
    config: SearchConfig,
    vectorIndexConfig: VectorIndexConfig,
    query: string,
    data?: JsonData[],
    usePasswordless: boolean = false,
    k: number = 5
): Promise<{
    insertSummary: any;
    vectorIndexSummary: any;
    searchResults: any[];
}> {
    const { aiClient, dbClient } = usePasswordless ? getClientsPasswordless() : getClients();

    if (!aiClient) {
        throw new Error('AI client is not configured. Please check your environment variables.');
    }
    if (!dbClient) {
        throw new Error('Database client is not configured. Please check your environment variables.');
    }

    try {
        await dbClient.connect();
        const db = dbClient.db(config.dbName);
        
        // Create or get collection
        const collection = await db.createCollection(config.collectionName);
        console.log(`In ${config.dbName} created collection:`, config.collectionName);

        // Insert data if provided
        let insertSummary: any = null;
        if (data && data.length > 0) {
            insertSummary = await insertData(config, collection, data);
        }

        // Create vector index
        const vectorIndexSummary = await createVectorIndex(db, config, vectorIndexConfig);

        // Perform search
        const searchResults = await performVectorSearch(aiClient, collection, query, config, k);

        return {
            insertSummary,
            vectorIndexSummary,
            searchResults
        };

    } finally {
        console.log('Closing database connection...');
        if (dbClient) await dbClient.close();
        console.log('Database connection closed');
    }
}

/**
 * Helper function to create IVF vector index configuration
 */
export function createIVFIndexConfig(
    dimensions: number,
    numLists: number = 10,
    similarity: 'COS' | 'L2' | 'IP' = 'COS'
): IVFIndexConfig {
    return {
        kind: 'vector-ivf',
        numLists,
        similarity,
        dimensions
    };
}

/**
 * Helper function to create HNSW vector index configuration
 */
export function createHNSWIndexConfig(
    dimensions: number,
    m: number = 16,
    efConstruction: number = 64,
    similarity: 'COS' | 'L2' | 'IP' = 'COS'
): HNSWIndexConfig {
    return {
        kind: 'vector-hnsw',
        m,
        efConstruction,
        similarity,
        dimensions
    };
}

/**
 * Helper function to create DiskANN vector index configuration
 */
export function createDiskANNIndexConfig(
    dimensions: number,
    maxDegree: number = 20,
    lBuild: number = 10,
    similarity: 'COS' | 'L2' | 'IP' = 'COS'
): DiskANNIndexConfig {
    return {
        kind: 'vector-diskann',
        maxDegree,
        lBuild,
        similarity,
        dimensions
    };
}

// ============================================================================
// EMBEDDING CREATION FUNCTIONS
// ============================================================================

/**
 * Configuration for embedding creation
 */
export interface EmbeddingConfig {
    fieldToEmbed: string;
    newEmbeddedField: string;
    batchSize?: number;
    modelName?: string;
    maxEmbeddings?: number;
}

/**
 * Default delay function for rate limiting
 */
async function delay(ms: number = 200): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Creates embeddings for a batch of text inputs using Azure OpenAI
 * 
 * @param client - Azure OpenAI client instance
 * @param modelName - Name of the embedding model to use (e.g., 'text-embedding-ada-002')
 * @param inputItems - Array of text strings to create embeddings for
 * @returns Array of embedding objects with vector data
 */
export async function createEmbeddings(
    client: AzureOpenAI, 
    modelName: string, 
    inputItems: string[]
): Promise<any[]> {
    const response = await client.embeddings.create({
        model: modelName,
        input: inputItems
    });

    if (!response.data || response.data.length === 0) {
        throw new Error(`No embedding data returned for model: ${modelName}`);
    }
    return response.data;
}

/**
 * Processes a batch of items and adds embeddings to them
 * 
 * @param client - Azure OpenAI client instance
 * @param embeddingConfig - Configuration for embedding creation
 * @param items - Array of items to process
 * @returns Array of items with embeddings added
 */
export async function processEmbeddingBatch<T extends JsonData>(
    client: AzureOpenAI,
    embeddingConfig: EmbeddingConfig,
    items: T[]
): Promise<T[]> {
    if (!Array.isArray(items) || items.length === 0) {
        throw new Error("Items must be a non-empty array");
    }

    if (!embeddingConfig.fieldToEmbed) {
        throw new Error("Field to embed must be specified");
    }

    const itemsWithEmbeddings: T[] = [];
    const batchSize = embeddingConfig.batchSize || 16;
    const maxEmbeddings = embeddingConfig.maxEmbeddings || items.length;
    const modelName = embeddingConfig.modelName || process.env.AZURE_OPENAI_EMBEDDING_MODEL || 'text-embedding-ada-002';

    console.log(`🔄 Processing embeddings with model: ${modelName}`);
    console.log(`📊 Batch size: ${batchSize}, Max items: ${maxEmbeddings}`);

    // Process in batches to avoid rate limits and memory issues
    for (let i = 0; i < Math.min(maxEmbeddings, items.length); i += batchSize) {
        const batchEnd = Math.min(i + batchSize, items.length, maxEmbeddings);
        console.log(`Processing batch: ${i + 1} to ${batchEnd} (of ${Math.min(maxEmbeddings, items.length)} items)`);

        const batchItems = items.slice(i, batchEnd);
        const textsToEmbed = batchItems.map(item => {
            if (!item[embeddingConfig.fieldToEmbed]) {
                console.warn(`Item is missing the field to embed: ${embeddingConfig.fieldToEmbed}`);
                return ""; // Provide a fallback value to prevent API errors
            }
            return item[embeddingConfig.fieldToEmbed];
        });

        try {
            const embeddings = await createEmbeddings(client, modelName, textsToEmbed);

            embeddings.forEach((embeddingData, index) => {
                const originalItem = batchItems[index];
                const newItem = {
                    ...originalItem,
                    [embeddingConfig.newEmbeddedField]: embeddingData.embedding
                } as T;
                itemsWithEmbeddings.push(newItem);
            });

            // Add a small delay between batches to avoid rate limiting
            if (batchEnd < Math.min(maxEmbeddings, items.length)) {
                await delay();
            }
        } catch (error) {
            console.error(`❌ Error generating embeddings for batch ${i + 1}:`, error);
            throw error;
        }
    }

    console.log(`✅ Successfully processed ${itemsWithEmbeddings.length} items with embeddings`);
    return itemsWithEmbeddings;
}

/**
 * Complete embedding workflow: read data, create embeddings, and save results
 * 
 * @param config - Embedding configuration
 * @param inputFilePath - Path to input JSON file (without embeddings)
 * @param outputFilePath - Path to output JSON file (with embeddings)
 * @param usePasswordless - Whether to use passwordless authentication
 * @returns Summary of the embedding creation process
 */
export async function createEmbeddingsWorkflow(
    config: EmbeddingConfig,
    inputFilePath: string,
    outputFilePath: string,
    usePasswordless: boolean = false
): Promise<{
    inputItems: number;
    processedItems: number;
    modelUsed: string;
    outputFile: string;
}> {
    console.log('🚀 Starting embedding creation workflow...');
    console.log(`📁 Input file: ${inputFilePath}`);
    console.log(`📁 Output file: ${outputFilePath}`);
    
    try {
        // Get AI client
        const { aiClient } = usePasswordless ? getClientsPasswordless() : getClients();
        
        if (!aiClient) {
            throw new Error('AI client is not configured. Please check your environment variables.');
        }

        // Read input data
        const data = await readFileReturnJson(inputFilePath);
        console.log(`📖 Read ${data.length} items from input file`);

        const modelName = config.modelName || process.env.AZURE_OPENAI_EMBEDDING_MODEL || 'text-embedding-ada-002';

        // Process embeddings
        const itemsWithEmbeddings = await processEmbeddingBatch(aiClient, config, data);

        // Write output data
        await writeFileJson(outputFilePath, itemsWithEmbeddings);
        console.log(`💾 Saved ${itemsWithEmbeddings.length} items with embeddings to: ${outputFilePath}`);

        return {
            inputItems: data.length,
            processedItems: itemsWithEmbeddings.length,
            modelUsed: modelName,
            outputFile: outputFilePath
        };

    } catch (error) {
        console.error(`❌ Failed to create embeddings: ${(error as Error).message}`);
        throw error;
    }
}

// ============================================================================
// LangChain Document Conversion Utilities
// ============================================================================

/**
 * Converts raw MongoDB vector search results to LangChain Document format.
 * This utility enables compatibility between MongoDB-based vector search and LangChain's
 * Document type, allowing both implementations to share the same formatting logic.
 * 
 * @param rawResults - Array of MongoDB search results with document and score properties
 * @returns Array of [Document, score] tuples compatible with LangChain
 * 
 * @example
 * const rawResults = await performVectorSearch(aiClient, collection, query, config, 5);
 * const documents = convertToDocumentFormat(rawResults);
 * // documents is now [Document, number][] format
 */
export function convertToDocumentFormat(
    rawResults: any[]
): [Document, number][] {
    return rawResults.map(result => [
        new Document({
            pageContent: result.document.Description || '',
            metadata: result.document  // All hotel fields stored in metadata
        }),
        result.score
    ]);
}

/**
 * Formats search results into a human-readable string output.
 * Works with both MongoDB raw results and LangChain Document format.
 * 
 * @param results - Array of [Document, number] tuples from vector search
 * @returns Formatted string with numbered results showing hotel details and similarity scores
 * 
 * @example
 * ```typescript
 * const results = await vectorSearch(query, embeddings);
 * const formatted = formatSearchResults(results);
 * console.log(formatted);
 * // Output:
 * // 1. Fancy Stay (Score: 0.857)
 * //    Description: A luxurious hotel...
 * //    Tags: pool, restaurant, concierge
 * ```
 */
export function formatSearchResults(results: [Document, number][]): string {
    return results.map((result, index) => {
        const [doc, score] = result;
        const metadata = doc.metadata;
        
        return `${index + 1}. ${metadata.HotelName} (Score: ${score.toFixed(3)})
   Description: ${doc.pageContent}
   Tags: ${metadata.Tags?.join(', ') || 'N/A'}`;
    }).join('\n\n');
}
