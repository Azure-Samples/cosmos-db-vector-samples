# Vector Search Validation Report

## Infra Configuration Review
- Vector path: `/DescriptionVector` is consistent across indexing and embedding policy.
- Embedding policy:
  - `dataType: float32`
  - `dimensions: 1536`
  - `distanceFunction: cosine`
- Indexing policy:
  - `includedPaths: /*`
  - `excludedPaths: /DescriptionVector/*` and `/_etag/?`
  - `vectorIndexes` uses `diskANN` and `quantizedFlat` per container.
- Partition key paths: `/HotelId`

Result: Infra configuration matches the README/quickstart guidance for diskANN and quantizedFlat.

## Live Container Policies (Azure)
### hotels_diskann
- Vector embedding policy
  - path: `/DescriptionVector`
  - dataType: `float32`, dimensions: `1536`, distanceFunction: `cosine`
- Indexing policy
  - includedPaths: `/*`
  - excludedPaths: `/_etag/?`, `/DescriptionVector/*`
  - vectorIndexes: `diskANN` on `/DescriptionVector`
- Partition key
  - kind: `MultiHash`, paths: `/HotelId`, version: `2`

### hotels_quantizedflat
- Vector embedding policy
  - path: `/DescriptionVector`
  - dataType: `float32`, dimensions: `1536`, distanceFunction: `cosine`
- Indexing policy
  - includedPaths: `/*`
  - excludedPaths: `/_etag/?`, `/DescriptionVector/*`
  - vectorIndexes: `quantizedFlat` on `/DescriptionVector`
- Partition key
  - kind: `MultiHash`, paths: `/HotelId`, version: `2`

Result: Live policies match infra configuration. The partition key reports `MultiHash` with a single path, which is acceptable and does not block vector search.

## SDK Query Validation
- Query uses `VectorDistance(c.${embeddedField}, @embedding)` with field name validated by `validateFieldName()`.
- `embeddedField` comes from env `EMBEDDED_FIELD=DescriptionVector`, matching container policy.
- Query parameters include a 1536-dimension embedding vector.

Result: Query composition and field name validation align with Cosmos DB SQL constraints and sample guidance.

## End-to-End Runs
### diskANN
- Connected to database: `Hotels`
- Container: `hotels_diskann`
- Insert: skipped (already had 50 documents)
- Query results: 5 rows returned
- RU charge: `5.32`

### quantizedFlat
- Connected to database: `Hotels`
- Container: `hotels_quantizedflat`
- Insert: 50 items inserted (bulk)
- Query results: 5 rows returned
- RU charge: `5.32`

