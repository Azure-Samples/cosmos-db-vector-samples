/**
 * Azure Cosmos DB Performance Monitoring and Metrics Collection
 * 
 * This module provides comprehensive performance monitoring, RU consumption tracking,
 * and operational metrics for Azure Cosmos DB bulk insert operations.
 */
import { v4 as uuidv4 } from 'uuid';

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

/**
 * Comprehensive metrics collector for Azure Cosmos DB performance tracking
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
   * Calculate RU consumption rate for scaling decisions
   */
  public getRuConsumptionRate(): { ruPerSecond: number; ruPerMinute: number; scalingRecommendation: string } {
    if (this.ruValues.length < 2) {
      return {
        ruPerSecond: 0,
        ruPerMinute: 0,
        scalingRecommendation: 'Insufficient data for scaling recommendation'
      };
    }

    const durationMs = Date.now() - this.startTime;
    const durationSeconds = durationMs / 1000;
    const durationMinutes = durationMs / (1000 * 60);
    const totalRu = this.ruValues.reduce((sum, val) => sum + val, 0);
    
    const ruPerSecond = durationSeconds > 0 ? totalRu / durationSeconds : 0;
    const ruPerMinute = durationMinutes > 0 ? totalRu / durationMinutes : 0;
    
    // Provide scaling recommendations based on consumption patterns
    let scalingRecommendation = '';
    if (ruPerSecond > 8000) {
      scalingRecommendation = 'High RU/s consumption detected. Consider provisioning more RU/s or using Dynamic Autoscale.';
    } else if (ruPerSecond > 5000) {
      scalingRecommendation = 'Moderate RU/s consumption. Monitor for 429 throttling errors.';
    } else if (ruPerSecond > 1000) {
      scalingRecommendation = 'Normal RU/s consumption for bulk insert operations.';
    } else {
      scalingRecommendation = 'Low RU/s consumption. Current provisioning appears sufficient.';
    }

    return {
      ruPerSecond: Math.round(ruPerSecond),
      ruPerMinute: Math.round(ruPerMinute),
      scalingRecommendation
    };
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
}

/**
 * Simple logger with correlation ID support for tracking operations
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
    // Output clean console messages instead of JSON
    let prefix = '';
    switch (level) {
      case LogLevel.DEBUG:
        prefix = '🔍 ';
        break;
      case LogLevel.INFO:
        prefix = 'ℹ️  ';
        break;
      case LogLevel.WARN:
        prefix = '⚠️  ';
        break;
      case LogLevel.ERROR:
        prefix = '❌ ';
        break;
      default:
        prefix = '';
    }
    
    console.log(`${prefix}${message}`);
    
    // If there's additional data and it's at DEBUG level, show it in a readable format
    if (data && level === LogLevel.DEBUG) {
      console.log(`   Details: ${JSON.stringify(data, null, 2)}`);
    }
  }

  /**
   * Get the correlation ID
   */
  public getCorrelationId(): string {
    return this.correlationId;
  }
}