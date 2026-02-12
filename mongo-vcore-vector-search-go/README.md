# Azure DocumentDB Vector Samples (Go)

This project demonstrates vector search capabilities using Azure DocumentDB with Go. It includes implementations of three different vector index types: DiskANN, HNSW, and IVF, along with utilities for embedding generation and data management.

## Overview

Vector search enables semantic similarity searching by converting text into high-dimensional vector representations (embeddings) and finding the most similar vectors in the database. This project shows how to:

- Generate embeddings using Azure OpenAI
- Store vectors in Azure DocumentDB
- Create and use different types of vector indexes
- Perform similarity searches with various algorithms
- Handle authentication using Azure Active Directory (passwordless) or connection strings

## Prerequisites

Before running this project, you need:

### Azure Resources
1. **Azure subscription** with appropriate permissions
2. **Azure OpenAI resource** with embedding model deployment
3. **Azure DocumentDB resource**
4. **Azure CLI** installed and configured

### Development Environment
- **Go 1.24 or higher**
- **Git** (for cloning the repository)
- **Visual Studio Code** (recommended) or another Go IDE

## Setup Instructions

### Step 1: Clone and Setup Project

```bash
# Clone this repository
git clone <your-repo-url>
cd cosmos-db-vector-samples/mongo-vcore-vector-search-go

# Initialize Go modules (if needed)
go mod tidy

# Download dependencies
go mod download
```

### Step 2: Create Azure Resources

#### Create Azure OpenAI Resource
```bash
# Login to Azure
az login

# Create resource group (if needed)
az group create --name <resource-group> --location <region>

# Create Azure OpenAI resource
az cognitiveservices account create \
    --name <open-ai-resource> \
    --resource-group <resource-group> \
    --location <region> \
    --kind OpenAI \
    --sku S0 \
    --subscription <subscription>
```

#### Deploy Embedding Model
1. Go to Azure OpenAI Studio (https://oai.azure.com/)
2. Navigate to your OpenAI resource
3. Go to **Model deployments** and create a new deployment
4. Choose **text-embedding-ada-002** model
5. Note the deployment name for configuration

#### Create Azure DocumentDB Resource

Create a Azure DocumentDB cluster by using the [Azure portal](https://learn.microsoft.com/azure/documentdb/quickstart-portal), [Bicep](https://learn.microsoft.com/azure/documentdb/quickstart-bicep), or [Terraform](https://learn.microsoft.com/azure/documentdb/quickstart-terraform).

### Step 3: Get Your Connection Information

#### Azure OpenAI Endpoint and Key
```bash
# Get OpenAI endpoint
az cognitiveservices account show \
    --name <open-ai-resource> \
    --resource-group <resource-group> \
    --query "properties.endpoint" --output tsv

# Get OpenAI key
az cognitiveservices account keys list \
    --name <open-ai-resource> \
    --resource-group <resource-group> \
    --query "key1" --output tsv
```

#### DocumentDB Connection String
```bash
# Get DocumentDB connection string
az resource show \
    --resource-group "<resource-group>" \
    --name "<cluster-name>" \
    --resource-type "Microsoft.DocumentDB/mongoClusters" \
    --query "properties.connectionString" \
    --latest-include-preview
```

### Step 4: Configure Environment Variables

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

# DocumentDB Configuration
MONGO_CONNECTION_STRING=mongodb+srv://username:password@your-cluster.mongocluster.cosmos.azure.com/?tls=true&authMechanism=SCRAM-SHA-256&retrywrites=false&maxIdleTimeMS=120000
MONGO_CLUSTER_NAME=vectorSearch

# Data Configuration (defaults should work)
DATA_FILE_WITHOUT_VECTORS=data/HotelsData_toCosmosDB.json
DATA_FILE_WITH_VECTORS=data/HotelsData_toCosmosDB_Vector.json
FIELD_TO_EMBED=Description
EMBEDDED_FIELD=text_embedding_ada_002
EMBEDDING_DIMENSIONS=1536
EMBEDDING_SIZE_BATCH=16
LOAD_SIZE_BATCH=100
```

### Step 5: Configure passwordless authentication (optional)
To use passwordless authentication with Microsoft Entra ID, follow these steps:

1. In your Azure DocumentDB resource, enable **Native DocumentDB** and **Microsoft Entra ID** authentication methods.
2. Assign your Microsoft Entra ID user the following roles on the Cosmos DB resource:
   - **Cosmos DB Account Reader Role**
   - **DocumentDB Account Contributor**

## Usage

The project includes several Go programs that demonstrate different aspects of vector search:

### 1. Generate Embeddings
First, create vector embeddings for the hotel data:

```bash
go run src/create_embeddings.go src/utils.go
```

This program:
- Reads hotel data from `data/HotelsData_toCosmosDB_Vector.json`
- Generates embeddings for hotel descriptions using Azure OpenAI
- Saves enhanced data with embeddings to `data/HotelsData_with_vectors.json`

### 2. DiskANN Vector Search
Run DiskANN (Disk-based Approximate Nearest Neighbor) search:

```bash
go run src/diskann.go src/utils.go
```

DiskANN is optimized for:
- Large datasets that don't fit in memory
- Efficient disk-based storage
- Good balance of speed and accuracy

### 3. HNSW Vector Search
Run HNSW (Hierarchical Navigable Small World) search:

```bash
go run src/hnsw.go src/utils.go
```

HNSW provides:
- Excellent search performance
- High recall rates
- Hierarchical graph structure
- Good for real-time applications

### 4. IVF Vector Search
Run IVF (Inverted File) search:

```bash
go run src/ivf.go src/utils.go
```

IVF features:
- Clusters vectors by similarity
- Fast search through cluster centroids
- Configurable accuracy vs speed trade-offs
- Efficient for large vector datasets

### 5. View Vector Indexes
Display information about created indexes:

```bash
go run src/show_indexes.go src/utils.go
```

This utility shows:
- All vector indexes in collections
- Index configuration details
- Algorithm-specific parameters
- Index status and statistics

## Important Notes

### Vector Index Limitations
**One Index Per Field**: Azure DocumentDB allows only one vector index per field. Each script automatically handles this by:

1. **Dropping existing indexes**: Before creating a new vector index, the script removes any existing vector indexes on the same field
2. **Safe switching**: You can run different vector index scripts in any order - each will clean up previous indexes first

```bash
# Example: Switch between different vector index types
go run src/diskann.go src/utils.go   # Creates DiskANN index
go run src/hnsw.go src/utils.go      # Drops DiskANN, creates HNSW index
go run src/ivf.go src/utils.go       # Drops HNSW, creates IVF index
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
- **DiskANN**: Requires premium/high-performance tier. Available on M30 and above

If you encounter "not enabled for this cluster tier" errors:
1. Try a different index type (IVF is most widely supported)
2. Consider upgrading your cluster tier
3. Check the [Azure DocumentDB pricing page](https://azure.microsoft.com/pricing/details/document-db/) for tier features

## Authentication Options

The project supports two authentication methods. **Passwordless authentication is strongly recommended** as it follows Azure security best practices.

### Method 1: Passwordless Authentication (Recommended - Most Secure)

Uses Microsoft Entra ID with DefaultAzureCredential for enhanced security:

```go
config := LoadConfig()
mongoClient, azureOpenAIClient, err := GetClientsPasswordless()
if err != nil {
    log.Fatalf("Failed to initialize clients: %v", err)
}
defer mongoClient.Disconnect(ctx)
```

**Benefits of passwordless authentication:**
- ✅ No credentials stored in connection strings
- ✅ Uses Azure AD authentication and RBAC
- ✅ Automatic token rotation and renewal
- ✅ Centralized identity management
- ✅ Better audit and compliance capabilities

**Setup for passwordless authentication:**

1. Ensure you're logged in with `az login`
2. Enable **Native DocumentDB and Microsoft Entra ID authentication** methods for your Azure DocumentDB resource.
3. Grant your identity appropriate RBAC permissions on your Azure DocumentDB instance. You need **Cosmos DB Account Reader Role** and **DocumentDB Account Contributor** roles assigned to your user.
4. Set `MONGO_CLUSTER_NAME` instead of `MONGO_CONNECTION_STRING` in `.env`

### Method 2: Connection String Authentication

Uses MongoDB connection string with username/password:

```go
config := LoadConfig()
mongoClient, azureOpenAIClient, err := GetClients()
if err != nil {
    log.Fatalf("Failed to initialize clients: %v", err)
}
defer mongoClient.Disconnect(ctx)
```

**Note:** While simpler to set up, this method requires storing credentials in your configuration and is less secure than passwordless authentication.

## Project Structure

```
mongo-vcore-vector-search-go/
├── src/
│   ├── utils.go              # Shared utility functions and configuration
│   ├── create_embeddings.go  # Generate embeddings with Azure OpenAI
│   ├── diskann.go           # DiskANN vector search implementation
│   ├── hnsw.go              # HNSW vector search implementation
│   ├── ivf.go               # IVF vector search implementation
│   └── show_indexes.go      # Display vector index information
├── data/
│   ├── HotelsData_toCosmosDB_Vector.json  # Sample hotel data (original)
│   └── HotelsData_with_vectors.json       # Generated with embeddings
├── go.mod                   # Go module dependencies
├── go.sum                   # Dependency checksums
├── .env                     # Environment variables (create this)
└── README.md               # This file
```

## Key Features

### Vector Index Types
- **DiskANN**: Optimized for large datasets with disk-based storage
- **HNSW**: High-performance hierarchical graph structure
- **IVF**: Clustering-based approach with configurable accuracy

### Utilities
- Flexible authentication (connection string or passwordless with Microsoft Entra ID)
- Batch processing for large datasets with configurable batch sizes
- Comprehensive error handling and retry logic
- Progress tracking for long operations
- Built-in logging and debugging capabilities

### Sample Data
- Real hotel dataset with descriptions, locations, and amenities
- Pre-configured for embedding generation
- Includes various hotel types and price ranges

## Troubleshooting

### Common Issues

1. **Authentication Errors**
   - Verify Azure OpenAI endpoint and key
   - Check Azure DocumentDB connection string
   - Ensure proper RBAC permissions for passwordless authentication. You need **Cosmos DB Account Reader Role** and **DocumentDB Account Contributor** roles assigned to your user. Roles may take some time to propagate.

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

## Performance Considerations

### Choosing Vector Index Types
- **Use DiskANN when**: Dataset is very large, memory is limited, vector count is up to 500,000+
- **Use HNSW when**: Need fastest search, have sufficient memory, vector count is up to 50,000
- **Use IVF when**: Want configurable accuracy/speed trade-offs, vector count is under 10,000

### Tuning Parameters
- **Batch sizes**: Adjust based on API rate limits and memory
- **Vector dimensions**: Must match your embedding model
- **Index parameters**: Tune for your specific accuracy/speed requirements

### Cost Optimization
- Use appropriate Azure OpenAI pricing tier
- Monitor API usage and optimize batch processing

## Further Resources

- [Azure DocumentDB Documentation](https://learn.microsoft.com/azure/documentdb/)
- [Azure OpenAI Service Documentation](https://learn.microsoft.com/azure/ai-services/openai/)
- [Vector Search in Cosmos DB](https://learn.microsoft.com/azure/documentdb/vector-search)
- [Go MongoDB Driver Documentation](https://pkg.go.dev/go.mongodb.org/mongo-driver/mongo)
- [Azure SDK for Go Documentation](https://pkg.go.dev/github.com/Azure/azure-sdk-for-go)

## Support

If you encounter issues:
1. Check the troubleshooting section above
2. Review Azure resource configurations
3. Verify environment variable settings
4. Check Azure service status and quotas
