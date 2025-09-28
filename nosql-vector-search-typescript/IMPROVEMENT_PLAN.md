# Azure Cosmos DB Insert-at-Scale Improvement Plan

## Overview
This document outlines the planned improvements to the `insert-at-scale.ts` file based on expert feedback received on September 26, 2025. The changes focus on aligning with Azure Cosmos DB best practices and removing potentially confusing or inaccurate guidance.

## Feedback Summary
The feedback highlighted several areas for improvement:
- MaxConcurrency should support -1 for SDK-managed parallelism
- Pricing estimates are difficult to provide accurately and should be simplified/removed
- Current operation cost calculations are confusing between different pricing models
- Circuit breaker pattern may not be the best approach; throughput buckets are preferred
- Retry logic should follow official Azure Cosmos DB SDK best practices
- Need better guidance on partition key selection and RU scaling strategies

## Planned Changes

### ✅ 1. Update MaxConcurrency to support -1
**Status: COMPLETED**
- Modified `maxConcurrency` type definition and documentation
- Updated default configuration to use `-1` (let SDK maximize parallelism)
- Updated main function configuration

### 🔄 2. Remove/simplify pricing estimates
**Status: IN PROGRESS**
- Remove complex pricing calculations from the main output
- Simplify or remove the `estimateServerlessCost()` and `estimateMonthlyRUCost()` calls
- Focus on showing RU consumption metrics instead of cost projections
- Remove confusing monthly cost projections

### 📋 3. Fix pricing model confusion
**Status: PLANNED**
- Address confusion between serverless vs provisioned throughput vs autoscale pricing
- Clarify which pricing model is being used in calculations
- Ensure calculations are accurate for each specific model
- Remove or clearly separate different pricing model examples

### 📋 4. Update circuit breaker guidance
**Status: PLANNED**
- Remove or significantly modify the circuit breaker implementation
- Replace with guidance about Azure Cosmos DB's **throughput buckets** feature (in preview)
- Point users to Microsoft Learn documentation: https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/throughput-buckets?tabs=dotnet
- Focus on RU/workload based resource contention controls

### 📋 5. Improve retry logic best practices
**Status: PLANNED**
- Update retry logic to follow Azure Cosmos DB SDK best practices
- Implement retry patterns based on specific status codes
- Reference: "Design Resilient Applications with Azure Cosmos DB SDKs" Microsoft Learn documentation
- Ensure retry logic aligns with official SDK recommendations

### 📋 6. Add partition key best practices guidance
**Status: PLANNED**
- Add comprehensive documentation about partition key selection
- Emphasize the importance of **high cardinality** partition keys
- Provide guidance on ensuring workload is spread across multiple partitions
- Include examples of good vs. poor partition key choices for large insert workloads
- Explain how partition key affects performance and scalability

### 📋 7. Add RU scaling guidance
**Status: PLANNED**
- Document scaling strategies for large insert workloads
- Guidance on setting RU/s high during ingestion periods and scaling back down
- Information about **Dynamic Autoscale** capability and tuning max RU/s
- Explain physical partition creation (every ~10,000 RU/s creates new partition)
- Benefits of multiple physical partitions for large insert workloads (each partition capped at 10,000 RU/s max)

### 📋 8. Update documentation and comments
**Status: PLANNED**
- Review and update all JSDoc comments
- Update inline documentation throughout the file
- Modify console output to provide better guidance
- Ensure all documentation reflects Azure Cosmos DB best practices
- Remove outdated or potentially misleading information

## Implementation Priority

1. **High Priority (Immediate)**:
   - Remove/simplify pricing estimates (item 2)
   - Fix pricing model confusion (item 3)
   - Update circuit breaker guidance (item 4)

2. **Medium Priority**:
   - Improve retry logic best practices (item 5)
   - Add partition key best practices guidance (item 6)

3. **Low Priority (Polish)**:
   - Add RU scaling guidance (item 7)
   - Update documentation and comments (item 8)

## Key Principles to Follow

### Partition Key Best Practices
- Choose high cardinality partition keys (distinct values across documents)
- Avoid "hot" partition keys that concentrate traffic
- Consider the query patterns when selecting partition keys
- Understand that good partition key distribution enables better parallelism

### Scaling Strategies
- **Initial Ingestion**: Set RU/s high for large insert periods
- **Post-Ingestion**: Scale back down to normal operational levels
- **Dynamic Autoscale**: Use Azure's autoscale capability with appropriate max RU/s limits
- **Physical Partitions**: Understand that every ~10,000 RU/s creates a new physical partition
- **Parallel Processing**: More physical partitions = better insert performance (each capped at 10,000 RU/s)

### Retry Logic
- Follow official Azure Cosmos DB SDK retry best practices
- Implement status-code specific retry logic
- Use appropriate backoff strategies
- Handle different error types correctly (retryable vs. non-retryable)

### Resource Management
- Prefer Azure's native throughput management features
- Use throughput buckets (preview) for advanced RU/workload controls
- Avoid custom circuit breakers when native solutions exist
- Let the SDK handle parallelism optimization when possible

## Expected Outcomes

After implementing these changes, the `insert-at-scale.ts` file will:
- Provide more accurate and helpful guidance for large-scale insert operations
- Align with current Azure Cosmos DB best practices and recommendations
- Remove confusing or potentially misleading pricing calculations
- Focus on actionable performance and scalability guidance
- Reference official Microsoft documentation for advanced features

## References

- [Azure Cosmos DB Throughput Buckets](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/throughput-buckets?tabs=dotnet)
- [Design Resilient Applications with Azure Cosmos DB SDKs](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/resilient-applications)
- [Azure Cosmos DB Partitioning](https://learn.microsoft.com/en-us/azure/cosmos-db/partitioning-overview)
- [Azure Cosmos DB Request Units](https://learn.microsoft.com/en-us/azure/cosmos-db/request-units)