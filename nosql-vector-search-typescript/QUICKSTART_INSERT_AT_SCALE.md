# Quickstart: Insert documents at scale into Azure Cosmos DB for NoSQL

In this quickstart, you learn how to efficiently insert large volumes of documents into Azure Cosmos DB for NoSQL using TypeScript and the Azure SDK. You'll implement enterprise-grade resilience patterns including retry logic, error handling, and performance monitoring.

## Prerequisites

- An Azure account with an active subscription. [Create an account for free](https://azure.microsoft.com/free/).
- Azure Cosmos DB for NoSQL account. [Create a Cosmos DB account](https://docs.microsoft.com/azure/cosmos-db/create-cosmosdb-resources-portal).
- [Node.js](https://nodejs.org/) version 18 or higher.
- [TypeScript](https://www.typescriptlang.org/) installed globally.

## Setting up your environment

1. **Install required packages**:
   ```bash
   npm install @azure/cosmos @azure/identity uuid
   npm install -D @types/uuid typescript
   ```

2. **Configure environment variables**:
   Create a `.env` file with your Cosmos DB connection details:
   ```
   COSMOS_ENDPOINT=https://your-account.documents.azure.com:443/
   COSMOS_KEY=your-primary-key
   ```

3. **Prepare your data**:
   For this quickstart, we'll use a sample hotel dataset. Create a JSON file with your documents or use our sample data structure.

## Understanding bulk insert best practices

Before implementing bulk insert operations, it's crucial to understand Azure Cosmos DB best practices and the distinction between educational patterns and production recommendations:

### Educational vs Production Patterns

This quickstart demonstrates several patterns for learning purposes. Here's what you should use in production versus what's included for educational value:

| Pattern Category | 🎓 Educational Patterns (Good for Learning) | 🏭 Production Recommendations |
|------------------|---------------------------------------------|-------------------------------|
| **Resilience & Error Handling** | Custom circuit breaker implementation - Demonstrates resilience concepts | [Azure Cosmos DB SDK built-in retry policies](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/resilient-applications) - Use the SDK's automatic retry handling with optimized backoff |
| **Retry Logic** | Manual retry logic with custom backoff - Shows how retry patterns work | [Azure Cosmos DB SDK built-in retry policies](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/resilient-applications) - The SDK has optimized implementations |
| **Performance Monitoring** | Custom metrics collection - Illustrates performance monitoring concepts | [Azure Monitor](https://learn.microsoft.com/en-us/azure/azure-monitor/overview) and [Application Insights](https://learn.microsoft.com/en-us/azure/azure-monitor/app/app-insights-overview) - Enterprise-grade monitoring and alerting |
| **Error Analysis** | Detailed error parsing and categorization - Helps understand different error types | [Azure Monitor diagnostic logs](https://learn.microsoft.com/en-us/azure/cosmos-db/monitor-cosmos-db) - Native error tracking and analysis |
| **Resource Scaling** | Manual throttling and adaptive delay logic - Shows RU management concepts | [Dynamic Autoscale](https://learn.microsoft.com/en-us/azure/cosmos-db/provision-throughput-autoscale) - Let Azure automatically scale RU/s based on demand |
| **Resource Control** | Custom circuit breaker for RU management - Educational implementation | [Throughput Buckets (Preview)](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/throughput-buckets?tabs=dotnet) - Use Azure's native RU/workload control |
| **Authentication** | Connection string authentication - Simple for learning | [Managed Identity authentication](https://learn.microsoft.com/en-us/azure/cosmos-db/managed-identity-based-authentication) - More secure for production workloads |

### When to Use Each Approach

- **Development and Learning**: Use the patterns in this quickstart to understand resilience concepts and error handling
- **Small-scale Production**: The educational patterns can work for smaller workloads with proper testing
- **Enterprise Production**: Prefer Azure-native solutions for scalability, reliability, and reduced maintenance overhead

### Partition Key Selection

Choose a partition key with **high cardinality** to ensure even distribution of data and optimal performance. Here are the key principles to follow:

**Best Practices for Partition Keys:**
- **High cardinality**: Choose fields with many distinct values across documents
- **Avoid hot partitions**: Don't use keys that concentrate traffic on few partitions
- **Good examples**: userId, deviceId, locationId, customerId
- **Poor examples**: status, category, type, country (these have low cardinality)
- **Even distribution**: Aim for balanced data and request distribution across partitions
- **Query alignment**: Use partition keys that appear in most of your queries

**For Large Insert Workloads:**
- High cardinality enables better parallelism across multiple physical partitions
- Each physical partition can handle up to 10,000 RU/s maximum
- More partitions result in better insert performance for high-volume scenarios

```typescript
/**
 * Path to the partition key field, e.g., '/HotelId'
 */
partitionKeyPath: string;
```

### Scaling Strategy

For large insert operations, consider these RU scaling approaches:

- **Initial Ingestion**: Set RU/s high during large insert periods
- **Post-Ingestion**: Scale back down to normal operational levels  
- **Dynamic Autoscale**: Use Azure's autoscale capability with appropriate max RU/s limits
- **Physical Partitions**: Every ~10,000 RU/s creates a new physical partition, enabling better parallelism

## Configuration interface

Define a comprehensive configuration for your bulk insert operations. The configuration allows you to control batch sizes, retry behavior, concurrency, and other important settings:

```typescript
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
  /** Maximum parallel operations. Set to -1 to let the client/SDK maximize parallelism automatically. */
  maxConcurrency: number;
  /** Whether to enable idempotency tokens on documents */
  idempotencyEnabled: boolean;
  /** Whether to return failed documents in results */
  returnFailedDocs: boolean;
  /** Name of the field to use as document ID */
  idField: string;
  /** Path to the partition key field */
  partitionKeyPath: string;
}
```

**Key Configuration Options:**
- **maxConcurrency**: Set to -1 to let the Azure Cosmos DB SDK automatically maximize parallelism based on your account's capabilities
- **batchSize**: Process documents in batches to manage memory usage and enable progress tracking
- **targetRuUtilization**: Keep below 1.0 to avoid consistent throttling
- **idempotencyEnabled**: Helps prevent duplicate insertions during retry scenarios

/**
 * Default configuration with reasonable values
 */
export const DEFAULT_INSERT_CONFIG: InsertConfig = {
  batchSize: 25,
  maxRetries: 5,
  baseBackoff: 100,
  maxBackoff: 10000,
  targetRuUtilization: 0.7,
  maxConcurrency: -1, // Let client/SDK maximize parallelism
  idempotencyEnabled: true,
  returnFailedDocs: true,
  idField: 'HotelId',
  partitionKeyPath: '/HotelId'
};
```

## Implementing robust error handling

Azure Cosmos DB operations can fail for various reasons. Implement smart retry logic based on error types to improve resilience.

**Error Categories:**
- **Retryable HTTP codes**: 408 (Request Timeout), 429 (Too Many Requests), 449 (Retry With), 500/502/503/504 (Server/Gateway errors)
- **Retryable Cosmos DB codes**: ServiceUnavailable, TooManyRequests, RequestTimeout, Gone (partition split), InternalServerError
- **Non-retryable codes**: 400 (Bad Request), 401 (Unauthorized), 403 (Forbidden), 404 (Not Found), 409 (Conflict), 412 (Precondition Failed), 413 (Payload Too Large)

```typescript
/**
 * Check if an error is retryable based on its code
 * Based on Azure Cosmos DB SDK best practices for resilient applications
 * Reference: https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/resilient-applications
 */
function isRetryableError(errorCode: number | string): boolean {
  const code = errorCode.toString();

  const retryableHttpCodes = [
    '408', '429', '449', '500', '503', '502', '504'
  ];

  const retryableCosmosDbCodes = [
    'ServiceUnavailable', 'TooManyRequests', 'RequestTimeout', 'Gone', 'InternalServerError'
  ];

  const nonRetryableCodes = [
    '400', '401', '403', '404', '409', '412', '413'
  ];

  if (nonRetryableCodes.includes(code)) {
    return false;
  }

  return retryableHttpCodes.includes(code) || retryableCosmosDbCodes.includes(code);
}
```

## Advanced backoff strategies

Implement different backoff strategies for different error types to optimize retry behavior:

**Backoff Strategy Types:**
- **Rate limiting (429 errors)**: Use more aggressive backoff with base multiplier of 3x and added random jitter
- **Other retryable errors**: Use standard exponential backoff with 2x multiplier and jitter for collision avoidance
- **Maximum backoff**: Always respect the configured maximum backoff time to prevent excessively long delays

```typescript
if (attempts > 0) {
  let backoffTime: number;
  
  if (lastError && lastError.code === '429') {
    backoffTime = Math.min(
      config.maxBackoff,
      config.baseBackoff * Math.pow(3, attempts) + (Math.random() * 1000)
    );
  } else {
    backoffTime = Math.min(
      config.maxBackoff,
      config.baseBackoff * Math.pow(2, attempts) * (0.5 + Math.random() * 0.5)
    );
  }

  logger.debug(`Retry backoff for ${backoffTime}ms`, {
    docId: doc[config.idField],
    attempt: attempts + 1,
    errorCode: lastError?.code || 'UNKNOWN',
    backoffStrategy: lastError?.code === '429' ? 'rate-limit-backoff' : 'exponential-jitter'
  });

  await delay(backoffTime);
  retried++;
}
```

## Performance monitoring

Track key performance metrics during your bulk insert operations:

```typescript
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
}
```

## Complete implementation

Here's a complete example of the bulk insert function with enterprise-grade resilience patterns:

**Implementation Notes:**
- **Batch processing**: Documents are processed in configurable batches to manage memory and enable progress tracking
- **Educational patterns**: This implementation includes a custom circuit breaker, comprehensive logging, and manual retry logic for learning about resilience patterns
- **Production recommendation**: For production workloads, prefer Azure Cosmos DB's native features:
  - **Azure Cosmos DB SDK built-in retry policies**: The SDK automatically handles retries with optimized backoff strategies
  - **Dynamic Autoscale**: Automatically scales RU/s based on demand without custom throttling logic
  - **Throughput Buckets (Preview)**: Fine-grained RU/workload control instead of custom circuit breakers
  - **Azure Monitor and Application Insights**: Enterprise monitoring instead of custom metrics collection

```typescript
/**
 * Insert data into Cosmos DB with enterprise-grade resilience
 */
export async function resilientInsert(
  container: Container,
  data: JsonData[],
  configOptions: Partial<InsertConfig> = {}
): Promise<InsertResult> {
  const config: InsertConfig = {
    ...DEFAULT_INSERT_CONFIG,
    ...configOptions
  };

  const logger = createLogger(config.correlationId);
  const metrics = createMetricsCollector();

  logger.info('Starting resilient insert operation', {
    documentCount: data.length,
    batchSize: config.batchSize
  });

  let inserted = 0, failed = 0, retried = 0;
  const failedDocs: FailedDocument[] = [];
  const totalBatches = Math.ceil(data.length / config.batchSize);

  for (let i = 0; i < totalBatches; i++) {
    const start = i * config.batchSize;
    const end = Math.min(start + config.batchSize, data.length);
    const batch = data.slice(start, end);

    logger.info(`Processing batch ${i + 1}/${totalBatches}`, {
      batchSize: batch.length,
      totalProcessed: start
    });

    for (const doc of batch) {
      const startTime = Date.now();
      let attempts = 0;
      let success = false;
      let lastError: ErrorDetails | null = null;

      while (attempts < config.maxRetries && !success) {
        try {
          attempts++;

          if (config.idempotencyEnabled && !doc._operationId) {
            doc._operationId = generateOperationId(doc, config.idField);
          }

          const response = await container.items.create(doc);

          metrics.recordRUs(response.requestCharge);
          metrics.recordLatency(Date.now() - startTime);

          inserted++;
          success = true;

        } catch (error) {
          lastError = parseCosmosError(error);
          metrics.recordError(lastError.code);

          if (!lastError.retryable || attempts >= config.maxRetries) {
            break;
          }
        }
      }

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
      }
    }
  }

  return {
    total: data.length,
    inserted,
    failed,
    retried,
    metrics: metrics.getSummary(),
    metricsCollector: metrics,
    ...(config.returnFailedDocs && failedDocs.length > 0 ? { failedDocuments: failedDocs } : {})
  };
}
```

## Usage example

Here's how to use the bulk insert functionality in your application with comprehensive output and guidance:

**Key Implementation Points:**
- **Database and container setup**: Ensure proper partition key configuration before inserting data
- **Partition key analysis**: The example validates that your chosen partition key follows best practices
- **Performance monitoring**: Track RU consumption, latency, and error patterns
- **Best practices guidance**: Console output provides actionable recommendations

```typescript
async function main() {
  const { dbClient: client } = getClientsPasswordless();

  if (!client) {
    throw new Error('Cosmos DB client is not configured properly.');
  }

  const databaseName = 'Hotels';
  const containerName = 'hotels-at-scale';
  const config = {
    ...DEFAULT_INSERT_CONFIG,
    batchSize: 50,
    maxRetries: 3,
    maxConcurrency: -1
  };

  console.log(`Using database ${databaseName} and container ${containerName}...`);
  console.log(`Using ID field: ${config.idField} and partition key path: ${config.partitionKeyPath}`);
  
  console.log(`\nPARTITION KEY ANALYSIS:`);
  console.log(`• Current partition key: ${config.partitionKeyPath}`);
  console.log(`• Ensure this field has high cardinality (many unique values)`);
  console.log(`• Avoid low-cardinality fields like 'status', 'type', or 'category'`);
  console.log(`• Good partition keys distribute data evenly across partitions\n`);
  
  try {
    const { container } = await ensureDatabaseAndContainer(
      client, 
      databaseName, 
      containerName, 
      config.partitionKeyPath
    );

    const dataPath = process.env.DATA_FILE || './sample-data.json';
    console.log(`Reading JSON file from ${dataPath}`);
    const data = await readFileReturnJson(dataPath);

    const result = await resilientInsert(container, data, config);

    console.log(`\n-------- OPERATION RESULTS --------`);
    console.log(`Inserted ${result.inserted} of ${result.total} documents`);
    console.log(`Failed ${result.failed} documents`);
    console.log(`Total retries attempted: ${result.retried}`);
    
    console.log(`\n-------- PERFORMANCE METRICS --------`);
    console.log(`Total RUs consumed: ${result.metrics.totalRu.toLocaleString()}`);
    console.log(`Average RU per document: ${result.metrics.avgRuPerDoc.toFixed(2)}`);
    console.log(`Max RU for single operation: ${result.metrics.maxRu.toFixed(2)}`);
    console.log(`Average latency per document: ${result.metrics.avgLatencyMs.toFixed(2)}ms`);
    console.log(`Total operation duration: ${(result.metrics.totalDurationMs / 1000).toFixed(2)}s`);
    
    if (Object.keys(result.metrics.errorCounts).length > 0) {
      console.log(`\n-------- ERROR BREAKDOWN --------`);
      for (const [errorCode, count] of Object.entries(result.metrics.errorCounts)) {
        console.log(`Error ${errorCode}: ${count} occurrences`);
      }
    }

    console.log(`\n-------- AZURE COSMOS DB BEST PRACTICES --------`);
    console.log(`For production workloads, consider these Azure-native features:`);
    console.log(`• Dynamic Autoscale: Automatically adjusts RU/s based on demand`);
    console.log(`• Throughput Buckets (Preview): Fine-grained RU/workload control`);
    console.log(`• Learn more: https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/throughput-buckets`);
    
    console.log(`\n-------- PARTITION KEY BEST PRACTICES --------`);
    console.log(`• Choose high cardinality partition keys (many unique values)`);
    console.log(`• Ensure even distribution of data across partitions`);
    console.log(`• Use partition key in your query filters for best performance`);
    console.log(`• Avoid hot partitions (keys with uneven traffic distribution)`);
    console.log(`• Current partition key '${config.partitionKeyPath}' - verify it meets these criteria`);
    
  } catch (error) {
    console.error('Operation failed:', error);
    throw error;
  }
}

main().catch(console.error);
```

## Key takeaways

### Educational Value
This quickstart demonstrates several resilience patterns to help you understand the concepts:

1. **Custom Retry Logic**: Learn how to implement intelligent retry logic that distinguishes between retryable and non-retryable errors
2. **Circuit Breaker Pattern**: Understand how to prevent cascading failures (though Azure handles this natively in production)
3. **Performance Monitoring**: See how to track RU consumption, latency, and error rates for optimization insights
4. **Error Handling**: Learn to parse and categorize different types of Azure Cosmos DB errors

### Production Best Practices

1. **Partition Key Selection**: Choose high-cardinality partition keys to ensure even data distribution and optimal performance
2. **Azure SDK Features**: Leverage built-in retry policies, connection pooling, and automatic failover
3. **Native Scaling**: Use Dynamic Autoscale and Throughput Buckets instead of custom throttling logic
4. **Enterprise Monitoring**: Implement Azure Monitor, Application Insights, and proper alerting
5. **Security**: Use Managed Identity authentication and proper network security configurations
6. **Resource Management**: Temporarily increase RU/s allocation during large insert operations, then scale back down

### Migration Path
- **Start**: Use educational patterns to understand concepts and for development/testing
- **Scale**: Gradually adopt Azure-native solutions as your workload grows
- **Enterprise**: Fully leverage Azure's managed services for production reliability

## Next steps

- Learn about [Azure Cosmos DB Throughput Buckets](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/throughput-buckets?tabs=dotnet) for advanced RU management
- Explore [Design Resilient Applications with Azure Cosmos DB SDKs](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/resilient-applications) for additional best practices
- Review [Azure Cosmos DB Partitioning](https://learn.microsoft.com/en-us/azure/cosmos-db/partitioning-overview) for deep dive into partition strategies
- Consider [Azure Cosmos DB Request Units](https://learn.microsoft.com/en-us/azure/cosmos-db/request-units) for understanding RU optimization

## Clean up resources

When you're finished with this quickstart, you can delete the Azure Cosmos DB account to avoid ongoing charges. You can delete the account through the Azure portal or using the Azure CLI.