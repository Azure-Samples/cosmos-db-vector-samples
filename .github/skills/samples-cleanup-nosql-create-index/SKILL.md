---
name: samples-cleanup-nosql-create-index
description: Clean generated files from the Azure Cosmos DB NoSQL create-index samples. Use for requests to clean create-index samples, remove create-index build artifacts, delete generated create-index output, or reset create-index sample dependencies.
---

# Clean create-index samples

**UTILITY SKILL.** INVOKES:
`.github\scripts\clean-all-create-index.ps1`.

## USE FOR:

"Clean the create-index samples", "remove create-index output", "reset all
create-index samples", or "clean the Python create-index sample".

## DO NOT USE FOR:

Deleting Azure resources, removing committed source or reference
`sample-output.txt` files, or cleaning vector-search samples.

## Run

Work from the repository root. First ask the user: **Are you completely done
testing the create-index samples?**

- If **no**, preserve the data copied by `azd up` and run cleanup without
	`-RemoveCopiedData`.
- If **yes**, confirm that deleting the copied data is intended, then use
	`-RemoveCopiedData` in both cleanup commands.

The default cleanup preserves the region-based JSON files copied by the `azd`
`postprovision` hook. Only remove those files after testing is complete.

Preview the targeted cleanup:

```pwsh
pwsh -NoProfile -File .github\scripts\clean-all-create-index.ps1 -Language All -WhatIf
```

Review the preview, then run the same command without `-WhatIf`:

```pwsh
pwsh -NoProfile -File .github\scripts\clean-all-create-index.ps1 -Language All
```

For confirmed post-testing cleanup, use:

```pwsh
pwsh -NoProfile -File .github\scripts\clean-all-create-index.ps1 -Language All -RemoveCopiedData -WhatIf
pwsh -NoProfile -File .github\scripts\clean-all-create-index.ps1 -Language All -RemoveCopiedData
```

When the request names one language, replace `All` with `Python`,
`TypeScript`, `DotNet`, `Go`, or `Java` in both commands.

The cleanup removes generated dependencies, builds, runtime configuration,
executables, timestamped run logs, and validation reports. It removes copied
data only with `-RemoveCopiedData`. It preserves committed source, manifests,
templates, documentation, and each sample's `output\sample-output.txt`.

When copied data is removed, the script deletes the two region-based JSON files
only from the selected language sample directories. It never invokes the global
`predown` hook, so unrelated samples aren't cleaned. To restore copied data,
run `azd provision`; the `postprovision` hook repopulates the create-index
sample data directories.

Treat the operation as successful only when the script exits with code `0` and
prints `Cleanup complete.` If it fails, report the missing sample or path from
the script output; do not delete additional paths manually.
