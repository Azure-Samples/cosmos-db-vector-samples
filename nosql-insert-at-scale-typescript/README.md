# 🏨 Azure Cosmos DB Insert at Scale Operations

Enterprise-grade resilient bulk insertion for Azure Cosmos DB NoSQL API.

## 🎯 Overview

This application demonstrates high-performance bulk insertion of documents into Azure Cosmos DB, featuring:

- **🔄 Resilient Operations**: Automatic retry logic with exponential backoff for rate limiting (429 errors) using the `container.items.bulk()` API
- **📊 Performance Monitoring**: Real-time RU consumption and latency tracking  
- **💰 Cost Estimation**: Built-in autoscale cost calculations (configurable via `SHOW_COST` environment variable)
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
DEBUG=true

# ========================================
# Display Configuration
# ========================================
# Set to true to show cost estimation in output
# Cost estimation includes autoscale and serverless pricing
# Default: false (cost info hidden for cleaner output)
SHOW_COST=false

# ===COSMOS_CONTAINER_NAME=hotels-insert-scale====================================
# Data File Paths and Vector Configuration
# ========================================
#DATA_FILE_WITH_VECTORS=../HotelsData_toCosmosDB_Vector.json
DATA_FILE_WITHOUT_VECTORS=HotelsData.json
DATA_FILE_WITH_VECTORS=../HotelsData_text_embedding_small_3.json
FIELD_TO_EMBED=Description
EMBEDDED_FIELD=embedding
EMBEDDING_DIMENSIONS=1536
LOAD_SIZE_BATCH=100
EMBEDDING_BATCH_SIZE=20

# ========================================
# Insert Operation Configuration
# ========================================
BATCH_SIZE=5
MAX_CONCURRENCY=1

# ========================================
# Cosmos DB Connection Settings (Required)
# ========================================
# Get these values from Azure Portal > Cosmos DB > Keys
COSMOS_ENDPOINT=https://your-cosmos-account.documents.azure.com:443/
COSMOS_KEY=your-cosmos-primary-key-here
COSMOS_CONNECTION_STRING=AccountEndpoint=https://your-cosmos-account.documents.azure.com:443/;AccountKey=your-cosmos-primary-key-here;
COSMOS_DB_NAME=Hotels
COSMOS_CONTAINER_NAME=Insert-at-scale
COSMOS_RESOURCE_GROUP=your-resource-group-name

# ========================================
# Cosmos DB Partition Configuration
# ========================================
PARTITION_KEY_PATH=/HotelId

# ========================================
# Azure OpenAI for Embeddings (Required)
# ========================================
# Get these values from Azure Portal > Azure OpenAI > Keys and Endpoint
AZURE_OPENAI_EMBEDDING_KEY=your-azure-openai-api-key-here
AZURE_OPENAI_EMBEDDING_ENDPOINT=https://your-openai-resource.cognitiveservices.azure.com
AZURE_OPENAI_EMBEDDING_MODEL=text-embedding-3-small
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

# Run the insert operation
npm run start:insert
```

## 📊 Expected Output

When running successfully, you'll see output similar to the following:

```
> cosmos-vector-insert-at-scale@1.0.0 start:insert
> node --env-file .env dist/insert.js

🏨 Azure Cosmos DB Insert at Scale Operations
==============================================
Environment: development
Timestamp: 2025-11-04T15:33:35.144Z
✅ Cosmos DB client initialized successfully
🔍 Connection Details:
   Database: Hotels
   Container: Insert-at-scale-2
   Partition Key Path: /HotelId
   Batch Size: 5
   Max Concurrency: 1

📊 Step 1: Loading Data
=======================
Reading JSON file from C:\Users\diberry\repos\samples\cosmos-db-vector-samples\nosql-insert-at-scale-typescript\HotelsData_text_embedding_small_3.json
✅ Loaded 50 documents from ../HotelsData_text_embedding_small_3.json
🔍 Validating that documents contain embedding field 'embedding'...
✅ All documents contain valid embedding field 'embedding' with 1536 dimensions

🚀 Step 2: Enterprise-Grade Bulk Insert
======================================
Configuration:
  - Database: Hotels
  - Container: Insert-at-scale-2
  - Batch size: 5
  - Concurrency: 1
  - Documents to insert: 50
Getting database Hotels...
Getting container Insert-at-scale-2...
✅ Database: Hotels
✅ Container: Insert-at-scale-2
✅ Partition key: /HotelId

Starting resilient insert...
ℹ️  Resilient insert operation completed
🎯 Batch processing completed: 50 inserted, 0 failed, 5 retries

✅ Insert Operation Complete:
   Inserted: 50/50 documents
   Failed: 0, Retries: 5
   Total time: 8.0s
   RU consumed: 15,559.476
   Avg RU/doc: 311.19
   Avg latency: 94ms/doc
   Peak RU/s observed: 316.4
   💡 Set SHOW_COST=true to see cost estimation

⚠️  Errors encountered:
   429: 5 occurrences
   💡 Autoscale Tips:
      - Your current max autoscale RU/s may be too low
      - Autoscale takes 10-30 seconds to scale up
      - Consider increasing max autoscale RU/s to 1000
      - Or reduce batch size further (currently 5)

📈 Step 3: Performance Analysis
==============================
RU Consumption Analysis:
  - Total RUs: 15,559.476
  - Average RU/document: 311.19
  - Peak RU/operation: 316.43

Performance Metrics:
  - Total duration: 8.0s
  - Average latency: 94ms/document
  - Peak latency: 220ms
  - Throughput: 6.2 docs/second

Optimization Recommendations:
  ⚠️  High RU consumption per document (311.19 RU/doc)
     - Consider document size optimization
     - Review indexing policies
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
| **Required Variables** | | | |
| `COSMOS_ENDPOINT` | ✅ | - | Your Cosmos DB account endpoint |
| `COSMOS_DB_NAME` | ✅ | `Hotels` | Database name |
| `COSMOS_CONTAINER_NAME` | ✅ | `Insert-at-scale` | Container name |
| `COSMOS_RESOURCE_GROUP` | ✅ | - | Azure resource group (for RBAC setup) |
| `PARTITION_KEY_PATH` | ✅ | `/HotelId` | Partition key path |
| `AZURE_OPENAI_EMBEDDING_KEY` | ✅ | - | Azure OpenAI API key |
| `AZURE_OPENAI_EMBEDDING_ENDPOINT` | ✅ | - | Azure OpenAI service endpoint |
| **Optional Configuration** | | | |
| `DEBUG` | ❌ | `false` | Enable debug logging |
| `SHOW_COST` | ❌ | `false` | Display cost estimation information |
| `DATA_FILE_WITHOUT_VECTORS` | ❌ | `HotelsData.json` | Path to data file without vectors |
| `DATA_FILE_WITH_VECTORS` | ❌ | `../HotelsData_text_embedding_small_3.json` | Path to data file with vectors |
| `FIELD_TO_EMBED` | ❌ | `Description` | Field name to create embeddings for |
| `EMBEDDED_FIELD` | ❌ | `embedding` | Embedding field name |
| `EMBEDDING_DIMENSIONS` | ❌ | `1536` | Vector dimensions |
| `LOAD_SIZE_BATCH` | ❌ | `100` | Batch size for loading data |
| `EMBEDDING_BATCH_SIZE` | ❌ | `20` | Batch size for embedding creation |
| `BATCH_SIZE` | ❌ | `5` | Documents per batch |
| `MAX_CONCURRENCY` | ❌ | `1` | Max concurrent operations |
| `COSMOS_KEY` | ❌ | - | Primary key (if not using passwordless) |
| `COSMOS_CONNECTION_STRING` | ❌ | - | Full connection string (alternative to endpoint/key) |
| `AZURE_OPENAI_EMBEDDING_MODEL` | ❌ | `text-embedding-3-small` | Embedding model to use |

### Performance Tuning

- **Batch Size**: Start with 5, adjust based on document size and RU capacity
- **RU Provisioning**: Autoscale is recommended for variable workloads - monitor 429 errors and adjust max RU/s accordingly
- **Cost Monitoring**: Set `SHOW_COST=true` to see detailed autoscale cost estimations and recommendations

### Bulk Operations API

This application uses Azure Cosmos DB's `container.items.bulk()` API which provides:
- **Improved Performance**: Optimized batch processing with automatic parallelization
- **Enhanced Retry Logic**: Built-in resilience for transient failures  
- **Better Resource Utilization**: More efficient RU consumption patterns
- **Comprehensive Error Handling**: Detailed error reporting and recovery strategies

## 🛠️ Available Scripts

| Script | Command | Description |
|--------|---------|-------------|
| **Build** | `npm run build` | Compile TypeScript to JavaScript |
| **Insert at Scale** | `npm run start:insert-at-scale` | Execute the bulk insert operation |
| **Delete All** | `npm run start:delete` | Delete all documents from container |
| **Insert Sample** | `npm run start:insert` | Insert sample data (smaller dataset) |

## 📁 Project Structure

```
nosql-insert-at-scale-typescript/
├── src/
│   ├── insert-at-scale.ts           # Main bulk insert application
│   ├── insert.ts                    # Sample insert operations
│   ├── delete.ts                    # Bulk delete operations
│   └── utils/
│       ├── cosmos-operations.ts     # Database and container operations
│       ├── cosmos-resiliency.ts     # Resilient operations with all type definitions
│       ├── metrics.ts               # Performance monitoring
│       └── utils.ts                 # Common utilities and cost calculations
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

### Cost Display

Control cost estimation display:
```bash
# Add to .env  
SHOW_COST=true    # Show detailed autoscale cost calculations
SHOW_COST=false   # Hide cost information (default)
```

## 📊 Performance Optimization

### RU Consumption and Autoscale
- **High RU/doc (>300)**: Consider document size reduction or index optimization
- **429 Errors**: Normal during high-throughput operations; autoscale handles these automatically
- **Autoscale Benefits**: Automatically adjusts RU/s based on demand, provides cost efficiency for variable workloads
- **Cost Monitoring**: Use `SHOW_COST=true` to get detailed monthly cost estimates and autoscale recommendations

### Latency Optimization
- **High Latency (>2000ms)**: Check region proximity and autoscale max RU/s configuration
- **Batch Tuning**: Adjust `BATCH_SIZE` based on document size (larger docs = smaller batches)

### New `container.items.bulk()` API Benefits
- **Improved Throughput**: Up to 30% better performance compared to legacy bulk operations
- **Automatic Parallelization**: SDK optimizes parallel execution based on partition distribution
- **Enhanced Error Handling**: Better granular error reporting and retry strategies
- **Resource Efficiency**: More efficient RU consumption patterns

### Vector Index Management
- **External Scripts**: Use `./scripts/remove-vector-indexes.sh` before bulk insert and `./scripts/restore-vector-indexes.sh` after
- **Performance**: Removing indexes during bulk operations significantly improves insert performance
- **Workflow**: See `./scripts/README.md` for complete workflow documentation
