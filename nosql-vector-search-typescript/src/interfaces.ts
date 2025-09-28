/**
 * Type definitions for Azure Cosmos DB bulk insert operations
 * This file contains all interfaces and type definitions used across the insert-at-scale implementation
 */

import type { MetricsCollector } from './metrics.js';

// Common type aliases
export type JsonData = Record<string, any>;

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