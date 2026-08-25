# Validate repository sample sets

The `sample-validate-set` skill runs a configured group of sample
implementations, captures timestamped evidence, and validates their final
Markdown tables by semantic content instead of byte-for-byte output.

> [!IMPORTANT]
> Live Azure Cosmos DB create-index validation remains governed by
> `sample-validate-nosql-create-index` and
> `.github/docs/CREATE-INDEX-CONSTITUTION.md`. The generic skill includes a
> create-index manifest as a schema and file-validation example, not as a
> replacement lifecycle command.

## Meet the prerequisites

Install or configure:

- PowerShell 7 or later (`pwsh`)
- Git
- The toolchains and services required by the configured runner
- Any authentication and deployment prerequisites required by the sample set

Run commands from the repository root. All manifests, runners, output,
reference files, and evidence paths must remain inside the Git repository and
must not traverse symbolic links or junctions.

## Use file-only validation in this repository

The included create-index manifest can validate saved or fixture output
without running Azure samples:

```powershell
pwsh -NoProfile -File .github\skills\sample-validate-set\scripts\validate-sample-set.ps1 `
  -ManifestPath .github\skills\sample-validate-set\manifests\nosql-create-index.json `
  -ActualPath path\to\generated-output.txt `
  -ReferencePath path\to\sample-output.txt
```

Both files must already exist inside the repository. File-only mode does not
execute the configured runner.

Run the included offline suite:

```powershell
pwsh -NoProfile -File .github\skills\sample-validate-set\tests\test-validator.ps1
```

The suite covers valid output, aliases, escaped pipes, fenced tables, missing,
duplicate and unexpected keys, malformed tables, invalid references, path
escapes, schema failures, runner failures, and sample-selection errors.

## Create a sample-set manifest

The manifest has four main sections:

| Section | Purpose |
|---|---|
| `runner` | Repository PowerShell runner and arguments |
| `evidence` | Timestamped evidence directory and filenames |
| `samples` | Selection name, sample directory, run-output discovery, and reference output |
| `validation.table` | Header aliases, semantic key columns, value aliases, expected keys, and row count |

Start with
`.github/skills/sample-validate-set/manifests/nosql-create-index.json` and
validate the result against
`.github/skills/sample-validate-set/schema/sample-set-manifest.schema.json`.

Header and value aliases allow implementations to use equivalent labels. For
example, the create-index manifest treats `Container` and `Index Type` as the
same semantic column, and maps `hotels_diskann` to `DiskANN`.

The reference table and generated table must each contain every expected
semantic key exactly once. Non-key fields can differ, which allows scores,
timings, request charges, paths, and result text to vary.

## Run a configured sample set

Run mode executes the PowerShell runner declared by the manifest. Inspect the
runner before using the required trust switch:

```powershell
pwsh -NoProfile -File .github\skills\sample-validate-set\scripts\validate-sample-set.ps1 `
  -ManifestPath path\to\sample-set.json `
  -AllowRunnerExecution
```

Run one configured selection:

```powershell
pwsh -NoProfile -File .github\skills\sample-validate-set\scripts\validate-sample-set.ps1 `
  -ManifestPath path\to\sample-set.json `
  -Sample <selection> `
  -AllowRunnerExecution
```

The runner contract is:

1. Accept the arguments declared in `runner.arguments`.
2. Replace `{selection}` with `runner.allSelection` or the selected sample's
   `selection` value.
3. Run from the repository root.
4. Exit nonzero for a build failure, runtime failure, or skipped sample.
5. Create exactly one new matching run directory for each selected sample.
6. Write the configured output filename into that directory.
7. Avoid printing secrets or complete environment-variable values.

Evidence is written to the manifest's `evidence.root` under a unique directory
containing milliseconds and a random suffix. Do not run the same underlying
sample runner concurrently outside this validator because output discovery is
based on newly created directories.

## Troubleshoot validation

| Failure | Check |
|---|---|
| Manifest schema error | Validate required fields, types, unique selections, key tuple length, and exact row count |
| Runner trust error | Review the repository runner and add `-AllowRunnerExecution` |
| Unknown sample | Use `All`, a configured `name`, or a configured `selection` |
| No new run directory | Confirm the runner created the configured directory pattern |
| More than one new directory | Ensure one runner invocation creates one directory per selected sample |
| Missing output file | Check `samples[].runFile` and runner behavior |
| Header mismatch | Update only legitimate `headerAliases`; don't hide unrelated columns |
| Missing or duplicate semantic key | Compare the final table with `expectedKeys` |
| Runner exit failure | Inspect the runner log before the validation summary |

## Use the skill in another repository

Copy this directory into the target repository:

```text
.github/skills/sample-validate-set/
```

Then create a manifest for the target sample set:

1. Keep the skill under `.github/skills/sample-validate-set`, or pass
   `-RepoRoot` if repository discovery isn't available.
2. Provide a trusted repository-local PowerShell runner that exits nonzero for every
   build failure, runtime failure, or skipped selected sample.
3. Add one `samples` entry for each selectable implementation.
4. Configure how the validator finds the new timestamped run directory and
   output file.
5. Commit a representative reference-output file for each sample.
6. Define normalized header aliases and the columns that uniquely identify
   required semantic rows.
7. Define every expected key exactly once and set `exactRowCount` to the same
   number.
8. Replace repository-specific examples in `SKILL.md`.
9. Run the offline suite before live validation.

The target repository can replace the included create-index manifest and
fixtures or keep them as an example. Update the skill description and examples
if the copied skill should trigger only for the target repository's sample
set.

The generic validator currently expects:

- a PowerShell runner;
- a final non-fenced Markdown table;
- one new timestamped run directory per selected sample;
- committed reference output stored inside the repository.

Extend the manifest schema and validator together if another repository needs
JSON output, multiple result files per sample, or a non-PowerShell runner.
