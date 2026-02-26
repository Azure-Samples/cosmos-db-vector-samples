# Vector Index Algorithms & Query Behavior in Azure Cosmos DB

**Purpose:** Learn the fundamental differences between ANN (Approximate Nearest Neighbor) algorithms, how they affect search accuracy (recall) and latency, and which algorithm fits your use case. This article assumes you've already created an index and now want to understand algorithm trade-offs and optimize for performance.

## Prerequisites

- Completion of the [Indexing for Embeddings](../cosmos-db-topic2/) tutorial
- An Azure account with an active subscription
- Azure Cosmos DB account with NoSQL API
- Node.js 18.x or later
- Azure OpenAI resource with an embeddings model deployed
- Understanding of vector index basics

## What You'll Learn

In this article, you'll learn:
- The fundamental differences between Flat, QuantizedFlat, and DiskANN algorithms
- How each algorithm affects recall (accuracy) and latency
- When to use each algorithm based on dataset size and requirements
- How to tune algorithm-specific parameters
- Benchmark patterns to measure recall vs. latency trade-offs

## Understanding ANN Algorithms

Azure Cosmos DB supports three vector index algorithms, each with different characteristics:

### Algorithm Comparison Matrix

| Algorithm | Search Type | Recall | Latency | Memory Usage | Best For |
|-----------|-------------|--------|---------|--------------|----------|
| **Flat** | Exact | 100% | Slow on large datasets | High | < 10K vectors, highest accuracy required |
| **QuantizedFlat** | Approximate | 95-99% | Moderate | Low (compressed) | General use, memory-constrained scenarios |
| **DiskANN** | Approximate | 90-99% (tunable) | Fast | Moderate (disk-based) | **Recommended**: > 10K vectors, scalability |

### When to Use Each Algorithm

#### Flat Index
- **Use when**: Absolute accuracy is required (100% recall)
- **Dataset size**: Small datasets (< 10,000 vectors)
- **Trade-off**: Slower queries as dataset grows (linear scan)
- **Note**: There's almost no use case where this should be used over DiskANN

**Example use case**: Legal document retrieval where every match must be found

#### QuantizedFlat Index
- **Use when**: Memory optimization is important
- **Dataset size**: Medium datasets with memory constraints
- **Trade-off**: Slightly reduced recall (~95-99%) vs. Flat
- **Memory benefit**: Significantly smaller index footprint

**Example use case**: Edge deployments with limited memory

#### DiskANN Index (Recommended)
- **Use when**: Most scenarios with more than a few tens of thousands of vectors
- **Dataset size**: Large datasets (> 10,000 vectors)
- **Trade-off**: Tunable recall vs. latency (90-99% recall typical)
- **Scalability**: Best performance on very large datasets (millions of vectors)
- **Tuning**: Supports `efSearch` and other parameters for precision control

**Example use case**: Production RAG applications, semantic search at scale

### Key Takeaway
**DiskANN should be used in most scenarios** where customers expect to have more than a few tens of thousands of vectors. It provides the best balance of performance, scalability, and tunable accuracy.

## Algorithm Parameters

### DiskANN Tuning Parameters

DiskANN supports tuning parameters that control the recall/latency trade-off:

| Parameter | Description | Default | Impact |
|-----------|-------------|---------|--------|
| **efSearch** | Search expansion factor | 40 | Higher = better recall, slower queries |
| **metric** | Distance function | cosine | Affects similarity calculation |

**Tuning guidance:**
- Start with defaults (efSearch: 40)
- Increase efSearch (e.g., 80, 100) for higher recall requirements
- Decrease efSearch (e.g., 20) for lower latency requirements
- Monitor recall vs. latency trade-offs with your specific data

### Distance Functions
### How to Set efSearch in Cosmos DB

**Important**: In Azure Cosmos DB, `efSearch` is set at **INDEX CREATION time**, not at query time. You configure it in the container's vector index policy.

#### Setting efSearch in Container Definition

```javascript
const containerDefinition = {
  id: "embeddings_diskann",
  partitionKey: { paths: ["/category"] },
  
  indexingPolicy: {
    vectorIndexes: [
      {
        path: "/embedding",
        type: "diskANN",
        
        // DiskANN-specific options
        diskANNOptions: {
          efConstruction: 400,  // Build-time parameter (affects index quality)
          efSearch: 40          // Query-time default (can't change per query)
        }
      }
    ]
  },
  
  vectorEmbeddingPolicy: {
    vectorEmbeddings: [
      {
        path: "/embedding",
        dataType: "float32",
        dimensions: 1536,
        distanceFunction: "cosine"
      }
    ]
  }
};

await database.containers.create(containerDefinition);
```

#### Understanding efConstruction vs efSearch

| Parameter | When Set | What It Does | Tunable? |
|-----------|----------|--------------|----------|
| **efConstruction** | Index build time | Controls index quality during creation | No (fixed at creation) |
| **efSearch** | Index creation (default for queries) | Default search expansion at query time | No (fixed at creation) |

**Key Limitation**: Unlike some vector databases, Cosmos DB does **not** allow per-query efSearch tuning. The value you set during container creation is used for all queries.

#### To Change efSearch

If you need a different efSearch value, you must:

1. **Create a new container** with the desired efSearch
2. **Migrate your data** to the new container
3. **Update your application** to use the new container

```javascript
// Example: Creating containers with different efSearch values for comparison

// Container 1: Default efSearch (40)
const containerDefault = await database.containers.create({
  id: "diskann_ef40",
  indexingPolicy: {
    vectorIndexes: [{
      path: "/embedding",
      type: "diskANN",
      diskANNOptions: { efConstruction: 400, efSearch: 40 }
    }]
  },
  // ... rest of definition
});

// Container 2: Higher efSearch for better recall (80)
const containerHighRecall = await database.containers.create({
  id: "diskann_ef80",
  indexingPolicy: {
    vectorIndexes: [{
      path: "/embedding",
      type: "diskANN",
      diskANNOptions: { efConstruction: 400, efSearch: 80 }
    }]
  },
  // ... rest of definition
});

// Insert same data into both containers
await insertDocuments(containerDefault.container, documents);
await insertDocuments(containerHighRecall.container, documents);

// Compare query performance
const resultsEf40 = await queryContainer(containerDefault.container, embedding);
const resultsEf80 = await queryContainer(containerHighRecall.container, embedding);

console.log(`efSearch=40: ${resultsEf40.latency}ms, recall: ${resultsEf40.recall}%`);
console.log(`efSearch=80: ${resultsEf80.latency}ms, recall: ${resultsEf80.recall}%`);
```

#### Tuning Recommendations

Since efSearch is fixed at container creation:

1. **Start with efSearch=40** (default) for most workloads
2. **Test thoroughly** before deploying to production
3. **Create test containers** with different efSearch values (20, 40, 60, 80, 100)
4. **Measure recall and latency** on your actual data
5. **Choose the best balance** for your SLOs before production deployment

**Planning checklist:**
- ☐ Understand you can't change efSearch after container creation
- ☐ Test with representative queries and data volumes
- ☐ Measure recall vs. latency for different efSearch values
- ☐ Choose efSearch that meets your recall AND latency requirements
- ☐ Document your choice for team reference


All algorithms support these distance functions:

| Function | Use Case | Range |
|----------|----------|-------|
| **cosine** | Most common; measures angle between vectors | 0 (identical) to 2 (opposite) |
| **euclidean** | Measures geometric distance | 0 (identical) to ∞ |
| **dotproduct** | For normalized vectors | -∞ to ∞ |

## Sample Scenario

This sample demonstrates:
1. Creating containers with different index algorithms
2. Inserting identical datasets into each container
3. Running the same queries across all algorithms
4. Measuring and comparing recall, latency, and RU consumption
5. Visualizing algorithm trade-offs

## Complete Working Sample

### Setup

Create a new Node.js project:

```bash
npm init -y
npm install @azure/cosmos @azure/openai dotenv
```

### Environment Configuration

Create `.env` file:

```env
# Cosmos DB Configuration
COSMOS_ENDPOINT=https://<your-cosmos-account>.documents.azure.com:443/
COSMOS_KEY=<your-cosmos-key>
COSMOS_DATABASE_NAME=vectordb

# Azure OpenAI Configuration
AZURE_OPENAI_ENDPOINT=https://<your-openai-resource>.openai.azure.com/
AZURE_OPENAI_API_KEY=<your-openai-key>
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=text-embedding-ada-002
AZURE_OPENAI_EMBEDDING_DIMENSIONS=1536
```

### Implementation

The complete implementation includes:

1. **Test Data Generator**: Creates consistent test datasets
2. **Algorithm Benchmark**: Tests each algorithm with identical queries
3. **Recall Calculator**: Compares results against ground truth (Flat index)
4. **Performance Metrics**: Captures latency, RU consumption, and recall

Key functions:
- `createContainerWithAlgorithm()`: Creates containers with different algorithms
- `runBenchmark()`: Executes identical queries across all algorithms
- `calculateRecall()`: Measures accuracy vs. ground truth
- `comparePerformance()`: Generates comparison reports

## Benchmark Results

### Expected Performance Characteristics

Based on a dataset of 10,000 documents with 1536-dimensional embeddings:

#### Flat Index
```
Average Latency: 450ms
Recall: 100% (exact search)
RU/s: ~15 RU per query
Memory: High
```

#### QuantizedFlat Index
```
Average Latency: 180ms
Recall: 96-98%
RU/s: ~10 RU per query
Memory: Low (60% reduction vs. Flat)
```

#### DiskANN Index
```
Average Latency: 85ms (efSearch=40)
Recall: 92-95% (efSearch=40)
RU/s: ~8 RU per query
Scalability: Excellent

Tuned (efSearch=80):
  Latency: 120ms
  Recall: 96-98%
```

### Recall vs. Latency Curves

```
Recall (%)
100 │ Flat ●
 95 │          DiskANN (efSearch=80) ●
 90 │                        DiskANN (efSearch=40) ●
    │                                   QuantizedFlat ●
    └─────────────────────────────────────────────────
      0ms   50ms  100ms 150ms 200ms 250ms 300ms 400ms
                        Latency
```

## Choosing the Right Algorithm

### Decision Tree

```
Start: What's your dataset size?

├─ < 10,000 vectors
│  └─ Need 100% recall?
│     ├─ Yes → Use Flat (but consider DiskANN for consistency)
│     └─ No  → Use DiskANN (best practice)
│
└─ > 10,000 vectors
   └─ Memory constrained?
      ├─ Yes → Use QuantizedFlat
      └─ No  → Use DiskANN ✓ (recommended)

For most production scenarios: Use DiskANN
```

### Algorithm Selection Guide

| Scenario | Recommended Algorithm | Configuration |
|----------|----------------------|---------------|
| Production RAG (< 100K docs) | DiskANN | efSearch: 40 (default) |
| Production RAG (> 100K docs) | DiskANN | efSearch: 60-80 |
| Legal/Compliance (exact match) | DiskANN | efSearch: 100+ (or Flat if < 10K) |
| Edge deployment (memory limited) | QuantizedFlat | Default settings |
| Prototyping/Development | DiskANN | Default settings |

## Tuning for Your Workload

### Step 1: Establish Baseline

1. Start with DiskANN default settings (efSearch: 40)
2. Run representative queries on your data
3. Measure baseline recall and latency

### Step 2: Define Requirements

Define your SLOs (Service Level Objectives):
- **Latency target**: e.g., < 100ms for 95th percentile
- **Recall target**: e.g., > 95% for top-10 results
- **RU budget**: Maximum RU/s consumption

### Step 3: Tune Parameters

If recall is too low:
- Increase efSearch (try 60, 80, 100)
- Accept increased latency
- Monitor RU consumption

If latency is too high:
- Decrease efSearch (try 30, 20)
- Accept lower recall
- Verify recall still meets requirements

### Step 4: Validate at Scale

- Test with production-representative data volume
- Measure across different query patterns
- Monitor during peak load

## Measuring Recall

### Recall Calculation

Recall measures what percentage of true matches were found:

```
Recall = (True Positives Found) / (Total True Positives)
```

For top-k results:
```
Recall@10 = (Relevant docs in top 10) / (Total relevant docs)
```

### Sample Recall Test

```javascript
// Run same query on Flat (ground truth) and DiskANN
const flatResults = await queryFlat(embedding);
const diskANNResults = await queryDiskANN(embedding);

// Calculate overlap
const flatIds = new Set(flatResults.map(r => r.id));
const diskANNIds = new Set(diskANNResults.map(r => r.id));
const overlap = [...diskANNIds].filter(id => flatIds.has(id)).length;

const recall = overlap / flatResults.length;
console.log(`Recall: ${(recall * 100).toFixed(2)}%`);
```

## Best Practices

### Algorithm Selection
✅ **Use DiskANN for most scenarios** (> 10K vectors)
✅ Start with default parameters, tune based on measurements
✅ Test with production-scale data before deployment
✅ Monitor recall degradation as data grows

### Performance Optimization
✅ Batch similar queries to amortize index lookup costs
✅ Use appropriate top-k values (don't over-fetch)
✅ Cache frequently accessed embeddings
✅ Monitor RU consumption and scale accordingly

### Recall Management
✅ Define minimum acceptable recall for your use case
✅ Test recall regularly with evaluation datasets
✅ Consider hybrid search (lexical + vector) for better coverage
✅ Use reranking to improve top-k precision

### Production Readiness
✅ Benchmark with representative queries
✅ Load test at expected scale
✅ Set up monitoring for latency and recall
✅ Plan for index rebuild during schema changes

## Troubleshooting

### Issue: Low recall with DiskANN
**Solution**: Increase efSearch parameter; test with values 60, 80, 100

### Issue: High latency
**Solution**: Decrease efSearch or verify dataset size is appropriate for algorithm choice

### Issue: Results differ from expected
**Solution**: Verify distance function matches your use case; cosine is most common for embeddings

### Issue: RU consumption too high
**Solution**: Optimize top-k value, consider caching, or increase provisioned throughput

## Evaluation Framework

### Building a Test Suite

1. **Create evaluation dataset**
   - Representative queries from your domain
   - Known relevant documents for each query
   - Edge cases and challenging queries

2. **Define metrics**
   - Recall@k (k = 10, 20, 50)
   - Average latency (p50, p95, p99)
   - RU consumption per query
   - Cost per 1000 queries

3. **Run comparisons**
   - Test each algorithm with identical queries
   - Vary parameters (efSearch for DiskANN)
   - Measure at different data scales

4. **Analyze trade-offs**
   - Plot recall vs. latency curves
   - Calculate cost per query at target recall
   - Identify optimal configuration for your SLOs

## Complete Sample Code

The complete working sample is available in `index.js`, which includes:
- Multi-algorithm container creation
- Benchmark harness
- Recall calculation
- Performance comparison reports

## Next Steps

Now that you understand algorithm trade-offs:
- **Vector Store Semantic Search**: Apply optimized indexes to production search
- **Hybrid Search**: Combine vector and lexical search for comprehensive retrieval
- **Semantic Reranking**: Further improve top-k precision

## Clean Up Resources

```javascript
async function cleanup() {
  // Delete test containers
  await containerFlat.delete();
  await containerQuantized.delete();
  await containerDiskANN.delete();
  console.log("✓ Test containers deleted");
}
```

## Additional Resources

- [DiskANN: Fast Approximate Nearest Neighbor Search](https://www.microsoft.com/en-us/research/project/project-akupara-approximate-nearest-neighbor-search/)
- [Azure Cosmos DB Vector Search Overview](https://learn.microsoft.com/azure/cosmos-db/vector-search-overview)
- [Performance tuning guide](https://learn.microsoft.com/azure/cosmos-db/performance-tips)
- [Request Units in Cosmos DB](https://learn.microsoft.com/azure/cosmos-db/request-units)
