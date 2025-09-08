# Enterprise-Grade Document Insertion Features

## Robust Error Handling and Retries
- Implement exponential backoff for transient errors (429, 503, etc.)
- Set configurable retry counts and timeout policies
- Differentiate between retryable and non-retryable errors

## Transaction Support
- Implement batch transaction semantics when possible
- Support rollback capabilities for partial batch failures
- Ensure consistency with proper error propagation

## Performance Optimization
- Use bulk operations where supported (Cosmos DB supports bulk executor library)
- Implement parallel processing with configurable concurrency limits
- Monitor and adapt to service throttling (rate limiting)

## Comprehensive Monitoring
- Detailed logging with correlation IDs for request tracking
- Performance metrics (latency, throughput, RU consumption)
- Failure rate monitoring with alerting thresholds

## Data Validation
- Schema validation before insertion attempts
- Size validation to prevent document size limit errors
- Property sanitization to handle special characters

## Idempotency Support
- Unique operation IDs to prevent duplicate inserts
- Check-then-insert pattern for critical operations
- Support for upsert operations when appropriate

## Circuit Breaker Pattern
- Prevent cascading failures when service is degraded
- Auto-disable operations after threshold of failures
- Auto-recovery when service returns to normal

## Cost Management & Monitoring
- Real-time tracking of RU consumption
- Cost estimates for serverless and provisioned throughput
- Projection of monthly costs based on usage patterns
- Adaptive throttling to maintain optimal RU utilization

## What's Included in the Implementation

### Well-Defined Type System
- `InsertConfig`: Configuration options with sensible defaults
- `CircuitBreakerOptions`: Settings for the circuit breaker pattern
- `ErrorDetails`: Structured error information
- `OperationMetrics`: Performance tracking
- `FailedDocument`: Detailed information about document insertion failures

### Complete Class Implementations
- `CircuitBreaker`: Prevents cascading failures during service degradation
- `MetricsCollector`: Tracks RU consumption, latency, and error rates
- `Logger`: Structured logging with correlation IDs for request tracing

### Helper Functions
- `parseCosmosError`: Normalizes error responses for consistent handling
- `isRetryableError`: Identifies transient errors suitable for retry attempts
- `validateDocument`: Ensures document validity before insertion attempts
- `adaptiveDelay`: Dynamic throttling based on RU consumption
- `generateOperationId`: Creates idempotency tokens for duplicate prevention

### Main Function
- `resilientInsert`: The enterprise-grade insertion implementation combining all best practices

### Default Configuration
```typescript
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
  }
};
```

## Usage Examples

### Basic Usage

```typescript
// Create Cosmos client
const { dbClient } = getClients();

// Define database and container names
const databaseName = 'Hotels';
const containerName = 'hotels-at-scale';

// Get container reference
const { container } = await ensureDatabaseAndContainer(
  dbClient, 
  databaseName, 
  containerName, 
  '/HotelId'
);

// Load data
const data = await readFileReturnJson('../data/hotels.json');

// Insert with resilience
const result = await resilientInsert(container, data);

console.log(`Inserted ${result.inserted} of ${result.total} documents`);
console.log(`Total RUs consumed: ${result.metrics.totalRu.toLocaleString()}`);
```

### Advanced Usage with Custom Configuration

```typescript
// Custom configuration
const config = {
  batchSize: 50,
  maxRetries: 10,
  baseBackoff: 200,
  maxBackoff: 15000,
  targetRuUtilization: 0.6,
  maxConcurrency: 8,
  idempotencyEnabled: true,
  returnFailedDocs: true,
  circuitBreakerOptions: {
    failureThreshold: 15,
    resetTimeout: 60000,
    rollingWindowSize: 200
  },
  idField: 'customId',
  partitionKeyPath: '/customPartitionKey'
};

// Insert with resilience using custom config
const result = await resilientInsert(container, data, config);

// Process failed documents
if (result.failedDocuments?.length > 0) {
  console.log(`${result.failedDocuments.length} documents failed to insert:`);
  for (const failedDoc of result.failedDocuments) {
    console.log(`Document ${failedDoc.document[config.idField]} failed with error: ${failedDoc.error.message}`);
    console.log(`Attempts made: ${failedDoc.attempts}`);
  }
}
```

## Cost Estimation

The implementation includes sophisticated cost estimation functionality:

```typescript
// Get immediate cost estimate for the operation
const serverlessCost = result.metricsCollector.estimateServerlessCost();
console.log(`Cost of this operation: $${serverlessCost.estimatedCost.toFixed(6)}`);

// Get projected monthly cost based on current usage pattern
const monthlyEstimate = result.metricsCollector.estimateMonthlyRUCost({
  isServerless: true // Set to false for provisioned throughput
});
console.log(`Estimated monthly cost: $${monthlyEstimate.monthlyCost.toFixed(2)}`);
console.log(`Based on consumption rate of ${monthlyEstimate.details.currentRate.ruPerSecond} RU/s`);
```

## Performance Tuning Tips

1. **Optimize Batch Size**: The ideal batch size depends on your document size and complexity. Test different values to find the optimal setting for your workload.

2. **Adjust Concurrency**: Higher concurrency can improve throughput but may lead to more throttling. Monitor RU consumption and adjust accordingly.

3. **Set Appropriate RU Utilization Target**: Lower values (e.g., 0.6) are more conservative and reduce throttling, while higher values (e.g., 0.8) maximize throughput but may cause more retries.

4. **Document Size Considerations**: Larger documents consume more RUs. Consider splitting very large documents or using references where appropriate.

5. **Efficient Partition Keys**: Choose partition keys that distribute data evenly to avoid hot partitions.

## Handling Throttling (429 Errors)

The implementation automatically handles throttling using:

1. **Exponential Backoff**: Progressively increases delay between retry attempts
2. **Adaptive Delay**: Dynamically adjusts delay based on RU consumption
3. **Circuit Breaker**: Temporarily suspends operations when service is overwhelmed
4. **RU Utilization Targeting**: Throttles operations to maintain optimal RU consumption

## Error Handling and Diagnostics

The implementation provides comprehensive error information:

1. **Structured Error Details**: Error codes, messages, and retryability flags
2. **Correlation IDs**: Track operations across logs
3. **Failed Document Collection**: Complete information about documents that failed to insert
4. **Performance Metrics**: RU consumption, latency, and error counts

This enables effective troubleshooting and monitoring of your document insertion processes.
