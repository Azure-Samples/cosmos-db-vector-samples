/**
 * Enterprise-grade resilient document insertion for Cosmos DB
 * Implements robust retry logic, circuit breaker pattern, monitoring, and more
 */
import { Container } from '@azure/cosmos';
import { v4 as uuidv4 } from 'uuid';
import { JsonData, readFileReturnJson, getClients, calculateRUCost, estimateMonthlyRUCost } from './utils.js';

// -------------------------------------------
// Type Definitions
// -------------------------------------------

/**
 * Configuration options for resilient insert operations
 */
export interface InsertConfig {
  /** Maximum batch size for document insertion */
  batchSize: number;
  /** Maximum number of retry attempts for failed operations */
  maxRetries: number;
  /** Base time in ms for exponential backoff calculation */
  baseBackoff: number;
  /** Maximum backoff time in ms regardless of retry count */
  maxBackoff: number;
  /** Unique ID for correlating logs across the operation */
  correlationId?: string;
  /** Target RU utilization rate (0.0-1.0) to avoid throttling */
  targetRuUtilization: number;
  /** Maximum parallel operations to run simultaneously */
  maxConcurrency: number;
  /** Whether to enable idempotency tokens on documents */
  idempotencyEnabled: boolean;
  /** Whether to return failed documents in results */
  returnFailedDocs: boolean;
  /** Circuit breaker configuration */
  circuitBreakerOptions: CircuitBreakerOptions;
  /** Optional document schema for validation */
  schema?: Record<string, any>;
  /** Name of the field to use as document ID */
  idField: string;
  /** Path to the partition key field, e.g., '/HotelId' */
  partitionKeyPath: string;
}

/**
 * Default configuration with reasonable values
 */
export const DEFAULT_INSERT_CONFIG: InsertConfig = {
  batchSize: 25,
  maxRetries: 5,
  baseBackoff: 100,
  maxBackoff: 10000,
  targetRuUtilization: 0.7,
  maxConcurrency: 5,
  idempotencyEnabled: true,
  returnFailedDocs: true,
  circuitBreakerOptions: {
    failureThreshold: 10,
    resetTimeout: 30000,
    rollingWindowSize: 100
  },
  idField: 'HotelId',
  partitionKeyPath: '/HotelId'
};

/**
 * Circuit breaker configuration options
 */
export interface CircuitBreakerOptions {
  /** Number of failures before opening the circuit */
  failureThreshold: number;
  /** Time in ms to wait before attempting to reset the circuit */
  resetTimeout: number;
  /** Size of the rolling window for failure tracking */
  rollingWindowSize: number;
}

/**
 * Information about a failed document insertion
 */
export interface FailedDocument {
  /** The document that failed to insert */
  document: JsonData;
  /** Error details */
  error: ErrorDetails;
  /** Number of attempts made before failing */
  attempts: number;
}

/**
 * Structured error information
 */
export interface ErrorDetails {
  /** Error code (e.g., 429, 503) */
  code: number | string;
  /** Human-readable error message */
  message: string;
  /** Whether this error is retryable */
  retryable: boolean;
  /** The raw error object */
  raw?: any;
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
  /** The metrics collector instance for advanced metrics and cost estimation */
  metricsCollector: MetricsCollector;
}

/**
 * Performance metrics for the operation
 */
export interface OperationMetrics {
  /** Total RU consumption */
  totalRu: number;
  /** Average RU per document */
  avgRuPerDoc: number;
  /** Maximum RU per operation */
  maxRu: number;
  /** Average latency in ms per document */
  avgLatencyMs: number;
  /** Maximum latency in ms for any single operation */
  maxLatencyMs: number;
  /** Error count by status code */
  errorCounts: Record<string, number>;
  /** Total duration of the operation in ms */
  totalDurationMs: number;
}

/**
 * Log levels for the logger
 */
export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR'
}

// -------------------------------------------
// Helper Classes
// -------------------------------------------

/**
 * Circuit breaker implementation to prevent cascading failures
 */
export class CircuitBreaker {
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

    // Count failures in the current window
    this.failureCount = this.failures.filter(f => f).length;

    // Check if we need to open the circuit
    if (this.state === 'CLOSED' && this.failureCount >= this.options.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  /**
   * Check if the circuit is open (preventing operations)
   */
  public isOpen(): boolean {
    // If we're open but the reset timeout has passed, try half-open
    if (this.state === 'OPEN' &&
      (Date.now() - this.lastFailureTime) > this.options.resetTimeout) {
      this.state = 'HALF_OPEN';
    }

    return this.state === 'OPEN';
  }

  /**
   * Get current failure count
   */
  public getFailureCount(): number {
    return this.failureCount;
  }

  /**
   * Get current circuit state
   */
  public getState(): string {
    return this.state;
  }

  /**
   * Reset the circuit breaker to closed state
   */
  public reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.failures.fill(false);
  }

  /**
   * Get the reset timeout in ms
   */
  public get resetTimeout(): number {
    return this.options.resetTimeout;
  }
}

/**
 * Metrics collector for tracking performance
 */
export class MetricsCollector {
  private ruValues: number[] = [];
  private latencyValues: number[] = [];
  private errorMap: Map<string, number> = new Map();
  private startTime: number;

  constructor() {
    this.startTime = Date.now();
  }

  /**
   * Record the RU charge for an operation
   */
  public recordRUs(requestCharge: number): void {
    this.ruValues.push(requestCharge);
  }

  /**
   * Record the latency for an operation
   */
  public recordLatency(latencyMs: number): void {
    this.latencyValues.push(latencyMs);
  }

  /**
   * Record an error by its code
   */
  public recordError(errorCode: number | string): void {
    const code = errorCode.toString();
    this.errorMap.set(code, (this.errorMap.get(code) || 0) + 1);
  }

  /**
   * Get the current RU consumption rate
   */
  public getCurrentRuConsumption(): number {
    if (this.ruValues.length === 0) return 0;

    // Look at the last 10 operations or fewer if we have less
    const recentValues = this.ruValues.slice(-10);
    return recentValues.reduce((sum, val) => sum + val, 0) / recentValues.length;
  }

  /**
   * Get a summary of all metrics
   */
  public getSummary(): OperationMetrics {
    const totalRu = this.ruValues.reduce((sum, val) => sum + val, 0);
    const avgRuPerDoc = this.ruValues.length > 0 ? totalRu / this.ruValues.length : 0;
    const maxRu = this.ruValues.length > 0 ? Math.max(...this.ruValues) : 0;

    const totalLatency = this.latencyValues.reduce((sum, val) => sum + val, 0);
    const avgLatencyMs = this.latencyValues.length > 0 ? totalLatency / this.latencyValues.length : 0;
    const maxLatencyMs = this.latencyValues.length > 0 ? Math.max(...this.latencyValues) : 0;

    const errorCounts: Record<string, number> = {};
    this.errorMap.forEach((count, code) => {
      errorCounts[code] = count;
    });

    return {
      totalRu,
      avgRuPerDoc,
      maxRu,
      avgLatencyMs,
      maxLatencyMs,
      errorCounts,
      totalDurationMs: Date.now() - this.startTime
    };
  }

  /**
   * Estimate cost for serverless operations based on RU consumption
   * @returns Cost estimate details
   */
  public estimateServerlessCost(options: {
    serverlessPricePerMillionRUs?: number;
    regionCount?: number;
  } = {}) {
    const { 
      serverlessPricePerMillionRUs = 0.008, 
      regionCount = 1 
    } = options;
    
    const totalRUs = this.ruValues.reduce((sum, val) => sum + val, 0);
    
    return calculateRUCost({
      totalRUs,
      isServerless: true,
      serverlessPricePerMillionRUs,
      regionCount
    });
  }

  /**
   * Estimate monthly cost based on current RU consumption pattern
   * @returns Monthly cost projection
   */
  public estimateMonthlyRUCost(options: {
    isServerless?: boolean;
    provisionedRUs?: number;
    serverlessPricePerMillionRUs?: number;
    provisionedPricePer100RUsHour?: number;
    regionCount?: number;
  } = {}) {
    const totalRUs = this.ruValues.reduce((sum, val) => sum + val, 0);
    const durationMs = Date.now() - this.startTime;
    
    return estimateMonthlyRUCost({
      currentTotalRUs: totalRUs,
      durationMs,
      ...options
    });
  }
}

/**
 * Simple logger with correlation ID support
 */
export class Logger {
  private readonly correlationId: string;

  constructor(correlationId?: string) {
    this.correlationId = correlationId || uuidv4();
  }

  /**
   * Log a debug message
   */
  public debug(message: string, data?: any): void {
    this.log(LogLevel.DEBUG, message, data);
  }

  /**
   * Log an info message
   */
  public info(message: string, data?: any): void {
    this.log(LogLevel.INFO, message, data);
  }

  /**
   * Log a warning message
   */
  public warn(message: string, data?: any): void {
    this.log(LogLevel.WARN, message, data);
  }

  /**
   * Log an error message
   */
  public error(message: string, data?: any): void {
    this.log(LogLevel.ERROR, message, data);
  }

  /**
   * Log a message with the given level
   */
  private log(level: LogLevel, message: string, data?: any): void {
    const timestamp = new Date().toISOString();
    const logData = {
      timestamp,
      level,
      correlationId: this.correlationId,
      message,
      ...(data ? { data } : {})
    };

    // In production, you might want to use a proper logging library
    // or send logs to a centralized service
    console.log(JSON.stringify(logData));
  }

  /**
   * Get the correlation ID
   */
  public getCorrelationId(): string {
    return this.correlationId;
  }
}

// -------------------------------------------
// Helper Functions
// -------------------------------------------

/**
 * Create a logger instance
 */
function createLogger(correlationId?: string): Logger {
  return new Logger(correlationId);
}

/**
 * Create a metrics collector
 */
function createMetricsCollector(): MetricsCollector {
  return new MetricsCollector();
}

/**
 * Parse a Cosmos DB error into a structured format
 */
function parseCosmosError(error: any): ErrorDetails {
  // Default values
  let code = 'UNKNOWN';
  let message = 'Unknown error';
  let retryable = false;

  try {
    if (error.code) {
      code = error.code;
    } else if (error.statusCode) {
      code = error.statusCode;
    } else if (error.status) {
      code = error.status;
    }

    // Convert code to string for consistency
    code = code.toString();

    // Extract message
    message = error.message || error.body?.message || 'Unknown error';

    // Determine if the error is retryable
    retryable = isRetryableError(code);
  } catch (e) {
    // Fallback for unparseable errors
    message = 'Error parsing exception: ' + String(e);
  }

  return {
    code,
    message,
    retryable,
    raw: error
  };
}

/**
 * Check if an error is retryable based on its code
 */
function isRetryableError(errorCode: number | string): boolean {
  const code = errorCode.toString();

  // Common retryable status codes
  const retryableCodes = [
    '408', // Request Timeout
    '429', // Too Many Requests
    '500', // Internal Server Error
    '503', // Service Unavailable
    '1000', // Cross partition query error (sometimes temporary)
    'ServiceUnavailable',
    'TooManyRequests',
    'RequestTimeout'
  ];

  return retryableCodes.includes(code);
}

/**
 * Create a promise that resolves after the specified delay
 */
async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Adaptive delay based on RU consumption to avoid throttling
 */
async function adaptiveDelay(currentRuConsumption: number, targetUtilization: number): Promise<void> {
  // This is a simplified version - in a real implementation,
  // you'd want to consider your total provisioned RU/s and adjust accordingly

  // If we're consuming too many RUs, add some delay
  if (currentRuConsumption > 0) {
    // This formula is simplistic - a real implementation would be more sophisticated
    const adjustmentFactor = Math.max(0, (currentRuConsumption - targetUtilization * 100) / 100);
    const delayMs = Math.min(1000, Math.max(0, adjustmentFactor * 500));

    if (delayMs > 0) {
      await delay(delayMs);
    }
  }
}

/**
 * Generate a unique operation ID for idempotency
 */
function generateOperationId(doc: JsonData, idField: string = DEFAULT_INSERT_CONFIG.idField): string {
  // Use document ID if available, otherwise generate a new UUID
  const baseId = doc[idField] || uuidv4();
  return `op-${baseId}-${Date.now()}`;
}

/**
 * Basic document validation
 */
function validateDocument(doc: JsonData, idField: string = DEFAULT_INSERT_CONFIG.idField, schema?: Record<string, any>): boolean {
  // Check if document is valid JSON
  if (!doc || typeof doc !== 'object') {
    return false;
  }

  // Check if document has an ID using the specified field
  if (!doc[idField]) {
    return false;
  }

  // Check document size (Cosmos DB limit is 2MB)
  const docSize = Buffer.from(JSON.stringify(doc)).length;
  if (docSize > 2 * 1024 * 1024) {
    return false;
  }

  // If schema is provided, validate against it
  if (schema) {
    // This is a simplified schema validation
    // In production, use a proper schema validation library
    for (const [key, type] of Object.entries(schema)) {
      if (typeof doc[key] !== type) {
        return false;
      }
    }
  }

  return true;
}

// -------------------------------------------
// Main Function
// -------------------------------------------

/**
 * Insert data into Cosmos DB with enterprise-grade resilience
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

  const logger = createLogger(config.correlationId);
  const metrics = createMetricsCollector();
  const circuitBreaker = new CircuitBreaker(config.circuitBreakerOptions);

  logger.info('Starting resilient insert operation', {
    documentCount: data.length,
    batchSize: config.batchSize
  });

  let inserted = 0, failed = 0, retried = 0;
  const failedDocs: FailedDocument[] = [];
  const totalBatches = Math.ceil(data.length / config.batchSize);

  // Process in batches to manage memory and allow progress tracking
  for (let i = 0; i < totalBatches; i++) {
    // Check circuit breaker before proceeding
    if (circuitBreaker.isOpen()) {
      logger.warn('Circuit breaker open, pausing operations', {
        failureCount: circuitBreaker.getFailureCount(),
        state: circuitBreaker.getState()
      });

      await delay(circuitBreaker.resetTimeout);

      if (circuitBreaker.isOpen()) {
        logger.error('Service degraded, circuit breaker still open after wait', {
          failureCount: circuitBreaker.getFailureCount(),
          state: circuitBreaker.getState()
        });

        throw new Error('Service degraded, circuit breaker still open after wait period');
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
    const validBatch = batch.filter(doc => validateDocument(doc, config.idField, config.schema));

    // Process valid documents with retry logic
    for (const doc of validBatch) {
      const startTime = Date.now();
      let attempts = 0;
      let success = false;
      let lastError: ErrorDetails | null = null;

      while (attempts < config.maxRetries && !success) {
        try {
          if (attempts > 0) {
            // Exponential backoff with jitter for retries
            const backoffTime = Math.min(
              config.maxBackoff,
              config.baseBackoff * Math.pow(2, attempts) * (0.5 + Math.random() * 0.5)
            );

            logger.debug(`Retry backoff for ${backoffTime}ms`, {
              docId: doc[config.idField],
              attempt: attempts + 1
            });

            await delay(backoffTime);
            retried++;
          }

          attempts++;

          // Add idempotency token if configured
          if (config.idempotencyEnabled && !doc._operationId) {
            doc._operationId = generateOperationId(doc, config.idField);
          }

          // Perform the actual document creation
          const response = await container.items.create(doc);

          // Record metrics
          metrics.recordRUs(response.requestCharge);
          metrics.recordLatency(Date.now() - startTime);

          // Record success
          circuitBreaker.recordSuccess();
          inserted++;
          success = true;

          logger.debug('Document inserted successfully', {
            docId: doc[config.idField],
            requestCharge: response.requestCharge
          });
        } catch (error) {
          // Parse and record the error
          lastError = parseCosmosError(error);
          metrics.recordError(lastError.code);
          circuitBreaker.recordFailure();

          logger.warn(`Document insertion failed`, {
            docId: doc[config.idField],
            hotelId: doc.HotelId, // Added this line to specifically show HotelId
            errorCode: lastError.code,
            attempt: attempts,
            retryable: lastError.retryable
          });

          // If not retryable or max retries reached, mark as failed
          if (!lastError.retryable || attempts >= config.maxRetries) {
            break;
          }
        }
      }

      // If all attempts failed, record the failure
      if (!success) {
        failed++;

        failedDocs.push({
          document: doc,
          error: lastError || {
            code: 'MAX_RETRIES_EXCEEDED',
            message: 'Document insertion failed after maximum retries',
            retryable: false
          },
          attempts
        });

        logger.error('Document insertion permanently failed', {
          docId: doc[config.idField],
          hotelId: doc.HotelId, // Added this line to specifically show HotelId
          attempts,
          errorCode: lastError?.code || 'UNKNOWN'
        });
      }
    }

    // Add adaptive delay between batches to avoid throttling
    if (i < totalBatches - 1) {
      await adaptiveDelay(metrics.getCurrentRuConsumption(), config.targetRuUtilization);
    }
  }

  // Prepare the final result
  const result: InsertResult = {
    total: data.length,
    inserted,
    failed,
    retried,
    metrics: metrics.getSummary(),
    metricsCollector: metrics
  };

  // Only include failed documents if requested
  if (config.returnFailedDocs && failedDocs.length > 0) {
    result.failedDocuments = failedDocs;
  }

  logger.info('Resilient insert operation completed', {
    inserted,
    failed,
    retried,
    totalRUs: result.metrics.totalRu,
    durationMs: result.metrics.totalDurationMs
  });

  return result;
}

/**
 * Ensure database and container exist
 */
async function ensureDatabaseAndContainer(
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
    const { container } = await database.containers.createIfNotExists({ 
      id: containerName,
      partitionKey: { paths: [partitionKeyPath] }
    });
    console.log(`Container ${containerName} ensured.`);

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

async function main() {

  // Create Cosmos client
  const { dbClient: client } = getClients();

  if (!client) {
    throw new Error('Cosmos DB client is not configured properly. Please check your environment variables.');
  }

  // Database and container names
  const databaseName = 'Hotels';
  const containerName = 'hotels-at-scale-2';
  const config = {
    ...DEFAULT_INSERT_CONFIG,
    batchSize: 50,
    maxRetries: 3
  };

  console.log(`Using database ${databaseName} and container ${containerName}...`);
  console.log(`Using ID field: ${config.idField} and partition key path: ${config.partitionKeyPath}`);
  
  try {
    // Ensure database and container exist
    const { container } = await ensureDatabaseAndContainer(
      client, 
      databaseName, 
      containerName, 
      config.partitionKeyPath
    );

    // Load data
    const dataPath = process.env.DATA_FILE_WITH_VECTORS || '../../data/HotelsData_toCosmosDB_Vector.json';
    console.log(`Reading JSON file from ${dataPath}`);
    const data = await readFileReturnJson(dataPath);

    // Insert with resilience
    const result = await resilientInsert(container, data, config);

    // Show basic results
    console.log(`\n-------- OPERATION RESULTS --------`);
    console.log(`Inserted ${result.inserted} of ${result.total} documents`);
    console.log(`Total RUs consumed: ${result.metrics.totalRu.toLocaleString()}`);
    console.log(`Average RU per document: ${result.metrics.avgRuPerDoc.toFixed(2)}`);
    
    // Show immediate cost estimate
    const serverlessCost = result.metricsCollector.estimateServerlessCost();
    console.log(`\n-------- CURRENT OPERATION COST --------`);
    console.log(`COST OF THIS OPERATION: $${serverlessCost.estimatedCost.toFixed(6)}`);
    console.log(`This is calculated as: ${result.metrics.totalRu.toLocaleString()} RUs ÷ 1,000,000 × $0.008 per million RUs`);

    // Show monthly projection with clear explanation
    const monthlyEstimate = result.metricsCollector.estimateMonthlyRUCost({
      isServerless: true // Change to false if using provisioned throughput
    });
    
    console.log(`\n-------- PROJECTED MONTHLY COST --------`);
    console.log(`ESTIMATED MONTHLY COST: $${monthlyEstimate.monthlyCost.toFixed(2)}`);
    console.log(`This estimate is based on your current consumption rate of ${monthlyEstimate.details.currentRate.ruPerSecond} RU/s`);
    console.log(`which would result in approximately ${(monthlyEstimate.projectedMonthlyRUs / 1_000_000).toFixed(2)} million RUs per month.`);
    console.log(`The calculation extrapolates your current usage pattern over a 30-day period.`);
  } catch (err: any) {
    // The detailed error message is already handled in ensureDatabaseAndContainer
    throw err;
  }
}

main().catch(console.error);

