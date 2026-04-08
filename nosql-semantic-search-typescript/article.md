# Vector Store Semantic Search in Azure Cosmos DB

**Purpose:** Learn how to perform semantic similarity searches using vector embeddings in Azure Cosmos DB. This article focuses on pure vector-based retrieval using the VectorDistance() function, understanding distance metrics, optimizing top-k queries, and interpreting similarity scores.

## Prerequisites
- Completion of Topic 2 and Topic 3
- Azure Cosmos DB account with NoSQL API
- Container with vector index configured
- Node.js 18.x or later
- Azure OpenAI resource

## What You'll Learn
- How does semantic similarity work?
- How many results should I retrieve (top-k)?
- How do I interpret distance scores?
- What distance metrics should I use?

## Understanding Semantic Search
Semantic search finds documents based on meaning rather than exact keywords.

## Distance Metrics in Cosmos DB

| Metric | Formula | Range | Best For | Interpretation |
|--------|---------|-------|----------|----------------|
| cosine | 1 - cos(θ) | 0 to 2 | General embeddings | 0 = identical, 2 = opposite |
| euclidean | ‖a - b‖ | 0 to ∞ | Geometric distance | 0 = identical, larger = different |
| dotproduct | -(a · b) | -∞ to ∞ | Normalized vectors | More negative = more similar |

**Default recommendation: cosine distance**

## Basic Semantic Search Query
```javascript
const querySpec = {
  query: \`SELECT TOP @topK c.id, c.title,
          VectorDistance(c.embedding, @embedding) AS similarity
          FROM c ORDER BY VectorDistance(c.embedding, @embedding)\`,
  parameters: [
    { name: "@topK", value: 10 },
    { name: "@embedding", value: queryEmbedding }
  ]
};
```

## Interpreting Similarity Scores
Cosine distance ranges (lower = better):
- 0.0000-0.1000: Highly similar ⭐⭐⭐
- 0.1000-0.3000: Similar ⭐⭐
- 0.3000-0.5000: Moderately similar ⭐
- 0.5000+: Dissimilar

## Choosing Top-K
| Use Case | Recommended K |
|----------|--------------|
| Direct user search | 5-10 |
| RAG context | 3-5 |
| Recommendations | 10-20 |

## Advanced Patterns
- Semantic search with filters
- Score thresholds
- Multi-field projection

## Best Practices
✅ Use appropriate top-K
✅ Add filters to reduce search space
✅ Project only needed fields
✅ Monitor RU consumption

## Key Takeaways
- Lower distance = better match (cosine)
- Top-K typically 5-10 for user search
- Combine with filters for targeted search
