---
name: sample-deprovision-nosql-create-index
description: Deprovision Azure resources for the Azure Cosmos DB NoSQL create-index samples by authenticating with azd, confirming the target subscription, and running azd down. Use when the user asks to tear down, deprovision, or remove create-index sample resources.
---

# Deprovision NoSQL create-index samples

**UTILITY SKILL.** INVOKES: `azd auth login`, `azd env`, and `azd down`.

## USE FOR:

"Deprovision the create-index samples", "tear down create-index resources",
"run azd down for create-index", "remove the create-index environment", or
"delete create-index Azure resources".

## DO NOT USE FOR:

Running the samples, validating sample output, provisioning resources, or
cleaning only local generated files. Use
`sample-validate-nosql-create-index` for validation and
`samples-cleanup-nosql-create-index` for local cleanup.

## Run

Work from the repository root. Before running any teardown command, ask the
user:

> Are you completely done testing the create-index samples, and do you confirm
> that the Azure resources and copied sample data for the selected subscription
> should be removed?

Do not continue until the user explicitly confirms both points. Also ask the
user to authenticate with Azure Developer CLI and confirm the target
subscription:

> Run `azd auth login` in your terminal, then tell me which Azure subscription
> contains the create-index environment. Do not provide credentials or tokens
> in chat.

After authentication and confirmation, verify the active environment:

```pwsh
azd env get-values
```

Confirm that the environment targets the intended subscription before
continuing. Summarize the selected environment and subscription, then obtain a
final explicit confirmation:

> Confirm that I should permanently start teardown of the active azd
> environment and its Azure resources.

After that confirmation, use the supported non-interactive confirmation flag:

```pwsh
azd down --force
```

The repository `predown` hook runs before infrastructure teardown. In the
CREATE-INDEX scenario it removes the copied
`HotelsData_toCosmosDB_byRegion.json` and
`HotelsData_toCosmosDB_Vector_byRegion.json` files from the five create-index
sample directories. It preserves the committed source data under `data/` and
the committed `output/sample-output.txt` reference files.

## Success criteria

Treat the operation as successful only when:

- `azd auth login` completed successfully for the intended tenant.
- The active `azd` environment targets the confirmed subscription.
- The user explicitly confirmed teardown.
- `azd down --force` exits with code `0`.
- The `predown` hook completes successfully.
- The deployed create-index resources are removed.
- The copied region JSON files are absent from the sample `data` directories.

If deprovisioning fails, report the failing command and its error. Do not retry
against a different subscription or delete resources manually without new user
confirmation.