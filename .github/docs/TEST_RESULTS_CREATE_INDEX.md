# Historical create-index parameterization test results

> [!IMPORTANT]
> These results are a historical snapshot from August 13, 2026. They are stale
> and must not be interpreted as the current validation status. Run the shared
> create-index validator for current results:
>
> `pwsh -NoProfile -File .github\skills\sample-validate-nosql-create-index\scripts\validate-create-index-samples.ps1`

**Test date:** August 13, 2026

**Original objective:** Validate container-name parameterization across all five
create-index language samples.

## Historical summary

At the time of this run, three samples completed and two had known failures.
Subsequent implementation and governance changes may have invalidated every
result in this table.

| Language | Historical status | Container names | Data insertion | Queries | Cleanup | Exit code |
|---|---|---|---|---|---|---|
| TypeScript | Pass | Standard names | 50 documents | All three distance functions | Complete | 0 |
| Python | Pass | Standard names | 50 documents per container | All three distance functions | Complete | 0 |
| Java | Pass | Standard names | 50 documents per container | All three distance functions | Complete | 0 |
| Go | Partial | Standard names | DiskANN only | QuantizedFlat access failure | Incomplete | 1 |
| .NET | Partial | Language-suffixed names | Parameterization mismatch | Configuration mismatch | Incomplete | 1 |

## Historical details

### TypeScript

- Created `hotels_diskann` and `hotels_quantizedflat`.
- Inserted 50 documents into both containers.
- Ran Cosine, DotProduct, and Euclidean queries.
- Deleted both containers.
- Historical log path: `nosql-create-index-typescript/output2/typescript-run.log`.

### Python

- Fixed a runtime import issue in `control_plane.py` during the historical run.
- Created `hotels_diskann` and `hotels_quantizedflat`.
- Inserted 50 documents into both containers.
- Ran Cosine, DotProduct, and Euclidean queries.
- Deleted both containers.
- Historical log path: `nosql-create-index-python/output2/python-run.log`.

### Java

- Created `hotels_diskann` and `hotels_quantizedflat`.
- Inserted 50 documents into both containers.
- Ran Cosine, DotProduct, and Euclidean queries.
- Deleted both containers.
- Historical log path: `nosql-create-index-java/output2/java-run.log`.

### Go

- Created both standard containers.
- Inserted 50 documents into `hotels_diskann`.
- Failed while inserting into `hotels_quantizedflat`.
- Historical log path: `nosql-create-index-go/output2/go-run.log`.

### .NET

- Created language-suffixed container names instead of the configured standard
  names.
- Failed when data-plane access used names that differed from the
  control-plane names.
- Historical log path: `nosql-create-index-dotnet/output2/dotnet-run.log`.

## Configuration evaluated in the historical run

The run evaluated these standard names:

```text
AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME=HotelsCreateIndex
AZURE_COSMOSDB_CREATE_INDEX_DISKANN_CONTAINER_NAME=hotels_diskann
AZURE_COSMOSDB_CREATE_INDEX_QUANTIZEDFLAT_CONTAINER_NAME=hotels_quantizedflat
```

The current architecture provisions the configured create-index database
through Bicep. Each language sample creates and deletes only the two configured
containers. Custom container names require the language sample's documented deletion opt-in.

## Get current results

Run the shared validator instead of relying on this historical snapshot:

```powershell
pwsh -NoProfile -File .github\skills\sample-validate-nosql-create-index\scripts\validate-create-index-samples.ps1
```

The validator writes timestamped logs and a validation summary under
`.github/scripts/output/validation-<yyyyMMdd-HHmmss>/`.
