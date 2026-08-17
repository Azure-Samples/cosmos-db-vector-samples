---
name: sample-validate-set
description: Configure or run structural validation for a manifest-defined repository sample set. Use when asked to add a reusable sample-set validator, validate final-table structure and semantic keys, test a validation manifest, or generate timestamped evidence for a configured non-create-index sample set. Do not use for live Azure Cosmos DB create-index validation, exact output comparison, modifying samples, updating references, or arbitrary runners.
---

# Validate a configured sample set

**UTILITY SKILL.** INVOKES: a trusted manifest-defined PowerShell runner and
structural Markdown-table validation.

## USE FOR:

"Validate a configured sample set", "run all manifest-defined samples",
"validate one configured sample", "test a sample validation manifest", or
"generate timestamped sample evidence".

## DO NOT USE FOR:

Changing samples, exact output comparison, updating references, untrusted
runners, or live create-index validation. Use
`sample-validate-nosql-create-index` for live create-index validation.

## Run

From the repository root with PowerShell 7+, review the manifest and runner:

```pwsh
pwsh -NoProfile -File .github\skills\sample-validate-set\scripts\validate-sample-set.ps1 `
  -ManifestPath <path-to-manifest.json> `
  -AllowRunnerExecution
```

For one sample, add:

```pwsh
-Sample <selection>
```

## Examples

- "Validate the sample set in this manifest."
- "Test this validator against saved output."

## Success criteria

- Runner exits `0`; skipped samples fail.
- Each sample creates one new run directory and configured output file.
- Headers and semantic keys match exactly once after alias normalization.
- Timestamped runner and summary logs are preserved.

## Troubleshooting

Inspect the configured summary and runner log. Never print secrets, execute
paths outside the repository, or change references to force a pass.
