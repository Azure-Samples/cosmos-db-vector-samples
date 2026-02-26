# Azure Cosmos DB - Vector Index Algorithms & Query Behavior

This sample demonstrates the differences between vector index algorithms (Flat, QuantizedFlat, DiskANN) and how they affect search accuracy and performance.

## What You'll Learn

- Fundamental differences between ANN algorithms
- Recall vs. latency trade-offs for each algorithm
- When to use each algorithm based on dataset size
- How to benchmark and measure algorithm performance
- Tuning guidance for DiskANN (the recommended algorithm)

## Prerequisites

- Completion of the [Indexing for Embeddings](../cosmos-db-topic2/) tutorial
- Node.js 18.x or later
- Azure subscription
- Azure Cosmos DB account (NoSQL API)
- Azure OpenAI resource with embeddings deployment

## Algorithm Comparison

| Algorithm | Search Type | Recall | Latency | Best For |
|-----------|-------------|--------|---------|----------|
| **Flat** | Exact | 100% | Slow | < 10K vectors (rarely used) |
| **QuantizedFlat** | Approximate | 95-99% | Moderate | Memory-constrained scenarios |
| **DiskANN** | Approximate | 90-99% | Fast | **Recommended for most cases** |

## Setup

1. Install dependencies:
```bash
npm install
```

2. Copy `.env.example` to `.env` and configure:
```bash
cp .env.example .env
```

3. Update your Azure credentials in `.env`

## Run the Benchmark

```bash
npm start
```

## What the Benchmark Does

1. Creates 3 containers with different algorithms (Flat, QuantizedFlat, DiskANN)
2. Inserts identical test datasets into each container
3. Executes the same queries across all algorithms
4. Measures recall, latency, and RU consumption
5. Generates comparison reports and recommendations

## Expected Results

For a dataset of ~15 documents (demonstration size):

### Flat Index (Baseline)
- **Recall**: 100% (exact search)
- **Latency**: Moderate
- **RU/s**: ~15 RU per query
- **Use case**: Rarely recommended; kept for comparison

### QuantizedFlat Index
- **Recall**: 96-98%
- **Latency**: Improved vs. Flat
- **RU/s**: ~10 RU per query
- **Memory**: 60% reduction vs. Flat
- **Use case**: Edge deployments with memory constraints

### DiskANN Index (Recommended)
- **Recall**: 92-95% (default efSearch=40)
- **Latency**: Best performance
- **RU/s**: ~8 RU per query
- **Scalability**: Excellent for large datasets
- **Use case**: **Production deployments with >10K vectors**

## Algorithm Selection Guide

### Decision Tree

```
Start: What's your dataset size?

├─ < 10,000 vectors
│  └─ Use DiskANN (recommended for consistency and future growth)
│
└─ > 10,000 vectors
   └─ Memory constrained?
      ├─ Yes → Use QuantizedFlat (edge scenarios only)
      └─ No  → Use DiskANN ✓ (recommended)
```

### Key Recommendation

**Use DiskANN for most scenarios.** It should be used in almost all cases where you expect more than a few tens of thousands of vectors. DiskANN provides:
- Best performance and scalability
- Tunable accuracy (efSearch parameter)
- Excellent balance of recall and latency

## Tuning DiskANN

DiskANN supports the `efSearch` parameter to control recall/latency trade-offs:

| efSearch | Recall | Latency | Use Case |
|----------|--------|---------|----------|
| 20-30 | ~90-92% | Lowest | Latency-critical applications |
| 40 (default) | ~93-95% | Balanced | Most production workloads |
| 60-80 | ~95-97% | Higher | Accuracy-focused applications |
| 100+ | ~97-99% | Highest | Near-exact search requirements |

### Tuning Process

1. Start with default (efSearch=40)
2. Measure baseline recall and latency
3. If recall too low → increase efSearch
4. If latency too high → decrease efSearch
5. Validate with production-scale data

## Sample Output

```
================================================================================
ALGORITHM COMPARISON SUMMARY
================================================================================

Algorithm           Avg Latency    Avg RU/s       Avg Recall     Memory
--------------------------------------------------------------------------------
flat                245.60ms       14.25          100% (baseline) High
quantizedFlat       132.80ms       10.50          97.20%         Low
diskANN             89.40ms        8.75           94.60%         Moderate
--------------------------------------------------------------------------------

RECOMMENDATIONS:

✓ RECOMMENDED: DiskANN
  • Performance: 89.40ms average latency
  • Accuracy: 94.60% recall (tunable)
  • Cost efficiency: 8.75 RU/s per query
  • Scalability: Excellent for large datasets
```

## Measuring Recall

Recall measures the percentage of true matches found:

```
Recall@k = (Relevant docs in top k) / (Total relevant docs)
```

The benchmark uses Flat index results as ground truth and calculates recall for approximate algorithms.

## Next Steps

- Apply DiskANN to your production data
- Tune efSearch based on your specific SLOs
- Implement [Hybrid Search](../cosmos-db-topic5/) for better coverage
- Add [Semantic Reranking](../cosmos-db-topic6/) for improved precision

## Cleanup

To remove test containers after benchmarking:

```javascript
// Uncomment in index.js cleanup section
await containerFlat.delete();
await containerQuantized.delete();
await containerDiskANN.delete();
```

## Resources

- [DiskANN Research Paper](https://www.microsoft.com/en-us/research/project/project-akupara-approximate-nearest-neighbor-search/)
- [Azure Cosmos DB Vector Search](https://learn.microsoft.com/azure/cosmos-db/vector-search)
- [Performance Tuning Guide](https://learn.microsoft.com/azure/cosmos-db/performance-tips)
