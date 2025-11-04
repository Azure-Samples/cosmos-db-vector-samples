/**
 * Azure Cosmos DB Resilience and Retry Logic Module
 * 
 * This module contains all resilience-related functionality for Azure Cosmos DB operations including:
 * - Circuit breaker implementation for educational purposes
 * - Custom retry logic for errors not handled by Azure SDK
 * - Error parsing and retryability determination
 * - Resilient bulk insert operations with comprehensive error handling using executeBulkOperations API
 * - Delay/backoff utilities
 */
import { Container, CosmosClient, BulkOperationType, OperationInput } from '@azure/cosmos';
import { v4 as uuidv4 } from 'uuid';
import { MetricsCollector, Logger, OperationMetrics } from './metrics.js';
import { JsonData } from './utils.js';
import {
  validateDocument,
  generateOperationId,
  executeBulkOperationsWithTimeout,
  BulkExecutionConfig
} from './cosmos-operations.js';

// -------------------------------------------
// Type Definitions
// -------------------------------------------

/**
 * Retry resiliency configuration options
 * Used for handling failures not covered by Azure Cosmos DB SDK's built-in retry logic
 */
export interface CircuitBreakerOptions {
  /** Number of failures before opening the circuit to prevent cascading failures */
  failureThreshold: number;
  /** Time in ms to wait before attempting to reset the circuit */
  resetTimeout: number;
  /** Size of the rolling window for failure tracking */
  rollingWindowSize: number;
}

/**
 * Structured error information with Azure Cosmos DB specific details
 */
export interface ErrorDetails {
  /** Error code (e.g., 429, 503) */
  code: number | string;
  /** Human-readable error message */
  message: string;
  /** Whether this error is retryable */
  retryable: boolean;
  /** Retry-after time in milliseconds from x-ms-retry-after-ms header (for 429 errors) */
  retryAfterMs?: number;
  /** The raw error object */
  raw?: any;
}

/**
 * Information about a failed document insertion
 */
export interface FailedDocument {
  /** The document that failed to insert */
  document: Record<string, any>;
  /** Error details */
  error: ErrorDetails;
  /** Number of attempts made before failing */
  attempts: number;
}

/**
 * Configuration options for resilient insert operations
 * See INSERT_AT_SCALE_GUIDE.md for detailed configuration guidance
 */
export interface InsertConfig {
  /** Maximum batch size for document insertion */
  batchSize: number;
  /** Unique ID for correlating logs across the operation */
  correlationId?: string;
  /** Target RU utilization rate (0.0-1.0) to avoid throttling */
  targetRuUtilization: number;
  /** Maximum parallel operations to run simultaneously. Set to -1 to let the client/SDK maximize parallelism automatically. */
  maxConcurrency: number;
  /** Whether to enable idempotency tokens on documents */
  idempotencyEnabled: boolean;
  /** Whether to return failed documents in results */
  returnFailedDocs: boolean;
  /** Retry resiliency configuration for handling errors not covered by Azure SDK */
  circuitBreakerOptions: CircuitBreakerOptions;
  /** Optional document schema for validation */
  schema?: Record<string, any>;
  /** Name of the field to use as document ID */
  idField: string;
  /** Path to the partition key field, e.g., '/HotelId' - choose high cardinality fields for optimal distribution */
  partitionKeyPath: string;
  /** Timeout for bulk insert operations in milliseconds */
  bulkInsertTimeoutMs: number;
}

/**
 * Result of an insert operation
 */
export interface InsertResult {
  /** Total number of documents processed */
  total: number;
  /** Number of documents successfully inserted */
  inserted: number;
  /** Number of documents that failed to insert */
  failed: number;
  /** Number of retries performed */
  retried: number;
  /** List of documents that failed to insert (if returnFailedDocs=true) */
  failedDocuments?: FailedDocument[];
  /** Performance metrics for the operation */
  metrics: OperationMetrics;
  /** The metrics collector instance for advanced performance metrics */
  metricsCollector: MetricsCollector;
}

/**
 * Default configuration with reasonable values for production use
 * See INSERT_AT_SCALE_GUIDE.md for configuration optimization guidance
 */
export const DEFAULT_INSERT_CONFIG: InsertConfig = {
  batchSize: 25,
  targetRuUtilization: 0.7,
  maxConcurrency: -1, // Let client/SDK maximize parallelism
  idempotencyEnabled: true,
  returnFailedDocs: true,
  circuitBreakerOptions: {
    failureThreshold: 10,
    resetTimeout: 30000,
    rollingWindowSize: 100
  },
  idField: 'HotelId',
  partitionKeyPath: '/HotelId',
  bulkInsertTimeoutMs: 60000
};

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

    // Extract message with priority for more specific error details
    if (error.body && error.body.message) {
      message = error.body.message;
    } else if (error.message) {
      message = error.message;
    } else if (error.body && typeof error.body === 'string') {
      message = error.body;
    }

    // Special handling for 429 errors - check if message contains rate limiting indicators
    if (message.includes('Request rate is large') || 
        message.includes('429') || 
        message.includes('More Request Units may be needed')) {
      code = '429';
      
      // Try to extract retry-after from headers or message
      if (error.headers) {
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
    }

    // Extract retry-after header for confirmed 429 errors
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
 * Note: While SDK has some retry for 429, bulk operations often need additional retry logic
 */
export function isRetryableError(errorCode: number | string): boolean {
  const code = errorCode.toString();

  // Based on Azure Cosmos DB NoSQL official guidance and bulk operation best practices:
  // Add custom retry for errors that benefit from application-level retry logic
  
  // Custom retryable codes for bulk operations
  const customRetryableCodes = [
    '403', // Forbidden - Optional retry only for transient auth issues
    '429'  // Too Many Requests - Additional retry for bulk operations beyond SDK retry
  ];

  // These are handled by SDK automatically but may need additional application retry for bulk ops
  const sdkHandledCodes = [
    '408', // Request Timeout - SDK handles this
    '410', // Gone - SDK handles this  
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

  // Add custom retry for codes that benefit from application-level retry
  return customRetryableCodes.includes(code);
}

/**
 * Delay function for exponential backoff
 */
export async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// -------------------------------------------
// Core Insert Operations with Resilience
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

  console.log(`🚀 Starting batch processing of ${data.length} documents...`);

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

    if (totalBatches > 1) {
      console.log(`📦 Processing document group ${i + 1}/${totalBatches} (${batch.length} documents)...`);
    }

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

    // Process each batch using executeBulkOperations API with enhanced retry logic
    let customRetries = 0;
    const MAX_CUSTOM_RETRIES = 3; // Increased for handling 429 errors
    let lastError: ErrorDetails | null = null;

    while (customRetries <= MAX_CUSTOM_RETRIES) {
      try {
        const startTime = Date.now();
        
        // Prepare bulk operations with operation ID for idempotency
        const bulkOperations: OperationInput[] = validDocs.map(doc => {
          const docToInsert = { ...doc };
          if (config.idempotencyEnabled && !docToInsert.operationId) {
            docToInsert.operationId = generateOperationId(doc, config.idField);
          }

          // Ensure document has required 'id' field for Cosmos DB
          // Use the custom idField value or generate a UUID if not present
          if (!docToInsert.id) {
            docToInsert.id = doc[config.idField] || uuidv4();
          }

          return {
            operationType: BulkOperationType.Create,
            partitionKey: docToInsert[config.idField], // Use the partition key value from the document
            resourceBody: docToInsert
          } as OperationInput;
        });

        // Execute bulk operations with timeout
        // SDK automatically handles retries for: 408, 410, 429, 449, 503
        const bulkExecutionConfig: BulkExecutionConfig = {
          timeoutMs: config.bulkInsertTimeoutMs,
          enableDebugLogging: true
        };
        
        const bulkResult = await executeBulkOperationsWithTimeout(container, bulkOperations, bulkExecutionConfig);
        
        if (bulkResult.error) {
          throw bulkResult.error;
        }
        
        const bulkResponse = bulkResult.bulkResponse;
        const latency = bulkResult.latency;

        // Process bulk operation results
        let batchInserted = 0;
        let batchFailed = 0;
        
        bulkResponse.forEach((operationResult: any, index: number) => {
          const doc = validDocs[index];
          
          // BulkOperationResult has response property containing statusCode and requestCharge
          const statusCode = operationResult.response?.statusCode || (operationResult.error ? 500 : 0);
          const requestCharge = operationResult.response?.requestCharge || 0;
          
          if (statusCode >= 200 && statusCode < 300) {
            // Success
            metrics.recordRUs(requestCharge);
            metrics.recordLatency(latency / bulkOperations.length); // Approximate per-document latency
            batchInserted++;
            
            // Show success message if this was a retry
            if (customRetries > 0) {
              console.log(`✅ Document ${doc[config.idField]} successfully inserted after ${customRetries} ${customRetries === 1 ? 'retry' : 'retries'}`);
            }
          } else {
            // Failure
            const errorDetails = parseCosmosError({
              statusCode: statusCode,
              body: operationResult.response?.resourceBody,
              headers: operationResult.response?.headers
            });
            
            metrics.recordError(errorDetails.code);
            batchFailed++;
            
            if (config.returnFailedDocs) {
              failedDocs.push({
                document: doc,
                error: errorDetails,
                attempts: customRetries + 1
              });
            }
            
            // Only log detailed warning if this is not going to be retried or is the final attempt
            if (!isRetryableError(errorDetails.code) || customRetries >= MAX_CUSTOM_RETRIES) {
              logger.warn(`Bulk insert operation failed`, {
                docId: doc[config.idField],
                error: errorDetails.message,
                code: errorDetails.code,
                statusCode: statusCode
              });
              
              // Also log to console for immediate visibility
              console.error(`❌ Document ${doc[config.idField]} failed:`);
              console.error(`   Status Code: ${statusCode}`);
              console.error(`   Error Code: ${errorDetails.code}`);
              console.error(`   Error Message: ${errorDetails.message}`);
            }
          }
        });

        inserted += batchInserted;
        failed += batchFailed;
        
        // Record success for the bulk operation
        retryResiliency.recordSuccess();

        // If we have some failures but they're not retryable, don't retry the entire batch
        const retryableFailures = bulkResponse.filter((result: any, index: number) => {
          const statusCode = result.response?.statusCode || (result.error ? 500 : 0);
          return statusCode >= 400 && isRetryableError(statusCode.toString());
        });

        if (retryableFailures.length === 0) {
          // No retryable failures, we're done with this batch
          break;
        } else if (customRetries < MAX_CUSTOM_RETRIES) {
          // We have retryable failures, prepare for retry
          const retryableDocs = bulkResponse
            .map((result: any, index: number) => ({ result, doc: validDocs[index], index }))
            .filter(({ result }) => {
              const statusCode = result.response?.statusCode || (result.error ? 500 : 0);
              return statusCode >= 400 && isRetryableError(statusCode.toString());
            })
            .map(({ doc }) => doc);

          if (retryableDocs.length > 0) {
            // Update validDocs to only include documents that need retry
            validDocs.splice(0, validDocs.length, ...retryableDocs);
            
            customRetries++;
            retried += retryableDocs.length;
            
            // Don't subtract from inserted count - we'll count successes properly on retry
            // Only subtract from failed count since we'll retry these documents
            failed -= retryableDocs.length;
            
            let retryDelay: number;
            
            // Check if any of the retryable failures is a 429
            const hasRateLimit = retryableFailures.some((result: any) => {
              const statusCode = result.response?.statusCode || (result.error ? 500 : 0);
              return statusCode === 429;
            });
            
            if (hasRateLimit) {
              // For 429 errors, use exponential backoff starting from 1s
              retryDelay = Math.min(1000 * Math.pow(2, customRetries - 1), 10000);
              console.log(`⏳ Rate limiting detected - retrying ${retryableDocs.length} documents in ${Math.round(retryDelay/1000)}s (attempt ${customRetries + 1}/${MAX_CUSTOM_RETRIES + 1})`);
            } else {
              // Default exponential backoff for other retryable errors
              retryDelay = Math.min(500 * Math.pow(2, customRetries - 1), 5000);
              console.log(`⚠️  Retryable errors detected - retrying ${retryableDocs.length} documents in ${Math.round(retryDelay/1000)}s (attempt ${customRetries + 1}/${MAX_CUSTOM_RETRIES + 1})`);
            }

            await delay(retryDelay);
            continue;
          }
        }
        
        // All retries exhausted or no retryable failures
        break;

      } catch (error: any) {
        const errorDetails = parseCosmosError(error);
        lastError = errorDetails;

        metrics.recordError(errorDetails.code);
        retryResiliency.recordFailure();

        // Only log detailed warning if this is not going to be retried or is the final attempt
        if (!isRetryableError(errorDetails.code) || customRetries >= MAX_CUSTOM_RETRIES) {
          logger.warn(`Bulk insert attempt ${customRetries + 1} failed`, {
            batchSize: validDocs.length,
            error: errorDetails.message,
            code: errorDetails.code
          });
          
          // Also log to console for immediate visibility
          console.error(`❌ Bulk insert attempt ${customRetries + 1} failed:`);
          console.error(`   Error Code: ${errorDetails.code}`);
          console.error(`   Error Message: ${errorDetails.message}`);
          console.error(`   Batch Size: ${validDocs.length} documents`);
          if (errorDetails.raw) {
            console.error(`   Raw Error:`, JSON.stringify(errorDetails.raw, null, 2));
          }
        }

        // Check if error is retryable
        if (isRetryableError(errorDetails.code) && customRetries < MAX_CUSTOM_RETRIES) {
          customRetries++;
          retried += validDocs.length; // All documents in the batch will be retried
          
          let retryDelay: number;
          
          if (errorDetails.code === '429') {
            // For 429 errors, respect the retry-after header if available
            if (errorDetails.retryAfterMs) {
              retryDelay = errorDetails.retryAfterMs;
            } else {
              // Use exponential backoff starting from 1s for 429 errors
              retryDelay = Math.min(1000 * Math.pow(2, customRetries - 1), 10000);
            }
            
            console.log(`⏳ Rate limiting detected for document group - retrying in ${Math.round(retryDelay/1000)}s (attempt ${customRetries + 1}/${MAX_CUSTOM_RETRIES + 1})`);
          } else if (errorDetails.code === '403') {
            // Short delay for auth token refresh scenarios
            retryDelay = 500 * customRetries;
            
            console.log(`🔑 Authentication issue for document group - retrying in ${Math.round(retryDelay/1000)}s (attempt ${customRetries + 1}/${MAX_CUSTOM_RETRIES + 1})`);
          } else {
            // Default exponential backoff for other retryable errors
            retryDelay = Math.min(500 * Math.pow(2, customRetries - 1), 5000);
            
            console.log(`⚠️  Error ${errorDetails.code} for document group - retrying in ${Math.round(retryDelay/1000)}s (attempt ${customRetries + 1}/${MAX_CUSTOM_RETRIES + 1})`);
          }

          await delay(retryDelay);
          continue;
        }
        
        // All other errors: either not retryable or exhausted retries
        break;
      }
    }

    // Handle documents that failed after all retries
    if (lastError && customRetries > MAX_CUSTOM_RETRIES) {
      const remainingFailures = validDocs.length;
      failed += remainingFailures;
      
      if (config.returnFailedDocs) {
        validDocs.forEach(doc => {
          failedDocs.push({
            document: doc,
            error: lastError!,
            attempts: customRetries
          });
        });
      }
    }
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

  console.log(`🎯 Batch processing completed: ${result.inserted} inserted, ${result.failed} failed, ${result.retried} retries`);

  return result;
}

/**
 * Resilient bulk delete operation with comprehensive error handling and retry logic
 * 
 * Features:
 * - Exponential backoff for retryable errors
 * - Circuit breaker pattern to prevent cascading failures
 * - Comprehensive metrics collection and RU tracking
 * - Detailed error logging and classification
 * - Configurable batch sizes and concurrency
 * 
 * @param container - Cosmos DB container instance
 * @param documentRefs - Array of document references (id and partition key) to delete
 * @param config - Configuration for delete operation (extends InsertConfig)
 * @returns Promise<InsertResult> with delete metrics and results
 */
export async function resilientDelete(
  container: Container,
  documentRefs: { id: string; partitionKey: any }[],
  config: InsertConfig = DEFAULT_INSERT_CONFIG
): Promise<InsertResult> {
  const logger = new Logger('resilientDelete');
  const metrics = new MetricsCollector();
  const retryResiliency = new RetryResiliency({
    failureThreshold: 5,
    resetTimeout: 30000,
    rollingWindowSize: 20
  });

  let deleted = 0;
  let failed = 0;
  let retried = 0;
  const failedDocs: FailedDocument[] = [];

  const totalBatches = Math.ceil(documentRefs.length / config.batchSize);
  logger.info(`Starting resilient delete operation`, {
    totalDocuments: documentRefs.length,
    batchSize: config.batchSize,
    totalBatches
  });

  console.log(`ℹ️  Starting resilient delete operation`);
  console.log(`🚀 Starting batch processing of ${documentRefs.length} documents...`);

  // Process in batches
  for (let i = 0; i < totalBatches; i++) {
    // Check circuit breaker state
    if (retryResiliency.isOpen()) {
      logger.warn('Circuit breaker is open, waiting before retry');
      await delay(retryResiliency.resetTimeout);
    }

    const start = i * config.batchSize;
    const end = Math.min(start + config.batchSize, documentRefs.length);
    const batch = documentRefs.slice(start, end);

    logger.info(`Processing batch ${i + 1}/${totalBatches}`, {
      batchSize: batch.length,
      totalProcessed: start
    });

    if (totalBatches > 1) {
      console.log(`📦 Processing document group ${i + 1}/${totalBatches} (${batch.length} documents)...`);
    }

    // Process each batch using executeBulkOperations API with enhanced retry logic
    let customRetries = 0;
    const MAX_CUSTOM_RETRIES = 3;
    let lastError: ErrorDetails | null = null;

    while (customRetries <= MAX_CUSTOM_RETRIES) {
      try {
        const startTime = Date.now();
        
        // Prepare bulk delete operations
        const bulkOperations: OperationInput[] = batch.map(docRef => ({
          operationType: BulkOperationType.Delete,
          id: docRef.id,
          partitionKey: docRef.partitionKey
        }));

        // Execute bulk operations with timeout
        const bulkExecutionConfig: BulkExecutionConfig = {
          timeoutMs: config.bulkInsertTimeoutMs,
          enableDebugLogging: true
        };
        
        const bulkResult = await executeBulkOperationsWithTimeout(container, bulkOperations, bulkExecutionConfig);
        
        if (bulkResult.error) {
          throw bulkResult.error;
        }
        
        const bulkResponse = bulkResult.bulkResponse;
        const latency = bulkResult.latency;

        // Process bulk operation results
        let batchDeleted = 0;
        let batchFailed = 0;
        
        bulkResponse.forEach((operationResult: any, index: number) => {
          const docRef = batch[index];
          
          // BulkOperationResult has response property containing statusCode and requestCharge
          const statusCode = operationResult.response?.statusCode || (operationResult.error ? 500 : 0);
          const requestCharge = operationResult.response?.requestCharge || 0;
          
          if (statusCode >= 200 && statusCode < 300) {
            // Success
            metrics.recordRUs(requestCharge);
            metrics.recordLatency(latency / bulkOperations.length);
            batchDeleted++;
            
            // Show success message if this was a retry
            if (customRetries > 0) {
              console.log(`✅ Document ${docRef.id} successfully deleted after ${customRetries} ${customRetries === 1 ? 'retry' : 'retries'}`);
            }
          } else if (statusCode === 404) {
            // Document doesn't exist (consider as success for delete)
            metrics.recordLatency(latency / bulkOperations.length);
            batchDeleted++;
            
            if (customRetries > 0) {
              console.log(`✅ Document ${docRef.id} already deleted (404) after ${customRetries} ${customRetries === 1 ? 'retry' : 'retries'}`);
            }
          } else {
            // Failure
            const errorDetails = parseCosmosError({
              statusCode: statusCode,
              body: operationResult.response?.resourceBody,
              headers: operationResult.response?.headers
            });
            
            metrics.recordError(errorDetails.code);
            batchFailed++;
            
            if (config.returnFailedDocs) {
              failedDocs.push({
                document: { id: docRef.id, partitionKey: docRef.partitionKey },
                error: errorDetails,
                attempts: customRetries + 1
              });
            }
            
            // Only log detailed warning if this is not going to be retried or is the final attempt
            if (!isRetryableError(errorDetails.code) || customRetries >= MAX_CUSTOM_RETRIES) {
              logger.warn(`Bulk delete operation failed`, {
                docId: docRef.id,
                error: errorDetails.message,
                code: errorDetails.code,
                statusCode: statusCode
              });
              
              // Also log to console for immediate visibility
              console.error(`❌ Document ${docRef.id} delete failed:`);
              console.error(`   Status Code: ${statusCode}`);
              console.error(`   Error Code: ${errorDetails.code}`);
              console.error(`   Error Message: ${errorDetails.message}`);
            }
          }
        });

        deleted += batchDeleted;
        failed += batchFailed;
        
        // Record success for the bulk operation
        retryResiliency.recordSuccess();

        // If we have some failures but they're not retryable, don't retry the entire batch
        const retryableFailures = bulkResponse.filter((result: any, index: number) => {
          const statusCode = result.response?.statusCode || (result.error ? 500 : 0);
          return statusCode >= 400 && isRetryableError(statusCode.toString());
        });

        if (retryableFailures.length === 0) {
          // No retryable failures, we're done with this batch
          break;
        } else if (customRetries < MAX_CUSTOM_RETRIES) {
          // We have retryable failures, prepare for retry
          const retryableRefs = bulkResponse
            .map((result: any, index: number) => ({ result, docRef: batch[index], index }))
            .filter(({ result }) => {
              const statusCode = result.response?.statusCode || (result.error ? 500 : 0);
              return statusCode >= 400 && isRetryableError(statusCode.toString());
            })
            .map(({ docRef }) => docRef);

          if (retryableRefs.length > 0) {
            // Update batch to only include document refs that need retry
            batch.splice(0, batch.length, ...retryableRefs);
            
            customRetries++;
            retried += retryableRefs.length;
            
            // Don't subtract from deleted count - we'll count successes properly on retry
            // Only subtract from failed count since we'll retry these documents
            failed -= retryableRefs.length;
            
            let retryDelay: number;
            
            // Check if any of the retryable failures is a 429
            const hasRateLimit = retryableFailures.some((result: any) => {
              const statusCode = result.response?.statusCode || (result.error ? 500 : 0);
              return statusCode === 429;
            });
            
            if (hasRateLimit) {
              // For 429 errors, use exponential backoff starting from 1s
              retryDelay = Math.min(1000 * Math.pow(2, customRetries - 1), 10000);
              console.log(`⏳ Rate limiting detected - retrying ${retryableRefs.length} documents in ${Math.round(retryDelay/1000)}s (attempt ${customRetries + 1}/${MAX_CUSTOM_RETRIES + 1})`);
            } else {
              // Default exponential backoff for other retryable errors
              retryDelay = Math.min(500 * Math.pow(2, customRetries - 1), 5000);
              console.log(`⚠️  Retryable errors detected - retrying ${retryableRefs.length} documents in ${Math.round(retryDelay/1000)}s (attempt ${customRetries + 1}/${MAX_CUSTOM_RETRIES + 1})`);
            }

            await delay(retryDelay);
            continue;
          }
        }
        
        // All retries exhausted or no retryable failures
        break;

      } catch (error: any) {
        const errorDetails = parseCosmosError(error);
        lastError = errorDetails;

        metrics.recordError(errorDetails.code);
        retryResiliency.recordFailure();

        // Only log detailed warning if this is not going to be retried or is the final attempt
        if (!isRetryableError(errorDetails.code) || customRetries >= MAX_CUSTOM_RETRIES) {
          logger.warn(`Bulk delete attempt ${customRetries + 1} failed`, {
            batchSize: batch.length,
            error: errorDetails.message,
            code: errorDetails.code
          });
          
          // Also log to console for immediate visibility
          console.error(`❌ Bulk delete attempt ${customRetries + 1} failed:`);
          console.error(`   Error Code: ${errorDetails.code}`);
          console.error(`   Error Message: ${errorDetails.message}`);
          console.error(`   Batch Size: ${batch.length} documents`);
          if (errorDetails.raw) {
            console.error(`   Raw Error:`, JSON.stringify(errorDetails.raw, null, 2));
          }
        }

        // Check if error is retryable
        if (isRetryableError(errorDetails.code) && customRetries < MAX_CUSTOM_RETRIES) {
          customRetries++;
          retried += batch.length; // All documents in the batch will be retried
          
          let retryDelay: number;
          
          if (errorDetails.code === '429') {
            // For 429 errors, respect the retry-after header if available
            if (errorDetails.retryAfterMs) {
              retryDelay = errorDetails.retryAfterMs;
            } else {
              // Use exponential backoff starting from 1s for 429 errors
              retryDelay = Math.min(1000 * Math.pow(2, customRetries - 1), 10000);
            }
            
            console.log(`⏳ Rate limiting detected for document group - retrying in ${Math.round(retryDelay/1000)}s (attempt ${customRetries + 1}/${MAX_CUSTOM_RETRIES + 1})`);
          } else if (errorDetails.code === '403') {
            // Short delay for auth token refresh scenarios
            retryDelay = 500 * customRetries;
            
            console.log(`🔑 Authentication issue for document group - retrying in ${Math.round(retryDelay/1000)}s (attempt ${customRetries + 1}/${MAX_CUSTOM_RETRIES + 1})`);
          } else {
            // Default exponential backoff for other retryable errors
            retryDelay = Math.min(500 * Math.pow(2, customRetries - 1), 5000);
            
            console.log(`⚠️  Error ${errorDetails.code} for document group - retrying in ${Math.round(retryDelay/1000)}s (attempt ${customRetries + 1}/${MAX_CUSTOM_RETRIES + 1})`);
          }

          await delay(retryDelay);
          continue;
        }
        
        // All other errors: either not retryable or exhausted retries
        break;
      }
    }

    // Handle documents that failed after all retries
    if (lastError && customRetries > MAX_CUSTOM_RETRIES) {
      const remainingFailures = batch.length;
      failed += remainingFailures;
      
      if (config.returnFailedDocs) {
        batch.forEach(docRef => {
          failedDocs.push({
            document: { id: docRef.id, partitionKey: docRef.partitionKey },
            error: lastError!,
            attempts: customRetries
          });
        });
      }
    }
  }

  console.log(`ℹ️  Resilient delete operation completed`);
  console.log(`🎯 Batch processing completed: ${deleted} deleted, ${failed} failed, ${retried} retries`);

  // Return results in same format as resilientInsert
  const result: InsertResult = {
    total: documentRefs.length,
    inserted: deleted, // Use 'inserted' field for deleted count to maintain interface consistency
    failed,
    retried,
    failedDocuments: config.returnFailedDocs ? failedDocs : undefined,
    metrics: metrics.getSummary(),
    metricsCollector: metrics
  };

  logger.info('Resilient delete operation completed', {
    deleted: result.inserted,
    failed: result.failed,
    retried: result.retried,
    totalRUs: result.metrics.totalRu,
    durationMs: result.metrics.totalDurationMs
  });

  return result;
}

/**
 * Removed: resilientInsertWithIndexManagement function
 * 
 * Index management is now handled by external scripts:
 * - ./scripts/remove-vector-indexes.sh (run before bulk insert)
 * - ./scripts/restore-vector-indexes.sh (run after bulk insert)
 * 
 * Use the main resilientInsert function for bulk operations.
 */