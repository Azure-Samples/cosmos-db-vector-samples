---
name: sample-provision-nosql-create-index
description: Provision Azure resources for the Azure Cosmos DB NoSQL create-index samples by authenticating with azd, selecting an Azure subscription, and running azd up. Use when the user asks to provision, deploy, initialize, or restore create-index sample resources.
---

# Provision NoSQL create-index samples

**UTILITY SKILL.** INVOKES: `azd auth login`, `azd env`, and `azd up`.

## USE FOR:

"Provision the create-index samples", "deploy create-index resources", "run azd up for create-index", "restore create-index sample data", or "initialize the create-index environment".

## DO NOT USE FOR:

Running the samples, validating sample output, deleting Azure resources, or cleaning generated files.

## Run

Work from the repository root. Before running any provisioning command, ask the user to authenticate with Azure Developer CLI and confirm the target subscription:

> Run `azd auth login` in your terminal, then tell me which Azure subscription should receive these resources. Do not provide credentials or tokens in chat.

After the user confirms authentication and the subscription, select or create the active `azd` environment with the intended subscription and location. For a new environment:

```pwsh
azd env new <environment-name> --subscription <subscription-id> --location <azure-region>
```

For an existing environment, verify its configured subscription:

```pwsh
azd env get-values
```

If the active environment is not configured for the intended subscription, update it before continuing:

```pwsh
azd env set AZURE_SUBSCRIPTION_ID <subscription-id>
```

Set the canonical create-index database setting before provisioning:

```pwsh
azd env set AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME HotelsCreateIndex
azd env get-value AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME
```

Do not continue unless `azd env get-value` returns `HotelsCreateIndex` for the
active environment.

Provision the infrastructure and run the repository postprovision hook:

```pwsh
azd up
```

`azd up` provisions the resources defined by this repository and runs the `postprovision` hook from `azure.yaml`. The hook restores the region-based JSON files into the five `nosql-create-index-*` sample data directories.

## Success criteria

Treat the operation as successful only when:

- `azd auth login` completed successfully for the user's intended tenant.
- The active `azd` environment targets the intended subscription and region.
- `AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME` is set to `HotelsCreateIndex` in
  the active `azd` environment before `azd up`.
- `azd up` exits with code `0`.
- The postprovision hook completes successfully.
- The copied files `HotelsData_toCosmosDB_byRegion.json` and `HotelsData_toCosmosDB_Vector_byRegion.json` exist under each create-index sample's `data` directory.

If provisioning fails, report the failing command and its error. Do not retry against a different subscription or modify Azure resources manually without user confirmation.
