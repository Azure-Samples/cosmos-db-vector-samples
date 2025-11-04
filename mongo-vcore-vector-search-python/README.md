# Cosmos DB Vector Samples (Python)

This project demonstrates vector search capabilities using Azure Cosmos DB for MongoDB (vCore) with Python. It includes implementations of three different vector index types: DiskANN, HNSW, and IVF, along with utilities for embedding generation and data management.

## Overview

Vector search enables semantic similarity searching by converting text into high-dimensional vector representations (embeddings) and finding the most similar vectors in the database. This project shows how to:

- Generate embeddings using Azure OpenAI
- Store vectors in Cosmos DB for MongoDB (vCore)
- Create and use different types of vector indexes
- Perform similarity searches with various algorithms

## Prerequisites

Before running this project, you need:

### Azure Resources
1. **Azure subscription** with appropriate permissions
2. **Azure OpenAI resource** with embedding model deployment
3. **Azure Cosmos DB for MongoDB (vCore) resource**
4. **Azure CLI** installed and configured

### Development Environment
- **Python 3.8 or higher**
- **Git** (for cloning the repository)
- **Visual Studio Code** (recommended) or another Python IDE

## Setup Instructions

### Step 1: Clone and Setup Project

```bash
# Clone this repository
git clone <your-repo-url>
cd cosmos-db-vector-samples/mongo-vcore-vector-search-python

# Create virtual environment
python -m venv venv

# Activate virtual environment
# On Windows:
venv\\Scripts\\activate
# On macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### Step 2: Create Azure Resources

#### Create Azure OpenAI Resource
```bash
# Login to Azure
az login

# Create resource group (if needed)
az group create --name myResourceGroup --location eastus

# Create Azure OpenAI resource
az cognitiveservices account create \
    --name myOpenAIResource \
    --resource-group myResourceGroup \
    --location eastus \
    --kind OpenAI \
    --sku S0 \
    --subscription mySubscription
```

#### Deploy Embedding Model
1. Go to Azure OpenAI Studio (https://oai.azure.com/)
2. Navigate to your OpenAI resource
3. Go to **Deployments** and create a new deployment
4. Choose **text-embedding-ada-002** model
5. Note the deployment name for configuration

#### Create Cosmos DB for MongoDB (vCore)

Learn how to create a Cosmos DB for MongoDB (vCore) account in the [official documentation](https://learn.microsoft.com/en-us/azure/cosmos-db/mongodb/vcore/quickstart-portal).

### Step 3: Configure Environment Variables

1. Copy the example environment file:
```bash
cp .env.example .env
```

2. Edit `.env` file with your Azure resource information:

```env
# Azure OpenAI Configuration
AZURE_OPENAI_EMBEDDING_MODEL=text-embedding-ada-002
AZURE_OPENAI_EMBEDDING_ENDPOINT=https://your-openai-resource.openai.azure.com/
AZURE_OPENAI_EMBEDDING_KEY=your-azure-openai-api-key
AZURE_OPENAI_EMBEDDING_API_VERSION=2024-02-01

# MongoDB/Cosmos DB Configuration
MONGO_CONNECTION_STRING=mongodb+srv://username:password@your-cluster.mongocluster.cosmos.azure.com/?tls=true&authMechanism=SCRAM-SHA-256&retrywrites=false&maxIdleTimeMS=120000
MONGO_CLUSTER_NAME=vectorSearch

# Data Configuration (defaults should work)
DATA_FILE_WITHOUT_VECTORS=data/HotelsData_toCosmosDB_Vector.json
DATA_FILE_WITH_VECTORS=data/HotelsData_with_vectors.json
FIELD_TO_EMBED=Description
EMBEDDED_FIELD=DescriptionVector
EMBEDDING_DIMENSIONS=1536
EMBEDDING_SIZE_BATCH=16
LOAD_SIZE_BATCH=100
```

### Step 4: Get Your Connection Information

#### Azure OpenAI Endpoint and Key
```bash
# Get OpenAI endpoint
az cognitiveservices account show \
    --name myOpenAIResource \
    --resource-group myResourceGroup \
    --query "properties.endpoint" --output tsv

# Get OpenAI key
az cognitiveservices account keys list \
    --name myOpenAIResource \
    --resource-group myResourceGroup \
    --query "key1" --output tsv
```

#### Cosmos DB Connection String
```bash
# Get Cosmos DB connection string
az cosmosdb keys list \
    --name myCosmosAccount \
    --resource-group myResourceGroup \
    --type connection-strings \
    --query "connectionStrings[0].connectionString" --output tsv
```

## Usage

The project includes several Python scripts that demonstrate different aspects of vector search:

### 1. Generate Embeddings
First, create vector embeddings for the hotel data:

```bash
python src/create_embeddings.py
```

This script:
- Reads hotel data from `data/HotelsData_toCosmosDB_Vector.json`
- Generates embeddings for hotel descriptions using Azure OpenAI
- Saves enhanced data with embeddings to `data/HotelsData_with_vectors.json`

### 2. DiskANN Vector Search
Run DiskANN (Disk-based Approximate Nearest Neighbor) search:

```bash
python src/diskann.py
```

DiskANN is optimized for:
- Large datasets that don't fit in memory
- Efficient disk-based storage
- Good balance of speed and accuracy

### 3. HNSW Vector Search
Run HNSW (Hierarchical Navigable Small World) search:

```bash
python src/hnsw.py
```

HNSW provides:
- Excellent search performance
- High recall rates
- Hierarchical graph structure
- Good for real-time applications

### 4. IVF Vector Search
Run IVF (Inverted File) search:

```bash
python src/ivf.py
```

IVF features:
- Clusters vectors by similarity
- Fast search through cluster centroids
- Configurable accuracy vs speed trade-offs
- Efficient for large vector datasets

### 5. View Vector Indexes
Display information about created indexes:

```bash
python src/show_indexes.py
```

This utility shows:
- All vector indexes in collections
- Index configuration details
- Algorithm-specific parameters
- Index status and statistics

## Important Notes

### Vector Index Limitations
**One Index Per Field**: Cosmos DB for MongoDB (vCore) allows only one vector index per field. Each script automatically handles this by:

1. **Dropping existing indexes**: Before creating a new vector index, the script removes any existing vector indexes on the same field
2. **Safe switching**: You can run different vector index scripts in any order - each will clean up previous indexes first

```bash
# Example: Switch between different vector index types
python src/diskann.py   # Creates DiskANN index
python src/hnsw.py      # Drops DiskANN, creates HNSW index
python src/ivf.py       # Drops HNSW, creates IVF index
```

**What this means**:
- You cannot have both DiskANN and HNSW indexes simultaneously
- Each run replaces the previous vector index with a new one
- Data remains intact - only the search index changes
- No manual cleanup required

### Cluster Tier Requirements
Different vector index types require different cluster tiers:

- **IVF**: Available on most tiers (including basic)
- **HNSW**: Requires standard tier or higher
- **DiskANN**: Requires premium/high-performance tier

If you encounter "not enabled for this cluster tier" errors:
1. Try a different index type (IVF is most widely supported)
2. Consider upgrading your cluster tier
3. Check the [Cosmos DB pricing page](https://azure.microsoft.com/pricing/details/cosmos-db/) for tier features

## Authentication Options

The project supports two authentication methods. **Passwordless authentication is strongly recommended** as it follows Azure security best practices.

### Method 1: Passwordless Authentication (Recommended - Most Secure)
Uses Azure Active Directory with DefaultAzureCredential for enhanced security:

```python
from utils import get_clients_passwordless
mongo_client, openai_client = get_clients_passwordless()
```

**Benefits of passwordless authentication:**
- ✅ No credentials stored in connection strings
- ✅ Uses Azure AD authentication and RBAC
- ✅ Automatic token rotation and renewal
- ✅ Centralized identity management
- ✅ Better audit and compliance capabilities

**Setup for passwordless authentication:**
1. Ensure you're logged in with `az login`
2. Grant your identity appropriate RBAC permissions on Cosmos DB
3. Set `MONGO_CLUSTER_NAME` instead of `MONGO_CONNECTION_STRING` in `.env`

### Method 2: Connection String Authentication 

Uses MongoDB connection string with username/password:

```python
from utils import get_clients
mongo_client, openai_client = get_clients()
```

**Note:** While simpler to set up, this method requires storing credentials in your configuration and is less secure than passwordless authentication.

## Project Structure

```
cosmos-db-vector-samples/
├── src/
│   ├── utils.py              # Shared utility functions
│   ├── create_embeddings.py  # Generate embeddings with Azure OpenAI
│   ├── diskann.py           # DiskANN vector search implementation
│   ├── hnsw.py              # HNSW vector search implementation
│   ├── ivf.py               # IVF vector search implementation
│   └── show_indexes.py      # Display vector index information
├── data/
│   └── HotelsData_toCosmosDB_Vector.json  # Sample hotel data
├── requirements.txt         # Python dependencies
├── .env.example            # Environment variables template
└── README.md              # This file
```

## Key Features

### Vector Index Types
- **DiskANN**: Optimized for large datasets with disk-based storage
- **HNSW**: High-performance hierarchical graph structure
- **IVF**: Clustering-based approach with configurable accuracy

### Utilities
- Flexible authentication (connection string or passwordless)
- Batch processing for large datasets
- Error handling and retry logic
- Progress tracking for long operations
- Comprehensive logging and debugging

### Sample Data
- Real hotel dataset with descriptions, locations, and amenities
- Pre-configured for embedding generation
- Includes various hotel types and price ranges

## Troubleshooting

### Common Issues

1. **Authentication Errors**
   - Verify Azure OpenAI endpoint and key
   - Check Cosmos DB connection string
   - Ensure proper RBAC permissions for passwordless auth

2. **Embedding Generation Fails**
   - Check Azure OpenAI model deployment name
   - Verify API version compatibility
   - Monitor rate limits and adjust batch sizes

3. **Vector Search Returns No Results**
   - Ensure embeddings were created successfully
   - Verify vector indexes are built properly
   - Check data was inserted into collection

4. **Performance Issues**
   - Adjust batch sizes in environment variables
   - Optimize vector index parameters
   - Consider using appropriate index type for your use case

### Debug Mode
Enable debug mode for verbose logging:

```env
DEBUG=true
```

### Connection Testing
Test your MongoDB connection:

```bash
python -c \"
from src.utils import get_clients
try:
    client, _ = get_clients()
    print('Connection successful!')
    client.close()
except Exception as e:
    print(f'Connection failed: {e}')
\"
```

## Performance Considerations

### Choosing Vector Index Types
- **Use DiskANN when**: Dataset is very large, memory is limited
- **Use HNSW when**: Need fastest search, have sufficient memory
- **Use IVF when**: Want configurable accuracy/speed trade-offs

### Tuning Parameters
- **Batch sizes**: Adjust based on API rate limits and memory
- **Vector dimensions**: Must match your embedding model
- **Index parameters**: Tune for your specific accuracy/speed requirements

### Cost Optimization
- Use appropriate Azure OpenAI pricing tier
- Consider Cosmos DB serverless vs provisioned throughput
- Monitor API usage and optimize batch processing

## Further Resources

- [Azure Cosmos DB for MongoDB (vCore) Documentation](https://learn.microsoft.com/en-us/azure/cosmos-db/mongodb/vcore/)
- [Azure OpenAI Service Documentation](https://learn.microsoft.com/en-us/azure/ai-services/openai/)
- [Vector Search in Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/mongodb/vcore/vector-search)
- [Python MongoDB Driver Documentation](https://pymongo.readthedocs.io/)

## Support

If you encounter issues:
1. Check the troubleshooting section above
2. Review Azure resource configurations
3. Verify environment variable settings
4. Check Azure service status and quotas