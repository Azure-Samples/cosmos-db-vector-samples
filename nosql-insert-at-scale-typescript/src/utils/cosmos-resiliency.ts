/**
 * Azure Cosmos DB Resilience and Retry Logic Module
 * 
 * This module contains all resilience-related functionality for Azure Cosmos DB operations including:
 * - Circuit breaker implementation for educational purposes
 * - Custom retry logic for errors not handled by Azure SDK
 * - Error parsing and retryability determination
 * - Resilient bulk insert operations with comprehensive error handling
 * - Delay/backoff utilities
 */
import { Container, CosmosClient } from '@azure/cosmos';
import { v4 as uuidv4 } from 'uuid';
import { MetricsCollector, Logger } from './metrics.js';
import {
  InsertConfig,
  DEFAULT_INSERT_CONFIG,
  CircuitBreakerOptions,
  FailedDocument,
  ErrorDetails,
  InsertResult
} from './resilience-interfaces.js';
import { JsonData } from './interfaces.js';
import {
  validateDocument,
  generateOperationId
} from './cosmos-operations.js';

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
      console.log(`📦 Processing batch ${i + 1}/${totalBatches} (${batch.length} documents)...`);
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

    // Process each document in the batch with enhanced retry logic
    const batchPromises = validDocs.map(async (doc) => {
      let customRetries = 0;
      const MAX_CUSTOM_RETRIES = 3; // Increased for handling 429 errors
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
          
          let timeoutId: NodeJS.Timeout | undefined;
          const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error('Operation timeout')), config.bulkInsertTimeoutMs);
          });

          const result = await Promise.race([insertPromise, timeoutPromise]) as any;
          if (timeoutId) clearTimeout(timeoutId); // Clean up timeout if operation completes first
          const latency = Date.now() - startTime;

          // Record successful operation metrics
          metrics.recordRUs(result.requestCharge || 0);
          metrics.recordLatency(latency);
          retryResiliency.recordSuccess();

          // Show success message if this was a retry
          if (customRetries > 0) {
            console.log(`✅ Document ${doc[config.idField]} successfully inserted after ${customRetries} ${customRetries === 1 ? 'retry' : 'retries'}`);
          }

          inserted++;
          return { success: true, doc, result };

        } catch (error: any) {
          const errorDetails = parseCosmosError(error);
          lastError = errorDetails;

          metrics.recordError(errorDetails.code);
          retryResiliency.recordFailure();

          // Only log detailed warning if this is not going to be retried or is the final attempt
          if (!isRetryableError(errorDetails.code) || customRetries >= MAX_CUSTOM_RETRIES) {
            logger.warn(`Insert attempt ${customRetries + 1} failed`, {
              docId: doc[config.idField],
              error: errorDetails.message,
              code: errorDetails.code
            });
          }

          // Check if error is retryable
          if (isRetryableError(errorDetails.code) && customRetries < MAX_CUSTOM_RETRIES) {
            customRetries++;
            retried++;
            
            let retryDelay: number;
            
            if (errorDetails.code === '429') {
              // For 429 errors, respect the retry-after header if available
              if (errorDetails.retryAfterMs) {
                retryDelay = errorDetails.retryAfterMs;
              } else {
                // Use exponential backoff starting from 1s for 429 errors
                retryDelay = Math.min(1000 * Math.pow(2, customRetries - 1), 10000);
              }
              
              console.log(`⏳ Rate limiting detected for document ${doc[config.idField]} - retrying in ${Math.round(retryDelay/1000)}s (attempt ${customRetries + 1}/${MAX_CUSTOM_RETRIES + 1})`);
            } else if (errorDetails.code === '403') {
              // Short delay for auth token refresh scenarios
              retryDelay = 500 * customRetries;
              
              console.log(`🔑 Authentication issue for document ${doc[config.idField]} - retrying in ${Math.round(retryDelay/1000)}s (attempt ${customRetries + 1}/${MAX_CUSTOM_RETRIES + 1})`);
            } else {
              // Default exponential backoff for other retryable errors
              retryDelay = Math.min(500 * Math.pow(2, customRetries - 1), 5000);
              
              console.log(`⚠️  Error ${errorDetails.code} for document ${doc[config.idField]} - retrying in ${Math.round(retryDelay/1000)}s (attempt ${customRetries + 1}/${MAX_CUSTOM_RETRIES + 1})`);
            }

            await delay(retryDelay);
            continue;
          }
          
          // All other errors: either not retryable or exhausted retries
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

  console.log(`🎯 Batch processing completed: ${result.inserted} inserted, ${result.failed} failed, ${result.retried} retries`);

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