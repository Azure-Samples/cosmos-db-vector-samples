# Live integration tests

These tests are live integration tests. They use real Azure resources and call the actual Azure Cosmos DB, ARM, and Azure OpenAI code paths in this sample.

## Prerequisites

- Create the required Azure resources with `scripts/create-resources.sh`
- Do **not** use `azd up` for this sample; setup is driven by the bash script
- Make sure a valid `.env` file exists before running the tests

## Run the tests

```bash
npm test
```

The test suite creates a unique Cosmos DB container for each run and deletes that test container during cleanup.
