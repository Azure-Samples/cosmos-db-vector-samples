# Hybrid Search in Azure Cosmos DB

**Purpose:** Combine vector semantic search with full-text keyword search using RRF.

## What You'll Learn
- When to use hybrid vs pure vector
- How to combine vector and keyword results
- What is Reciprocal Rank Fusion (RRF)
- How to weight semantic vs keyword results

## Understanding Hybrid Search
Hybrid = Vector (meaning) + Keyword (exact terms) + RRF (fusion)

## Reciprocal Rank Fusion (RRF)
**Formula:** RRF_score = Σ (weight / (rank + k))

Example: Document at position 2 in vector, position 5 in keyword:
- Vector: 1/(2+60) = 0.0161
- Keyword: 1/(5+60) = 0.0154
- Combined: 0.0315

## Implementation
```javascript
async function hybridSearch(container, queryText, weights = { vector: 1.0, keyword: 1.0 }) {
  const vectorResults = await vectorSearch(container, queryText, 20);
  const keywordResults = await keywordSearch(container, queryText, 20);
  return applyRRF(vectorResults, keywordResults, weights).slice(0, 10);
}
```

## Tuning Weights
| Scenario | Weights | Rationale |
|----------|---------|-----------|
| Conceptual queries | vector: 1.5, keyword: 0.5 | Emphasize meaning |
| Technical IDs | vector: 0.5, keyword: 1.5 | Exact terms matter |
| Balanced | vector: 1.0, keyword: 1.0 | Default |

## When to Use Hybrid vs Pure Vector
Use hybrid when:
- ✅ Users search with exact codes/IDs
- ✅ Mix of conceptual and exact-match queries
- ✅ Enterprise search scenarios

Use pure vector when:
- ✅ Purely conceptual queries
- ✅ Cross-language search
- ✅ Paraphrase matching

## Key Takeaways
- Hybrid provides better coverage
- RRF is industry standard
- Tune weights for your use case
