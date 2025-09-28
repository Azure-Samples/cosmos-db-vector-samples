# Azure Cosmos DB Insert at Scale - Implementation Guide

## Overview

This guide provides comprehensive documentation for the enterprise-grade resilient document insertion implementation for Azure Cosmos DB. The implementation is optimized for large-scale vector document workloads but can be adapted for any high-volume insert scenarios.

## Key Features

- **Robust retry logic** following Azure Cosmos DB SDK best practices
- **Proper handling of x-ms-retry-after-ms headers** for rate limiting (429 errors)
- **Circuit breaker pattern** (educational) with Azure-native alternatives guidance
- **Comprehensive performance metrics** and RU consumption analysis  
- **Adaptive RU scaling recommendations** and physical partition insights
- **High cardinality partition key best practices** for optimal distribution
- **Support for large documents** with vector embeddings (~310 RU per document)
- **Production-ready error handling** and logging with correlation IDs

## Configuration Options (`InsertConfig`)

The configuration interface provides comprehensive control over Azure Cosmos DB bulk insert operations with enterprise-grade resilience and monitoring capabilities.

### Key Configuration Areas:
- **Retry and backoff strategies** aligned with Azure best practices
- **RU consumption control** and throttling prevention
- **Parallelism management** for optimal throughput
- **Monitoring and observability** with correlation IDs
- **Document validation** and schema enforcement
- **High cardinality partition key** configuration

### Vector Workload Considerations:
Documents with embeddings typically consume ~310 RU each, requiring careful RU/s provisioning and parallelism tuning.

### maxConcurrency Configuration:
Set to -1 to let the client/SDK maximize parallelism automatically.

**RU Scaling Considerations:**
- Higher parallelism requires more RU/s to avoid throttling
- Each physical partition can handle up to 10,000 RU/s maximum
- Large documents (like vectors) consume more RUs per operation
- Consider Dynamic Autoscale for production workloads to handle traffic spikes
- For bulk insert scenarios: provision sufficient RU/s before starting, scale down after completion

## Partition Key Best Practices

Choose the partition key path carefully (e.g., '/HotelId').

**PARTITION KEY BEST PRACTICES:**
- Choose high cardinality fields (many distinct values across documents)
- Avoid "hot" partition keys that concentrate traffic on few partitions
- Good examples: userId, deviceId, locationId, customerId
- Poor examples: status, category, type, country (low cardinality)
- Aim for even distribution of data and requests across partitions
- Consider your query patterns - partition key should be used in most queries

**For large insert workloads:**
- High cardinality enables better parallelism across multiple physical partitions
- Each physical partition can handle up to 10,000 RU/s maximum
- More partitions = better insert performance for high-volume scenarios

## Error Handling

### Structured Error Information (`ErrorDetails`)

Provides comprehensive error parsing for Azure Cosmos DB operations, including proper handling of rate limiting headers and retry guidance.

**Key features:**
- Extracts x-ms-retry-after-ms header from 429 (rate limiting) responses
- Categorizes errors as retryable vs non-retryable based on Azure best practices
- Preserves raw error objects for advanced debugging scenarios
- Provides human-readable error messages with Azure-specific context

### Error Parsing (`parseCosmosError`)

Handles Azure Cosmos DB SDK specific error structures and extracts critical information for proper retry logic and user feedback. Follows Azure best practices for error categorization and retry-after header handling.

**Key functionality:**
- Extracts x-ms-retry-after-ms header from 429 rate limiting responses
- Handles multiple error code formats (statusCode, code, status, x-ms-substatus)
- Categorizes errors as retryable vs non-retryable per Azure guidelines
- Provides context-aware error messages for common Azure Cosmos DB scenarios
- Preserves raw error objects for advanced debugging and telemetry

**References:**
- Azure Cosmos DB SDK best practices for resilient applications
- Microsoft Learn documentation on error handling patterns

## Performance Monitoring (`MetricsCollector`)

Provides detailed performance analytics, RU consumption tracking, and scaling insights for Azure Cosmos DB bulk insert operations. Essential for optimizing RU provisioning and identifying performance bottlenecks.

**Capabilities:**
- Real-time RU consumption monitoring and rate calculation
- Latency tracking with statistical analysis (avg, max)
- Error categorization and frequency analysis
- RU scaling recommendations based on consumption patterns
- Physical partition analysis for optimizing parallelism
- Production-ready metrics for Azure Monitor integration

**Use case:** Vector document workloads consuming ~310 RU per operation benefit significantly from continuous monitoring and scaling recommendations.

## Document Validation (`validateDocument`)

Validates documents before insertion to prevent errors and optimize performance. Includes Azure Cosmos DB specific validations and best practices for vector document workloads with large embeddings.

**Validation checks:**
- Document structure and JSON validity
- Required ID field presence (configurable field name)
- Document size limits (Azure Cosmos DB 2MB maximum)
- Optional schema validation for type safety
- Vector embedding compatibility for large documents

**Performance considerations:**
- Large vector documents (~310 RU each) require special handling
- Document size directly impacts RU consumption and latency
- Validation prevents costly insertion failures and retries

## RU Scaling Guidance

### Before Starting Large Insert Operations

**RU Scaling Guidance for Large Insert Workloads:**

Azure Cosmos DB provides several strategies for handling high-volume insert operations:

#### 1. Dynamic Autoscale (Recommended for Production):
- Automatically scales RU/s from 10% to 100% of max RU/s based on demand
- Best for unpredictable workloads with varying traffic patterns
- Set max RU/s high enough to handle peak insert loads
- Automatically scales down during low activity periods

#### 2. Manual Provisioned Throughput:
- Set RU/s high during large insert operations (ingestion periods)
- Scale back down after bulk operations complete to save costs
- Requires manual intervention but provides precise control
- Good for predictable batch processing scenarios

#### 3. Throughput Buckets (Preview):
- Fine-grained control over RU/workload distribution
- Allows bursting beyond provisioned throughput for short periods
- Ideal for handling traffic spikes during bulk operations

### Physical Partition Considerations:
- Each physical partition can handle up to 10,000 RU/s maximum
- Cosmos DB creates new physical partitions approximately every ~10,000 RU/s
- More partitions = better parallelism for insert operations
- High cardinality partition keys enable better distribution across partitions

### For Vector Workloads:
Vector documents consume ~310 RU each, so consider:
- 1,000 docs = ~310,000 RU total (requires multiple physical partitions)
- For optimal performance: provision 5,000-15,000 RU/s during ingestion
- Use Dynamic Autoscale with max 15,000 RU/s for production workloads

## Main Function Implementation

The main execution function demonstrates enterprise-grade Azure Cosmos DB bulk insert with complete example showcasing best practices for large-scale document insertion with vector embeddings.

### Features Demonstrated:
- Passwordless authentication with Managed Identity
- High cardinality partition key configuration for optimal distribution
- Vector document handling (~310 RU per document with 1536-dimensional embeddings)
- Comprehensive RU scaling guidance and recommendations
- Real-time performance monitoring and throttling detection
- Azure best practices for production workloads

### Vector Workload Specifics:
- Documents contain text-embedding-ada-002 embeddings (1536 dimensions)
- Each document consumes ~310 RU due to size and complexity
- Requires careful RU provisioning and parallelism tuning
- Benefits from Dynamic Autoscale and high RU provisioning during ingestion

### Production Recommendations:
- Use Dynamic Autoscale with max 15,000+ RU/s for vector workloads
- Enable Throughput Buckets for burst capacity handling
- Monitor with Azure Application Insights for comprehensive observability
- Implement proper retry policies and exponential backoff strategies

## Database and Container Management

### Ensuring Resources Exist (`ensureDatabaseAndContainer`)

Creates database and container resources if they don't exist, with proper partition key configuration for large-scale insert operations. Provides comprehensive error handling and guidance for manual resource creation.

**Key features:**
- Automatic database and container creation with proper partition key setup
- Validation of partition key configuration (cannot be changed after creation)
- Comprehensive error messages with Azure CLI commands for manual setup
- Best practices guidance for partition key selection
- Support for high cardinality partition keys required for vector workloads

**IMPORTANT:** Partition key cannot be changed after container creation. Ensure the partition key provides good distribution for your data and query patterns.

## Circuit Breaker Implementation (Educational)

**IMPORTANT:** This is a custom implementation for educational purposes.

For production workloads, consider using Azure Cosmos DB's native throughput management:
- **Throughput Buckets (Preview):** https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/throughput-buckets?tabs=dotnet
- **Dynamic Autoscale:** Automatically adjusts RU/s based on demand
- **Request rate limiting:** Handled by the SDK with built-in retry policies

### Preferred Approach for RU/Workload Resource Contention Control:
1. Use Dynamic Autoscale with appropriate max RU/s limits
2. Configure Throughput Buckets (when available) for fine-grained control
3. Let the Azure Cosmos DB SDK handle retry logic and backoff

## Azure Best Practices for Production

### Recommended Azure Features:
- **Dynamic Autoscale:** Automatic RU/s scaling based on demand (10% to 100% of max)
- **Throughput Buckets (Preview):** Fine-grained RU/workload burst control
- **Azure Monitor integration:** For comprehensive observability
- **Managed Identity authentication:** For secure, passwordless connections

### RU Scaling Strategies:

#### 1. Dynamic Autoscale (Recommended):
- Enable autoscale with appropriate max RU/s (e.g., 15,000 RU/s)
- Automatically scales from 10% to 100% based on demand
- Handles traffic spikes without manual intervention
- Scales down during low activity to reduce costs

#### 2. Manual Provisioned Throughput:
- Scale UP RU/s before bulk insert operations
- Monitor RU consumption and 429 throttling errors
- Scale DOWN after bulk operations complete
- Good for predictable batch processing workloads

#### 3. Throughput Buckets (Preview):
- Fine-grained control over RU bursting behavior
- Handle short-term traffic spikes beyond provisioned capacity
- Ideal for workloads with occasional bulk operations

#### 4. Physical Partition Optimization:
- Each partition handles maximum 10,000 RU/s
- Higher RU/s = more partitions = better insert parallelism
- Use high cardinality partition keys for even distribution
- Current setup: partition key enables good distribution

## Troubleshooting

### Throttling Detection (429 errors)
When 429 errors are detected, the system provides scaling recommendations:
- Increase provisioned RU/s or enable Dynamic Autoscale
- Consider using Throughput Buckets for burst capacity
- Reduce parallelism (maxConcurrency) or batch size
- Verify partition key has high cardinality for even distribution

### Performance Monitoring
The system provides real-time insights:
- RU consumption rate (RU/s and RU/min)
- Scaling recommendations based on consumption patterns
- Physical partitions analysis for optimization
- Error breakdown and frequency analysis

## Links and References

- [Azure Cosmos DB Throughput Buckets](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/throughput-buckets?tabs=dotnet)
- [Design Resilient Applications with Azure Cosmos DB SDKs](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/resilient-applications)
- [Azure Cosmos DB Partitioning Overview](https://learn.microsoft.com/en-us/azure/cosmos-db/partitioning-overview)
- [Common Azure Cosmos DB REST Response Headers](https://learn.microsoft.com/en-us/rest/api/cosmos-db/common-cosmosdb-rest-response-headers)