/**
 * Core type definitions for Azure Cosmos DB operations
 * This file contains basic interfaces and type definitions for low-level Cosmos DB operations
 */

// Common type aliases
export type JsonData = Record<string, any>;

/**
 * Performance metrics for operations
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