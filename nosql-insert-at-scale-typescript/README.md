# 🏨 Azure Cosmos DB Insert at Scale Operations

Enterprise-grade resilient bulk insertion for Azure Cosmos DB NoSQL API.

## 🎯 Overview

This application demonstrates high-performance bulk insertion of documents into Azure Cosmos DB, featuring:

- **🔄 Resilient Operations**: Automatic retry logic with exponential backoff for rate limiting (429 errors)
- **📊 Performance Monitoring**: Real-time RU consumption and latency tracking  
- ** Cost Estimation**: Built-in serverless cost calculations
- **🛡️ Enterprise Patterns**: Circuit breaker, idempotency, and comprehensive error handling

> **Note**: For vector index management during bulk operations, use the external scripts in `./scripts/` directory.

## 📋 Prerequisites

- **Node.js** (v18+ with ES modules support)
- **Azure CLI** installed and authenticated
- **Azure Cosmos DB NoSQL account** (existing database and container)
- **TypeScript** knowledge recommended

## 🚀 Quick Start

### 1. Clone and Install

```bash
git clone <repository-url>
cd nosql-insert-at-scale-typescript
npm install
```

### 2. Configure Environment

Copy the example environment file and configure your settings:

```bash
cp .env.example .env
```

Edit `.env` with your Cosmos DB details:

```bash
# ========================================
# Cosmos DB Connection Settings (Required)
# ========================================
COSMOS_ENDPOINT=https://your-cosmos-account.documents.azure.com:443/
COSMOS_DB_NAME=Hotels
COSMOS_CONTAINER_NAME=hotels-insert-scale
COSMOS_RESOURCE_GROUP=your-resource-group-name

# ========================================
# Cosmos DB Partition Configuration
# ========================================
PARTITION_KEY_PATH=/HotelId

# ========================================
# Data File Paths and Vector Configuration
# ========================================
DATA_FILE_WITH_VECTORS=../../data/HotelsData_toCosmosDB_Vector.json
EMBEDDED_FIELD=text_embedding_ada_002
EMBEDDING_DIMENSIONS=1536

# ========================================
# Optional Performance Tuning
# ========================================
BATCH_SIZE=50
MAX_CONCURRENCY=-1
DEBUG=true
```

### 3. Set Up Azure Permissions

The application uses **passwordless authentication** with Azure Identity. Set up the required permissions:

```bash
# Make the script executable (Linux/macOS/Git Bash)
chmod +x scripts/setup-cosmos-nosql-dataplane-permissions.sh

# Run the permission setup script
./scripts/setup-cosmos-nosql-dataplane-permissions.sh
```

### 4. Build and Run

```bash
# Build the TypeScript project
npm run build

# Run the insert-at-scale operation
npm run start:insert-at-scale
```

## 📊 Expected Output

When running successfully, you'll see:

```
🏨 Azure Cosmos DB Insert at Scale Operations
==============================================
Environment: development
Timestamp: 2025-10-02T19:52:04.504Z
✅ Cosmos DB client initialized successfully

📊 Step 1: Loading Data
=======================
Reading JSON file from C:\Users\...\HotelsData_toCosmosDB_Vector.json
✅ Loaded 50 documents from ../../data/HotelsData_toCosmosDB_Vector.json
🔍 Validating that documents contain embedding field 'text_embedding_ada_002'...
✅ All documents contain valid embedding field 'text_embedding_ada_002' with 1536 dimensions

🚀 Step 2: Enterprise-Grade Bulk Insert
======================================
Configuration:
  - Database: Hotels_2
  - Container: Insert-at-scale-1
  - Batch size: 50
  - Concurrency: SDK Optimized
  - Documents to insert: 50

Getting database Hotels_2...
Getting container Insert-at-scale-1...
✅ Database: Hotels_2
✅ Container: Insert-at-scale-1
✅ Partition key: /HotelId

Starting resilient insert...
ℹ️  Starting resilient insert operation
🚀 Starting batch processing of 50 documents...
ℹ️  Removing indexes before bulk insert operation
ℹ️  Captured existing index definition before insert
⚠️  Note: Automatic index removal requires CosmosClient access. Consider manually removing indexes for better insert performance.
ℹ️  Processing batch 1/1

⏳ Rate limiting detected for document 28 - retrying in 1s (attempt 2/4)
⏳ Rate limiting detected for document 26 - retrying in 1s (attempt 2/4)
[... retry messages for rate-limited operations ...]

✅ Document 24 successfully inserted after 1 retry
✅ Document 41 successfully inserted after 1 retry
[... success messages ...]

ℹ️  Index restoration after insert would occur here
ℹ️  Note: Automatic index restoration requires CosmosClient access for container recreation
ℹ️  Index definition available for manual restoration
ℹ️  Resilient insert operation completed
🎯 Batch processing completed: 50 inserted, 0 failed, 37 retries

✅ Insert Operation Complete:
   Inserted: 50/50 documents
   Failed: 0, Retries: 37
   Total time: 13.7s
   RU consumed: 16,010.16
   Avg RU/doc: 320.20
   Avg latency: 2281ms/doc

💰 Cost Estimation:
   Serverless cost: $0.000128
   Serverless: 16,010.16 RUs = 0.016010 million RUs * $0.008/million = $0.000128

⚠️  Errors encountered:
   429: 37 occurrences
   💡 Tip: Consider increasing RU/s or enabling autoscale for high throughput

📈 Step 3: Performance Analysis
==============================
RU Consumption Analysis:
  - Total RUs: 16,010.16
  - Average RU/document: 320.20
  - Peak RU/operation: 344.95

Performance Metrics:
  - Total duration: 13.7s
  - Average latency: 2281ms/document
  - Peak latency: 5321ms
  - Throughput: 3.7 docs/second

Optimization Recommendations:
  ⚠️  High RU consumption per document (320.20 RU/doc)
     - Consider document size optimization
     - Review indexing policies
  ⚠️  High average latency (2281ms)
     - Consider increasing provisioned RU/s
     - Check regional proximity
  💡 For detailed optimization guidance, see INSERT_AT_SCALE_GUIDE.md

🎉 All Operations Completed Successfully!
========================================
✅ 50 documents inserted with resilience
✅ Performance metrics captured

📚 Next Steps:
  - Review the performance metrics above
  - Adjust batch sizes and concurrency based on your RU provisioning
  - Implement the patterns in your production workloads
  - Monitor RU consumption and optimize accordingly

📖 For detailed documentation, see INSERT_AT_SCALE_GUIDE.md
✅ Cosmos DB client disposed successfully
```

## 🔧 Configuration Options

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `COSMOS_ENDPOINT` | ✅ | - | Your Cosmos DB account endpoint |
| `COSMOS_DB_NAME` | ✅ | `Hotels` | Database name |
| `COSMOS_CONTAINER_NAME` | ✅ | `hotels-insert-scale` | Container name |
| `COSMOS_RESOURCE_GROUP` | ✅ | - | Azure resource group (for RBAC setup) |
| `PARTITION_KEY_PATH` | ✅ | `/HotelId` | Partition key path |
| `DATA_FILE_WITH_VECTORS` | ✅ | `../../data/HotelsData_toCosmosDB_Vector.json` | Path to data file |
| `EMBEDDED_FIELD` | ❌ | `text_embedding_ada_002` | Embedding field name |
| `EMBEDDING_DIMENSIONS` | ❌ | `1536` | Vector dimensions |
| `BATCH_SIZE` | ❌ | `50` | Documents per batch |
| `MAX_CONCURRENCY` | ❌ | `-1` | Max concurrent operations |
| `COSMOS_KEY` | ❌ | - | Primary key (if not using passwordless) |

### Performance Tuning

- **Batch Size**: Start with 50, adjust based on document size and RU capacity
- **Concurrency**: Use `-1` for SDK optimization, or specify max concurrent operations
- **RU Provisioning**: Monitor 429 errors and scale RU/s accordingly

## 🛠️ Available Scripts

| Script | Command | Description |
|--------|---------|-------------|
| **Build** | `npm run build` | Compile TypeScript to JavaScript |
| **Run** | `npm run start:insert-at-scale` | Execute the bulk insert operation |

## 📁 Project Structure

```
nosql-insert-at-scale-typescript/
├── src/
│   ├── insert-at-scale.ts           # Main application entry point
│   └── utils/
│       ├── cosmos-operations.ts     # Database and container operations
│       ├── cosmos-resiliency.ts     # Resilient insert with retry logic
│       ├── metrics.ts               # Performance monitoring
│       ├── resilience-interfaces.ts # Type definitions
│       └── utils.ts                 # Common utilities
├── scripts/
│   ├── setup-cosmos-nosql-dataplane-permissions.sh  # RBAC setup script
│   └── README.md                    # Script documentation
├── docs/                            # Additional documentation
├── .env.example                     # Environment template
├── package.json                     # Dependencies and scripts
└── tsconfig.json                    # TypeScript configuration
```

## 🔐 Authentication Methods

### Option 1: Passwordless (Recommended)

Uses Azure Identity with your logged-in Azure CLI credentials:

1. **Login to Azure CLI**: `az login`
2. **Set RBAC permissions**: `./scripts/setup-cosmos-nosql-dataplane-permissions.sh`
3. **Configure .env**: Only add `COSMOS_ENDPOINT` required

### Option 2: Connection String/Key

Traditional approach with primary key:

1. **Get primary key** from Azure Portal → Cosmos DB → Keys
2. **Add to .env**: `COSMOS_KEY=your-primary-key`

## 🚨 Troubleshooting

### Common Issues

**Authentication Errors**
```bash
❌ Cosmos DB client is not configured properly
```
- **Solution**: Run the RBAC setup script or add `COSMOS_KEY` to `.env`

**Rate Limiting (429 Errors)**
```bash
⏳ Rate limiting detected for document X - retrying in 1s
```
- **Solution**: Increase RU/s provisioning or enable autoscale
- **Note**: Some 429 errors are normal and handled automatically

**Data File Not Found**
```bash
❌ Failed to load data from ../../data/HotelsData_toCosmosDB_Vector.json
```
- **Solution**: Verify the data file path in `DATA_FILE_WITH_VECTORS`

**Permission Denied**
```bash
Failed to create role assignment
```
- **Solution**: Ensure you have `Cosmos DB Operator` role or equivalent permissions

### Debug Mode

Enable detailed logging:
```bash
# Add to .env
DEBUG=true
```

## 📊 Performance Optimization

### RU Consumption
- **High RU/doc (>300)**: Consider document size reduction or index optimization
- **429 Errors**: Increase provisioned RU/s or enable autoscale
- **Cost Control**: Monitor serverless costs with built-in estimation

### Latency Optimization
- **High Latency (>2000ms)**: Check region proximity and RU provisioning
- **Batch Tuning**: Adjust `BATCH_SIZE` based on document size
- **Concurrency**: Fine-tune `MAX_CONCURRENCY` for your workload

### Vector Index Management
- **External Scripts**: Use `./scripts/remove-vector-indexes.sh` before bulk insert and `./scripts/restore-vector-indexes.sh` after
- **Performance**: Removing indexes during bulk operations significantly improves insert performance
- **Workflow**: See `./scripts/README.md` for complete workflow documentation
