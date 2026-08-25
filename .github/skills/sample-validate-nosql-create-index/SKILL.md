---
name: sample-validate-nosql-create-index
description: Run and validate all five Azure Cosmos DB create-index samples after deployment. Triggers include "validate create-index samples", "run all create-index languages", "check create-index output", and "verify the final tables". Compares generated output with sample-output.txt.
---

# Validate create-index samples

**UTILITY SKILL.** INVOKES: the repository runner and structural validator.

## USE FOR:

"Validate create-index samples", "run all create-index languages", "check
create-index output", "verify final tables", or "validate the Go sample".

## DO NOT USE FOR:

Changing sample code, updating reference output, or cleaning generated files.

## Run

From the repository root, confirm `azd up`, `az login`, and `azd auth login`
are current. Never print secrets from `.azure`; the runner calls
`azd env get-values`.

```pwsh
pwsh -NoProfile -File .github\skills\sample-validate-nosql-create-index\scripts\validate-create-index-samples.ps1
```

For one language:

```pwsh
pwsh -NoProfile -File .github\skills\sample-validate-nosql-create-index\scripts\validate-create-index-samples.ps1 -Language Go
```

Supported values are `All`, `Python`, `TypeScript`, `DotNet`, `Go`, and `Java`.
Allow several minutes. Reports go to
`.github\scripts\output\validation-<timestamp>\`; sample logs go to each
sample's `output\create-index-run-<timestamp>\`.

## Success criteria

Require runner exit code `0` and `PASS` for every selected language. `All` must
end with `All five create-index samples passed`.

Validation is structural, not byte-for-byte. It normalizes the known
`Index Type`/`Distance Function` and `Container`/`Metric` header variants,
ignores volatile result names and scores, and requires exactly one row for each
DiskANN/QuantizedFlat × Cosine/DotProduct/Euclidean combination. On failure,
report the language, log path, and detail. Never replace committed
`sample-output.txt` merely to force a pass.
