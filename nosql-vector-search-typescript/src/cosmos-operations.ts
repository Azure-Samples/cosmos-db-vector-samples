/**
 * Azure Cosmos DB Operations Module
 * 
 * This module contains all Cosmos DB specific operations including:
 * - Client creation and authentication
 * - Error parsing and handling
 * - Document validation and preparation
 * - Resilient bulk insert operations with retry logic
 * - Database and container management
 * - Circuit breaker implementation for educational purposes
 */
import { Container, CosmosClient } from '@azure/cosmos';
import { AzureOpenAI } from "openai";
import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";
import { v4 as uuidv4 } from 'uuid';
import { MetricsCollector, Logger } from './metrics.js';
import {
  InsertConfig,
  DEFAULT_INSERT_CONFIG,
  CircuitBreakerOptions,
  FailedDocument,
  ErrorDetails,
  InsertResult,
  JsonData
} from './interfaces.js';

// -------------------------------------------
// Client Creation Functions
// -------------------------------------------

export function getClients(): { aiClient: AzureOpenAI | null; dbClient: CosmosClient | null } {
    let aiClient: AzureOpenAI | null = null;
    let dbClient: CosmosClient | null = null;

    const apiKey = process.env.AZURE_OPENAI_EMBEDDING_KEY!;
    const apiVersion = process.env.AZURE_OPENAI_EMBEDDING_API_VERSION!;
    const endpoint = process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT!;
    const deployment = process.env.AZURE_OPENAI_EMBEDDING_MODEL!;

    if (apiKey && apiVersion && endpoint && deployment) {
        aiClient = new AzureOpenAI({
            apiKey,
            apiVersion,
            endpoint,
            deployment
        });
    }

    // Cosmos DB connection string or endpoint/key
    // You may need to use endpoint and key separately for CosmosClient
    const cosmosEndpoint = process.env.COSMOS_ENDPOINT!;
    const cosmosKey = process.env.COSMOS_KEY!;

    if (cosmosEndpoint && cosmosKey) {
        dbClient = new CosmosClient({ endpoint: cosmosEndpoint, key: cosmosKey });
    }

    return { aiClient, dbClient };
}

/**
 * Get Azure OpenAI and Cosmos DB clients using passwordless authentication (managed identity)
 * This function uses DefaultAzureCredential for authentication instead of API keys
 * 
 * @returns Object containing AzureOpenAI and CosmosClient instances or null if configuration is missing
 */
export function getClientsPasswordless(): { aiClient: AzureOpenAI | null; dbClient: CosmosClient | null } {
    let aiClient: AzureOpenAI | null = null;
    let dbClient: CosmosClient | null = null;

    // For Azure OpenAI with DefaultAzureCredential
    const apiVersion = process.env.AZURE_OPENAI_EMBEDDING_API_VERSION!;
    const endpoint = process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT!;
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
    const cosmosEndpoint = process.env.COSMOS_ENDPOINT!;

    if (cosmosEndpoint) {
        const credential = new DefaultAzureCredential();

        dbClient = new CosmosClient({ 
            endpoint: cosmosEndpoint,
            aadCredentials: credential // Use DefaultAzureCredential instead of key
        });
    }

    return { aiClient, dbClient };
}

/**
 * Retry Resiliency implementation for Azure Cosmos DB operations
 * 
 * Handles scenarios where Azure SDK doesn't provide automatic retry:
 * - 403 Forbidden: Transient auth token issues (per Azure guidance: "Optional" retry)
 * - Custom business logic failures that may be transient
 * - Application-level circuit breaking for cascading failure prevention
 * 
 * This complements Azure Cosmos DB SDK's built-in retry for:
 * - 408 Request Timeout, 410 Gone, 429 Rate Limiting, 449 Retry With, 503 Service Unavailable
 * 
 * Based on official Azure Cosmos DB NoSQL retry guidance documentation.
 */
export class RetryResiliency {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly options: CircuitBreakerOptions;
  private readonly failures: boolean[] = [];

  constructor(options: CircuitBreakerOptions) {
    this.options = options;
    // Initialize failures array with falses (no failures)
    this.failures = Array(options.rollingWindowSize).fill(false);
  }

  /**
   * Record a successful operation
   */
  public recordSuccess(): void {
    // Add success (false) to the rolling window
    this.failures.shift();
    this.failures.push(false);

    // If we're in HALF_OPEN and get a success, close the circuit
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      this.failureCount = 0;
    }
  }

  /**
   * Record a failed operation
   */
  public recordFailure(): void {
    this.lastFailureTime = Date.now();
    
    // Add failure (true) to the rolling window
    this.failures.shift();
    this.failures.push(true);

    // Count failures in the rolling window
    this.failureCount = this.failures.filter(f => f).length;

    // Open circuit if failure threshold exceeded
    if (this.state === 'CLOSED' && this.failureCount >= this.options.failureThreshold) {
      this.state = 'OPEN';
    } else if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
    }
  }

  /**
   * Check if circuit is open
   */
  public isOpen(): boolean {
    if (this.state === 'CLOSED') {
      return false;
    }

    // Check if circuit should transition to HALF_OPEN
    if (this.state === 'OPEN' && Date.now() - this.lastFailureTime >= this.options.resetTimeout) {
      this.state = 'HALF_OPEN';
      return false;
    }

    return this.state === 'OPEN';
  }

  /**
   * Get the current state
   */
  public getState(): string {
    return this.state;
  }

  /**
   * Get the failure count
   */
  public getFailureCount(): number {
    return this.failureCount;
  }

  /**
   * Get reset timeout
   */
  public get resetTimeout(): number {
    return this.options.resetTimeout;
  }
}

// -------------------------------------------
// Error Handling Functions
// -------------------------------------------

/**
 * Parse Azure Cosmos DB errors into structured format
 */
export function parseCosmosError(error: any): ErrorDetails {
  // Default values
  let code = 'UNKNOWN';
  let message = 'Unknown error';
  let retryable = false;
  let retryAfterMs: number | undefined;

  try {
    // Azure Cosmos DB SDK error structure parsing
    if (error.code) {
      code = error.code;
    } else if (error.statusCode) {
      code = error.statusCode;
    } else if (error.status) {
      code = error.status;
    } else if (error.headers && error.headers['x-ms-substatus']) {
      // Handle Cosmos DB sub-status codes
      code = error.headers['x-ms-substatus'];
    }

    // Convert code to string for consistency
    code = code.toString();

    // Extract retry-after header for 429 errors
    if (code === '429' && error.headers) {
      // Azure Cosmos DB returns retry-after time in x-ms-retry-after-ms header
      const retryAfterHeader = error.headers['x-ms-retry-after-ms'] || 
                              error.headers['retry-after-ms'] ||
                              error.headers['Retry-After'];
      
      if (retryAfterHeader) {
        const parsedRetryAfter = parseInt(retryAfterHeader.toString(), 10);
        if (!isNaN(parsedRetryAfter)) {
          retryAfterMs = parsedRetryAfter;
        }
      }
    }

    // Extract message with priority for more specific error details
    if (error.body && error.body.message) {
      message = error.body.message;
    } else if (error.message) {
      message = error.message;
    } else if (error.body && typeof error.body === 'string') {
      message = error.body;
    }

    // Add additional context for common Azure Cosmos DB errors
    if (code === '429') {
      message += retryAfterMs 
        ? ` (Rate limiting - retry after ${retryAfterMs}ms)` 
        : ' (Rate limiting - consider increasing RU/s or using backoff)';
    } else if (code === '449') {
      message += ' (Retry with - temporary resource constraint)';
    } else if (code === '503') {
      message += ' (Service temporarily unavailable)';
    }

    // Determine if the error is retryable using our enhanced logic
    retryable = isRetryableError(code);
  } catch (e) {
    // Fallback for unparseable errors
    message = 'Error parsing exception: ' + String(e);
  }

  return {
    code,
    message,
    retryable,
    retryAfterMs,
    raw: error
  };
}

/**
 * Check if an error requires custom retry logic based on Azure Cosmos DB NoSQL official guidance
 * Note: SDK automatically retries 408, 410, 429, 449, 503 - only add custom retry where needed
 */
export function isRetryableError(errorCode: number | string): boolean {
  const code = errorCode.toString();

  // Based on Azure Cosmos DB NoSQL official guidance:
  // Only retry errors where "Should add retry = Yes" AND "SDKs retry = No"
  
  // 403 is the main case where we should add custom retry (marked as "Optional")
  // Only retry for transient auth issues, not for actual authorization failures
  const customRetryableCodes = [
    '403' // Forbidden - Optional retry only for transient auth issues
  ];

  // These are handled by SDK automatically (SDKs retry = Yes)
  // We don't need to add custom retry logic for these
  const sdkHandledCodes = [
    '408', // Request Timeout - SDK handles this
    '410', // Gone - SDK handles this  
    '429', // Too Many Requests - SDK handles this with x-ms-retry-after-ms
    '449', // Retry With - SDK handles this
    '503'  // Service Unavailable - SDK handles this
  ];

  // Non-retryable errors (per Azure guidance: "Should add retry = No")
  const nonRetryableCodes = [
    '400', // Bad Request
    '401', // Not authorized  
    '404', // Resource not found
    '409', // Conflict failure (ID/partition key taken or unique constraint violated)
    '412', // Precondition failure (eTag mismatch - optimistic concurrency)
    '413', // Request entity too large
    '500'  // Unexpected service error
  ];

  // Don't retry non-retryable errors
  if (nonRetryableCodes.includes(code)) {
    return false;
  }

  // Only add custom retry for codes not handled by SDK
  return customRetryableCodes.includes(code);
}

// -------------------------------------------
// Document Operations
// -------------------------------------------

/**
 * Generate a unique operation ID for a document
 */
export function generateOperationId(doc: JsonData, idField: string = DEFAULT_INSERT_CONFIG.idField): string {
  const baseId = doc[idField] || uuidv4();
  return `${baseId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Validate a document before insertion
 */
export function validateDocument(doc: JsonData, idField: string = DEFAULT_INSERT_CONFIG.idField, schema?: Record<string, any>): boolean {
  // Basic validation - document must be an object
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return false;
  }

  // Ensure document has an ID field or can generate one
  if (!doc[idField]) {
    // Allow documents without explicit ID as we can generate one
    doc[idField] = uuidv4();
  }

  // Optional schema validation
  if (schema) {
    // Basic schema validation - could be enhanced with more sophisticated validation
    for (const [key, expectedType] of Object.entries(schema)) {
      if (doc[key] && typeof doc[key] !== expectedType) {
        return false;
      }
    }
  }

  return true;
}

// -------------------------------------------
// Utility Functions
// -------------------------------------------

/**
 * Delay function for exponential backoff
 */
async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// -------------------------------------------
// Core Insert Operations
// -------------------------------------------

/**
 * Resilient bulk insert with comprehensive error handling and retry logic
 */
export async function resilientInsert(
  container: Container,
  data: JsonData[],
  configOptions: Partial<InsertConfig> = {}
): Promise<InsertResult> {
  // Merge provided config with defaults
  const config: InsertConfig = {
    ...DEFAULT_INSERT_CONFIG,
    ...configOptions,
    circuitBreakerOptions: {
      ...DEFAULT_INSERT_CONFIG.circuitBreakerOptions,
      ...(configOptions.circuitBreakerOptions || {})
    }
  };

  const logger = new Logger(config.correlationId);
  const metrics = new MetricsCollector();
  const retryResiliency = new RetryResiliency(config.circuitBreakerOptions);

  logger.info('Starting resilient insert operation', {
    documentCount: data.length,
    batchSize: config.batchSize
  });

  // NOTE: Retry resiliency for handling errors not covered by Azure SDK's built-in retry logic.

  let inserted = 0, failed = 0, retried = 0;
  const failedDocs: FailedDocument[] = [];
  const totalBatches = Math.ceil(data.length / config.batchSize);

  // Process in batches to manage memory and allow progress tracking
  for (let i = 0; i < totalBatches; i++) {
    // Check retry resiliency before proceeding
    if (retryResiliency.isOpen()) {
      logger.warn('Retry resiliency circuit open, pausing operations', {
        failureCount: retryResiliency.getFailureCount(),
        state: retryResiliency.getState()
      });

      await delay(retryResiliency.resetTimeout);

      if (retryResiliency.isOpen()) {
        logger.error('Service degraded, retry resiliency circuit still open after wait', {
          failureCount: retryResiliency.getFailureCount(),
          state: retryResiliency.getState()
        });

        throw new Error('Service degraded, retry resiliency circuit still open after wait period');
      }
    }

    const start = i * config.batchSize;
    const end = Math.min(start + config.batchSize, data.length);
    const batch = data.slice(start, end);

    logger.info(`Processing batch ${i + 1}/${totalBatches}`, {
      batchSize: batch.length,
      totalProcessed: start
    });

    // Validate documents before attempting insertion
    const validDocs = batch.filter(doc => {
      if (!validateDocument(doc, config.idField, config.schema)) {
        logger.warn('Document validation failed', { doc });
        failed++;
        if (config.returnFailedDocs) {
          failedDocs.push({
            document: doc,
            error: { code: 'VALIDATION_ERROR', message: 'Document validation failed', retryable: false },
            attempts: 0
          });
        }
        return false;
      }
      return true;
    });

    // Process each document in the batch with simplified retry logic
    const batchPromises = validDocs.map(async (doc) => {
      let customRetries = 0;
      const MAX_CUSTOM_RETRIES = 2; // Only for 403 Forbidden scenarios
      let lastError: ErrorDetails | null = null;

      while (customRetries <= MAX_CUSTOM_RETRIES) {
        try {
          const startTime = Date.now();
          
          // Prepare document with operation ID for idempotency
          const docToInsert = { ...doc };
          if (config.idempotencyEnabled && !docToInsert.operationId) {
            docToInsert.operationId = generateOperationId(doc, config.idField);
          }

          // Perform the insert operation with timeout
          // SDK automatically handles retries for: 408, 410, 429, 449, 503
          const insertPromise = container.items.create(docToInsert);
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Operation timeout')), config.bulkInsertTimeoutMs);
          });

          const result = await Promise.race([insertPromise, timeoutPromise]) as any;
          const latency = Date.now() - startTime;

          // Record successful operation metrics
          metrics.recordRUs(result.requestCharge || 0);
          metrics.recordLatency(latency);
          retryResiliency.recordSuccess();

          inserted++;
          return { success: true, doc, result };

        } catch (error: any) {
          const errorDetails = parseCosmosError(error);
          lastError = errorDetails;

          metrics.recordError(errorDetails.code);
          retryResiliency.recordFailure();

          logger.warn(`Insert attempt ${customRetries + 1} failed`, {
            docId: doc[config.idField],
            error: errorDetails.message,
            code: errorDetails.code
          });

          // Only retry 403 Forbidden if it might be transient auth issue
          if (errorDetails.code === '403' && customRetries < MAX_CUSTOM_RETRIES) {
            customRetries++;
            retried++;
            
            // Short delay for auth token refresh scenarios
            const shortDelay = 500 * customRetries;
            logger.debug(`Retrying 403 error after ${shortDelay}ms`, {
              docId: doc[config.idField],
              attempt: customRetries + 1
            });

            await delay(shortDelay);
            continue;
          }
          
          // All other errors: either handled by SDK already, or not retryable
          // SDK already exhausted retries for 408, 410, 429, 449, 503
          break;
        }
      }

      // Document failed after all retries
      failed++;
      if (config.returnFailedDocs && lastError) {
        failedDocs.push({
          document: doc,
          error: lastError,
          attempts: customRetries + 1 // Total attempts made
        });
      }

      return { success: false, doc, error: lastError };
    });

    // Wait for all documents in the batch to complete
    await Promise.allSettled(batchPromises);
  }

  const result: InsertResult = {
    total: data.length,
    inserted,
    failed,
    retried,
    failedDocuments: config.returnFailedDocs ? failedDocs : undefined,
    metrics: metrics.getSummary(),
    metricsCollector: metrics
  };

  logger.info('Resilient insert operation completed', {
    inserted: result.inserted,
    failed: result.failed,
    retried: result.retried,
    totalRUs: result.metrics.totalRu,
    durationMs: result.metrics.totalDurationMs
  });

  return result;
}

/**
 * Simple batch insert function for basic Cosmos DB operations
 * This is a basic implementation - for production use resilientInsert() instead
 */
export async function insertData(config: any, container: Container, data: JsonData[]): Promise<{ total: number; inserted: number; failed: number }> {
    // Cosmos DB uses containers instead of collections
    // Insert documents in batches
    console.log(`Processing in batches of ${config.batchSize}...`);
    const totalBatches = Math.ceil(data.length / config.batchSize);

    let inserted = 0;
    let failed = 0;
    // Cosmos DB does not support bulk insert natively in SDK, but you can use stored procedures or loop
    // Here we use a simple loop for demonstration
    for (let i = 0; i < totalBatches; i++) {
        const start = i * config.batchSize;
        const end = Math.min(start + config.batchSize, data.length);
        const batch = data.slice(start, end);
        for (const doc of batch) {
            try {
                await container.items.create(doc);
                inserted++;
            } catch (error) {
                console.error(`Error inserting document:`, error);
                failed++;
            }
        }
        // Small pause between batches to reduce resource contention
        if (i < totalBatches - 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    // Index creation is handled by indexing policy in Cosmos DB, not programmatically per field
    //TBD: If custom indexing policy is needed, update container indexing policy via SDK or portal
    return { total: data.length, inserted, failed };
}

/**
 * Ensure Azure Cosmos DB database and container exist with proper partition key configuration
 */
export async function ensureDatabaseAndContainer(
  client: any, 
  databaseName: string, 
  containerName: string, 
  partitionKeyPath: string
): Promise<{ database: any, container: any }> {
  try {
    console.log(`Ensuring database ${databaseName} exists...`);
    const { database } = await client.databases.createIfNotExists({ id: databaseName });
    console.log(`Database ${databaseName} ensured.`);

    console.log(`Ensuring container ${containerName} exists with partition key ${partitionKeyPath}...`);
    
    // IMPORTANT: Partition key cannot be changed after container creation
    const { container } = await database.containers.createIfNotExists({ 
      id: containerName,
      partitionKey: { paths: [partitionKeyPath] }
    });
    
    console.log(`Container ${containerName} ensured.`);
    console.log(`PARTITION KEY SET TO: ${partitionKeyPath}`);
    console.log(`Remember: Partition key cannot be changed after container creation!`);

    return { database, container };
  } catch (error: any) {
    console.error(`\nERROR: Cannot access database or container. Please ensure they exist.`);
    console.error(`Error details: ${error.message}\n`);
    console.error(`IMPORTANT: You need to create the database and container manually before running this script:\n`);
    console.error(`1. Database name: ${databaseName}`);
    console.error(`2. Container name: ${containerName} `);
    console.error(`3. Partition key: ${partitionKeyPath}\n`);
    console.error(`You can create these resources through:`);
    console.error(`- Azure Portal: https://portal.azure.com`);
    console.error(`- Azure CLI: `);
    console.error(`  az cosmosdb sql database create --account-name <your-account> --name ${databaseName} --resource-group <your-resource-group>`);
    console.error(`  az cosmosdb sql container create --account-name <your-account> --database-name ${databaseName} --name ${containerName} --partition-key-path ${partitionKeyPath} --resource-group <your-resource-group>\n`);
    console.error(`The account you're using doesn't have permission to create these resources programmatically.`);
    
    throw error;
  }
}