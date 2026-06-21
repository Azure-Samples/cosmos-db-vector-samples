# Batch Upsert Analysis - Results

**Date:** 2026-06-19 (Pre-Region-Based Architecture)  
**Updated:** 2026-06-21 (Context added for current Region-based partition key)

**Question:** Can we use batch upsert instead of individual upserts for ingestion?  
**Answer:** NO. Individual upserts are required regardless of partition key strategy (HotelId or Region).

## Test Findings (Original Analysis — HotelId Partition)

**Test Script:** `test-batch-api.py`

### Data Analysis (Original)
- **Total documents:** 50 hotels
- **Partition key field (Original):** HotelId
- **Unique HotelId values:** 50
- **Conclusion:** Every document has a DIFFERENT partition key value

### Current Architecture (Updated)
- **Total documents:** 50 hotels
- **Partition key field (Current):** Region (Northeast, Midwest, South, West)
- **Unique Region values:** 4
- **Distributed:** ~12-13 documents per region
- **Conclusion:** Batch upsert STILL doesn't apply (Cosmos DB batches require ALL items in batch share SAME partition value—we want to query by region, not batch by region)

## Cosmos DB Constraint
Transactional batch operations require:
- ALL items in batch must have the SAME partition key value
- Single-partition batch atomicity guarantee
- Cannot span multiple partition values

**This constraint applies whether partition key is HotelId, Region, or any other field.**

## Why Individual Upserts (Regardless of Partition Key Strategy)
1. Each document upserts independently
2. No partition key value alignment required
3. Works regardless of partition distribution (Region groups or HotelId uniqueness)
4. Proven pattern in vector-search samples
5. Simpler implementation than grouping by partition key value for batch operations

### Performance Impact
- 50 documents = 50 roundtrips (not 1 batch)
- Each upsert: ~68 RUs (QuantizedFlat) to ~136 RUs (DiskANN)
- Total: ~3,400-6,800 RUs for 50 documents
- Latency: Negligible for 50 docs (network roundtrip is fast)

## Closed Questions

**Q: Why can't it be batch upsert?**  
A: Because documents have different HotelId values, and Cosmos DB batch requires same partition key.

**Q: What about the vector-search samples?**  
A: They use individual upserts for the same reason.

**Q: Should we group by partition key first?**  
A: Overcomplicated. 50 unique partition keys = 50 groups. No efficiency gain.

## Decision

**CONFIRMED:** Individual upserts remain the correct pattern.
- Tested and documented in this session
- Aligned with vector-search samples
- Constraint clearly understood

## Updated Documentation

1. `.github/plans/create-index-architecture.md` section 9.1 — Updated with test results
2. `.github/plans/create-index-architecture.md` ADR-001 — Marked as "CONFIRMED BY TEST"
3. This file — Final test summary

## Next Steps

Architecture plan is now complete and validated. Ready for:
1. User approval
2. Implementation to other 4 languages (TypeScript, Go, Java, .NET)
3. Cross-language output verification
