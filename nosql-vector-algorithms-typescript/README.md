# Vector Algorithm Comparison — Azure Cosmos DB NoSQL

Compares **QuantizedFlat** and **DiskANN** vector index algorithms across **cosine**, **dotproduct**, and **euclidean** distance functions using Azure Cosmos DB for NoSQL.

Creates 6 containers (2 algorithms × 3 distance functions) and runs identical vector searches against each to compare results, RU cost, and latency.

## Prerequisites

- [Node.js LTS](https://nodejs.org/) (v20+)
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli)
- Azure subscription with access to Azure Cosmos DB and Azure OpenAI

## Quick Start

### 1. Create Azure resources

```bash
az login
bash scripts/create-resources.sh
```

### 2. Configure environment

```bash
cp sample.env .env
# Edit .env with values from create-resources.sh output
```

### 3. Install dependencies and run

```bash
npm install
npm start
```

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm start` | Compare both algorithms with cosine distance |
| `npm run start:quantizedflat` | Run QuantizedFlat with cosine |
| `npm run start:diskann` | Run DiskANN with cosine |
| `npm run start:dotproduct` | Compare both algorithms with dotproduct |
| `npm run start:euclidean` | Compare both algorithms with euclidean |
| `npm run metrics` | Multi-iteration benchmark across all containers |
| `npm run verify` | Validate container setup and vector configuration |
| `npm run delete-data` | Delete all documents from containers |
| `npm run build` | Compile TypeScript |

## Container Matrix

| Algorithm | Distance | Container Name |
|-----------|----------|----------------|
| QuantizedFlat | cosine | `hotels_quantizedflat_cosine` |
| QuantizedFlat | dotproduct | `hotels_quantizedflat_dotproduct` |
| QuantizedFlat | euclidean | `hotels_quantizedflat_euclidean` |
| DiskANN | cosine | `hotels_diskann_cosine` |
| DiskANN | dotproduct | `hotels_diskann_dotproduct` |
| DiskANN | euclidean | `hotels_diskann_euclidean` |

## Environment Variables

Set `VECTOR_ALGORITHM` and `VECTOR_DISTANCE_FUNCTION` to control which containers are queried:

- `VECTOR_ALGORITHM`: `all` | `quantizedflat` | `diskann`
- `VECTOR_DISTANCE_FUNCTION`: `all` | `cosine` | `dotproduct` | `euclidean`

## Clean Up

```bash
bash scripts/delete-resources.sh
```
