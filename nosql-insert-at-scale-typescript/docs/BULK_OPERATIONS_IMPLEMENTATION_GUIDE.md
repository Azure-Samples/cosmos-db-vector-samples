# Azure Cosmos DB Bulk Operations Implementation Guide

This guide provides a language-agnostic specification for implementing enterprise-grade bulk insert and delete operations for Azure Cosmos DB NoSQL. Use this as a blueprint to create equivalent functionality in any programming language.

## Overview

This implementation demonstrates how to perform large-scale document operations (insert/delete) efficiently using Azure Cosmos DB's bulk operations API while maintaining enterprise-grade reliability, performance monitoring, and error handling.

## Architecture Components

### 1. Core Operation Functionality

#### **Bulk Insert Operations**
- **Purpose**: Main entry point for bulk document insertion workflows
- **Key Responsibilities**:
  - Load and validate JSON data files containing documents with vector embeddings
  - Configure batch processing parameters based on document size and system capacity
  - Orchestrate the resilient bulk insert process with comprehensive error handling
  - Provide real-time performance analysis and cost estimation during operations
  - Display comprehensive operation results including success rates, RU consumption, and timing metrics

#### **Bulk Delete Operations**
- **Purpose**: Main entry point for bulk document deletion workflows
- **Key Responsibilities**:
  - Query all existing documents in the container to retrieve their IDs and partition keys
  - Orchestrate the resilient bulk delete process with comprehensive error handling
  - Provide real-time performance analysis and cost estimation during operations
  - Display comprehensive operation results including success rates, RU consumption, and timing metrics

### 2. Core Utility Functionality

#### **Cosmos DB Client Management**
- **Purpose**: Low-level Azure Cosmos DB operations and authentication
- **Key Functions**:
  - **Authentication Support**: Implement both key-based and passwordless authentication methods (note: the reference implementation uses passwordless authentication exclusively)
  - **Document Validation**: Ensure documents have required fields (`id`, partition key) before operations
  - **Database/Container Management**: Verify and access existing database and container resources
  - **Generic Bulk Executor**: Provide timeout and error handling wrapper for all bulk operations
  - **Document Queries**: Execute efficient queries for deletion scenarios (retrieving only ID and partition key fields)

#### **Resilient Bulk Operations**
- **Purpose**: Enterprise-grade resilient bulk operations with comprehensive error handling
- **Key Functions**:
  - **Resilient Insert Processing**: Implement batch processing with retry logic and circuit breaker patterns for insert operations
  - **Resilient Delete Processing**: Implement batch processing optimized for deletion operations with appropriate retry strategies
  - **Error Classification**: Distinguish between retryable errors (timeouts, rate limiting) and non-retryable errors (authorization, validation)
  - **Custom Retry Logic**: Implement exponential backoff for errors not automatically handled by the SDK
  - **Performance Monitoring**: Collect and analyze real-time metrics during bulk operations

#### **Supporting Functionality**
- **Performance Metrics**: Real-time monitoring of RU consumption, latency measurement, and throughput calculation
- **Cost Estimation**: Calculate operational costs for different Azure Cosmos DB pricing models (serverless, provisioned, autoscale)
- **Utility Operations**: File I/O operations, JSON processing, configuration management, and helper functions

## Implementation Requirements

### 1. Mandatory Azure Cosmos DB API Usage

**CRITICAL**: All insert and delete operations MUST use the bulk operations API available in your language's Azure Cosmos DB SDK:
- **Insert**: Use bulk create operations (equivalent to `BulkOperationType.Create` with `executeBulkOperations` in the JavaScript/TypeScript SDK)
- **Delete**: Use bulk delete operations (equivalent to `BulkOperationType.Delete` with `executeBulkOperations` in the JavaScript/TypeScript SDK)  
- **Prohibited**: Direct individual item operations (create, upsert, delete, replace), deprecated bulk methods

**Authentication Support**: Your implementation must support both key-based and passwordless authentication methods for flexibility, though the reference articles and tutorials will demonstrate passwordless authentication exclusively as the recommended secure approach.

### 2. Required Document Structure

#### **For Insert Operations**:
```json
{
  "id": "document-identifier",           // Required by Cosmos DB
  "HotelId": "partition-key-value",      // Custom partition key field
  "HotelName": "Hotel Name",
  "Description": "Hotel description",
  "embedding": [0.1, 0.2, ...],         // Vector embeddings (1536 dimensions)
  // ... other document properties
}
```

#### **For Delete Operations**:
```json
{
  "id": "document-identifier",
  "partitionKey": "partition-key-value"
}
```

### 3. Bulk Operation Configuration

#### **Required Operation Input Structure (TypeScript Reference)**:

The following examples show the TypeScript/JavaScript SDK structure. Implement equivalent functionality using your language's SDK patterns and data structures:

**Insert Operations (TypeScript Example)**:
```typescript
{
  operationType: BulkOperationType.Create,
  partitionKey: document[partitionKeyField],  // REQUIRED
  resourceBody: documentWithIdField           // REQUIRED: must contain 'id' field
}
```

**Delete Operations (TypeScript Example)**:
```typescript
{
  operationType: BulkOperationType.Delete,
  id: documentId,                             // REQUIRED
  partitionKey: partitionKeyValue             // REQUIRED
}
```

**Language Implementation Notes**:
- Use your language's idiomatic approach for defining operation structures (classes, structs, dictionaries, etc.)
- Ensure all required fields are included: operation type, partition key, and either document body (insert) or document ID (delete)
- Follow your language's naming conventions (camelCase, snake_case, PascalCase, etc.)

### 4. Response Handling

#### **Bulk Operation Result Structure (TypeScript Reference)**:

The following shows the TypeScript/JavaScript SDK response structure. Map this to your language's equivalent types and error handling patterns:

```typescript
{
  operationInput: OperationInput,    // Original operation
  response?: {                       // Success response
    statusCode: number,              // HTTP status (200, 201, etc.)
    requestCharge: number,           // RU consumption
    resourceBody?: any               // Response body (for successful operations)
  },
  error?: {                         // Error response
    code: number,                   // Error code
    message: string                 // Error description
  }
}
```

**Language Implementation Notes**:
- Use your language's preferred error handling patterns (exceptions, result types, optional types, etc.)
- Extract essential information: HTTP status codes, RU consumption, error details
- Implement response processing that is natural for your language's SDK and type system

## Core Implementation Patterns

### 1. Document Preparation

#### **Essential Steps**:
1. **ID Field Generation**: Ensure every document has an `id` field
   - Use existing custom ID field value OR generate UUID if missing
   - Example: `document.id = document.HotelId || generateUUID()`

2. **Partition Key Validation**: Verify partition key field exists and has value
   - Example: Validate `HotelId` field is present and not empty

3. **Document Validation**: Basic schema validation before operations
   - Check required fields, data types, constraints

### 2. Batch Processing Strategy

#### **Configuration Parameters**:
- **Batch Size**: 5-100 documents per batch (optimize based on document size)
- **Concurrency**: Number of parallel batch operations
- **Timeout**: Per-batch operation timeout (default: 30 seconds)

#### **Processing Flow**:
1. Split documents into batches of configured size
2. Process batches with controlled concurrency
3. Monitor progress and performance metrics
4. Handle failures with retry logic

### 3. Error Handling and Retry Logic

#### **Error Classification**:

**Retryable Errors** (implement custom retry):
- `408` - Request Timeout
- `429` - Too Many Requests (rate limiting)
- `449` - Retry With
- `503` - Service Unavailable
- `500` - Internal Server Error (transient)

**Non-Retryable Errors** (permanent failures):
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found (for updates/deletes)
- `409` - Conflict

#### **Retry Strategy**:
- **Maximum Retries**: 3 attempts per batch
- **Exponential Backoff**: `Math.min(baseDelay * Math.pow(2, attempt-1), maxDelay)`
- **Rate Limit Handling**: Special handling for 429 errors with longer delays
- **Circuit Breaker**: Stop retrying after consecutive failures

### 4. Performance Monitoring

#### **Required Metrics**:
- **Request Units (RUs)**: Track consumption per operation and total
- **Latency**: Measure operation timing (per document and per batch)
- **Throughput**: Documents processed per second
- **Success/Failure Rates**: Operation outcome tracking
- **Error Distribution**: Count errors by type/code

#### **Cost Estimation**:
- **Serverless**: $0.000344 per 1M RUs (as of 2024)
- **Provisioned**: $0.000128 per RU/hour (as of 2024)
- **Autoscale**: $0.000192 per RU/hour (as of 2024)

## Minimum Implementation Checklist

### 1. Core Functional Areas Required

- [ ] **Main Insert Application**: Entry point and orchestration for bulk insertion operations
- [ ] **Main Delete Application**: Entry point and orchestration for bulk deletion operations  
- [ ] **Authentication Module**: Client creation supporting both key-based and passwordless authentication methods
- [ ] **Bulk Operations Core**: Generic bulk operation executor with timeout and comprehensive error handling
- [ ] **Resilience Implementation**: Error handling, retry logic, circuit breaker patterns, and batch processing
- [ ] **Performance Monitoring**: Real-time metrics collection, RU tracking, and cost calculation
- [ ] **Configuration Management**: Environment variable handling, settings management, and operational parameters

### 2. Essential Function Implementation

#### **Client Management Functionality**:
- [ ] Create Cosmos DB client with key-based authentication (for flexibility)
- [ ] Create Cosmos DB client with passwordless authentication (recommended approach used in reference articles)
- [ ] Verify database and container existence before operations
- [ ] Handle authentication errors and provide clear error messages

#### **Document Processing Operations**:
- [ ] Validate document structure ensuring required fields are present (id, partition key)
- [ ] Generate document IDs when missing from source data
- [ ] Execute efficient queries for deletion scenarios (retrieving only essential fields: id + partition key)
- [ ] Implement document preparation logic for bulk operations

#### **Bulk Operations Implementation**:
- [ ] Execute bulk insert operations with timeout and comprehensive error handling
- [ ] Execute bulk delete operations with timeout and comprehensive error handling  
- [ ] Handle bulk operation response structures correctly (success and error scenarios)
- [ ] Process both individual operation results and batch-level outcomes
- [ ] Implement proper resource cleanup and connection management

#### **Resilience Feature Implementation**:
- [ ] Implement batch document processing with configurable batch sizes
- [ ] Create custom retry logic for retryable errors (timeouts, rate limiting, transient failures)
- [ ] Implement exponential backoff strategy with maximum retry limits
- [ ] Develop circuit breaker pattern to prevent cascading failures
- [ ] Provide progress tracking and real-time reporting during operations

#### **Performance Monitoring Implementation**:
- [ ] Track Request Unit (RU) consumption per operation and in aggregate
- [ ] Measure latency for individual documents and batch operations
- [ ] Calculate throughput (documents processed per second)
- [ ] Monitor error rates and categorize error types
- [ ] Estimate operational costs across different pricing models (serverless, provisioned, autoscale)

### 3. Configuration Requirements

#### **Environment Variables**:
```bash
# Cosmos DB Configuration
COSMOS_ENDPOINT=https://your-account.documents.azure.com
COSMOS_KEY=your-primary-key
COSMOS_DB_NAME=Hotels
COSMOS_CONTAINER_NAME=hotels-insert-scale

# Operation Configuration
PARTITION_KEY_PATH=/HotelId
BATCH_SIZE=50
MAX_CONCURRENCY=5
BULK_INSERT_TIMEOUT_MS=30000

# Data Configuration
DATA_FILE_WITH_VECTORS=./HotelsData_text_embedding_small_3.json
EMBEDDED_FIELD=embedding
EMBEDDING_DIMENSIONS=1536

# Display Configuration
SHOW_COST=true
```

## Performance Optimization Guidelines

### 1. Batch Size Optimization
- **Small Documents** (< 10KB): 50-100 documents per batch
- **Large Documents** (> 100KB): 5-20 documents per batch
- **Vector Documents** (with embeddings): 20-50 documents per batch

### 2. Concurrency Tuning
- **Low RU containers** (< 1000 RU/s): 1-3 concurrent batches
- **Medium RU containers** (1000-10000 RU/s): 3-10 concurrent batches
- **High RU containers** (> 10000 RU/s): 10+ concurrent batches

### 3. Error Handling Best Practices
- Log detailed error information for debugging
- Implement graceful degradation for persistent failures
- Provide clear user feedback on operation progress
- Save failed documents for manual review

## Language-Specific Implementation Notes

### For SDK Integration
1. **Find Bulk Operations API**: Locate the equivalent of bulk operations functionality in your target language's Azure Cosmos DB SDK
2. **Understand Response Format**: Map bulk operation result structures to your language-specific types and error handling patterns
3. **Implement Async Patterns**: Use appropriate asynchronous programming patterns (async/await, promises, futures, etc.) that are idiomatic for your language
4. **Handle JSON Serialization**: Ensure proper document serialization/deserialization using your language's preferred JSON handling libraries
5. **Authentication Implementation**: Implement both authentication methods (key-based and passwordless) even though the reference articles use passwordless exclusively

### Language-Specific Naming and Structure Guidelines
- **File Organization**: Structure your code using conventions appropriate for your language (modules, packages, namespaces, etc.)
- **Function Naming**: Use naming conventions that are idiomatic for your language rather than translating names directly
- **Error Handling**: Implement error handling patterns that are natural for your language (exceptions, result types, error unions, etc.)
- **Configuration Management**: Use configuration patterns typical for your language and ecosystem
- **Dependency Management**: Use your language's standard package/dependency management system

### Common Pitfalls to Avoid
- ❌ Using individual item operations instead of bulk operations APIs
- ❌ Missing partition key in bulk operation input structures
- ❌ Incorrect response structure handling (accessing wrong properties or missing error cases)
- ❌ Not implementing proper retry logic for transient failures
- ❌ Ignoring Request Unit (RU) consumption and cost implications
- ❌ Hardcoding authentication method instead of supporting both key-based and passwordless options
- ❌ Not providing adequate progress feedback during long-running operations

## Success Criteria

A successful implementation should demonstrate:
- ✅ **100% usage of bulk operations APIs** for insert/delete (no individual item operations)
- ✅ **Proper error handling** with retry logic and graceful failure management
- ✅ **Performance monitoring** with RU tracking and cost estimation across different pricing models
- ✅ **Scalable architecture** that efficiently handles datasets of 1000+ documents
- ✅ **Enterprise reliability** with timeout handling and circuit breaker patterns
- ✅ **Clear user feedback** with progress reporting and detailed operation results
- ✅ **Flexible authentication** supporting both key-based and passwordless methods (while using passwordless in reference articles)
- ✅ **Language-idiomatic code** that follows best practices and conventions for the target programming language

This guide provides the foundation for implementing equivalent functionality in any programming language while maintaining the same level of reliability, performance, and enterprise readiness as the TypeScript reference implementation.