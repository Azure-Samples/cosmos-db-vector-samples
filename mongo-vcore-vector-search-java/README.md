# Azure DocumentDB Vector Samples (Java)

This project demonstrates vector search capabilities using Azure DocumentDB with Java. It includes implementations of three different vector index types: DiskANN, HNSW, and IVF, along with helper methods for embedding generation and data management.

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
- **Java 21 or higher**
- **Maven 3.6 or higher**
- **Git** (for cloning the repository)
- **Visual Studio Code** (recommended) or another Java IDE

## Setup Instructions

### Step 1: Clone and Setup Project

```bash
# Clone this repository
git clone https://github.com/Azure-Samples/cosmos-db-vector-samples.git
cd cosmos-db-vector-samples/mongo-vcore-vector-search-java

# Compile the project
mvn clean compile
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

### Step 4: Configure Application Properties

Edit the `src/main/resources/application.properties` file with your Azure resource information:

```properties
# Azure OpenAI Embedding Settings
AZURE_OPENAI_EMBEDDING_MODEL=text-embedding-ada-002
AZURE_OPENAI_EMBEDDING_API_VERSION=2023-05-15
AZURE_OPENAI_EMBEDDING_ENDPOINT=https://<your-openai-resource>.openai.azure.com/
EMBEDDING_SIZE_BATCH=16

# MongoDB configuration
MONGO_CLUSTER_NAME=<your-mongo-cluster-name>

# Data file
DATA_FILE_WITH_VECTORS=../data/HotelsData_toCosmosDB_Vector.json
EMBEDDED_FIELD=text_embedding_ada_002
EMBEDDING_DIMENSIONS=1536
LOAD_SIZE_BATCH=100
```

Alternatively, you can set these as environment variables which will take precedence over the properties file.

### Step 5: Configure Passwordless Authentication

This sample uses passwordless authentication with Microsoft Entra ID. Follow these steps to configure it:

1. In your Azure DocumentDB resource, enable **Native DocumentDB** and **Microsoft Entra ID** authentication methods.
2. Assign your Microsoft Entra ID user the following roles on the Cosmos DB resource:
   - **Cosmos DB Account Reader Role**
   - **DocumentDB Account Contributor**

## Usage

The project includes several Java classes that demonstrate different aspects of vector search:

### 1. DiskANN Vector Search
Run DiskANN (Disk-based Approximate Nearest Neighbor) search:

```bash
mvn compile exec:java -Dexec.mainClass="com.azure.documentdb.samples.DiskAnn"
```

DiskANN is optimized for:
- Large datasets that don't fit in memory
- Efficient disk-based storage
- Good balance of speed and accuracy

### 2. HNSW Vector Search
Run HNSW (Hierarchical Navigable Small World) search:

```bash
mvn compile exec:java -Dexec.mainClass="com.azure.documentdb.samples.HNSW"
```

HNSW provides:
- Excellent search performance
- High recall rates
- Hierarchical graph structure
- Good for real-time applications

### 3. IVF Vector Search
Run IVF (Inverted File) search:

```bash
mvn compile exec:java -Dexec.mainClass="com.azure.documentdb.samples.IVF"
```

IVF features:
- Clusters vectors by similarity
- Fast search through cluster centroids
- Configurable accuracy vs speed trade-offs
- Efficient for large vector datasets

## Project Structure

```
mongo-vcore-vector-search-java/
├── pom.xml                          # Maven project configuration
├── src/
│   └── main/
│       ├── java/
│       │   └── com/azure/documentdb/samples/
│       │       ├── AppConfig.java   # Configuration management
│       │       ├── DiskAnn.java     # DiskANN vector search implementation
│       │       ├── HNSW.java        # HNSW vector search implementation
│       │       ├── IVF.java         # IVF vector search implementation
│       │       └── HotelData.java   # Hotel data model
│       └── resources/
│           └── application.properties  # Configuration settings
└── data/                            # Hotel data files with vectors
```

## Important Notes

### Vector Index Limitations
**One Index Per Field**: Azure DocumentDB allows only one vector index per field. Each sample automatically handles this by:

1. **Dropping existing collections**: Before creating a new vector index, each sample drops and recreates the collection
2. **Safe switching**: You can run different vector index samples in any order - each will create a fresh collection with the appropriate index

```bash
# Example: Switch between different vector index types
mvn compile exec:java -Dexec.mainClass="com.azure.documentdb.samples.DiskAnn"  # Creates DiskANN index
mvn compile exec:java -Dexec.mainClass="com.azure.documentdb.samples.HNSW"     # Creates HNSW index
mvn compile exec:java -Dexec.mainClass="com.azure.documentdb.samples.IVF"      # Creates IVF index
```

**What this means**:
- You cannot have both DiskANN and HNSW indexes simultaneously on the same field
- Each run creates a new collection with fresh data and the appropriate vector index
- No manual cleanup required

### Cluster Tier Requirements
Different vector index types require different cluster tiers:

- **IVF**: Available on most tiers (including basic)
- **HNSW**: Requires standard tier or higher
- **DiskANN**: Requires premium/high-performance tier. Available on M30 and above

If you encounter "not enabled for this cluster tier" errors:
1. Try a different index type (IVF is most widely supported)
2. Consider upgrading your cluster tier
3. Check the [Azure DocumentDB pricing page](https://azure.microsoft.com/pricing/details/documentdb/) for tier features

## Key Features

### Vector Index Types
- **DiskANN**: Optimized for large datasets with disk-based storage
- **HNSW**: High-performance hierarchical graph structure
- **IVF**: Clustering-based approach with configurable accuracy

### Authentication
- Passwordless authentication with Microsoft Entra ID using DefaultAzureCredential
- Azure AD authentication and RBAC for enhanced security
- Automatic token rotation and renewal

### Sample Data
- Real hotel dataset with descriptions, locations, and amenities
- Pre-configured for embedding generation
- Includes various hotel types and price ranges

## Troubleshooting

### Common Issues

1. **Authentication Errors**
   - Ensure Azure CLI is logged in: `az login`
   - Verify you have proper RBAC permissions on Azure DocumentDB resource
   - Check that Microsoft Entra ID is enabled for your DocumentDB resource
   - Verify you have **Cosmos DB Account Reader Role** and **DocumentDB Account Contributor** roles assigned. Roles may take some time to propagate.

2. **Embedding Generation Fails**
   - Check Azure OpenAI model deployment name
   - Verify API version compatibility
   - Ensure API endpoint is accessible

3. **Vector Search Returns No Results**
   - Ensure data was inserted into collection successfully
   - Verify vector indexes are built properly
   - Check that embeddings match the expected dimensions

4. **Compilation Issues**
   - Verify Java 21 or higher is installed: `java -version`
   - Verify Maven is installed: `mvn -version`
   - Run `mvn clean install` to rebuild the project

5. **Connection Issues**
   - Ensure firewall rules allow your IP address
   - Check that the cluster is running
   - Verify `MONGO_CLUSTER_NAME` is set correctly

## Performance Considerations

### Choosing Vector Index Types
- **Use DiskANN when**: Dataset is very large, memory is limited, vector count is up to 500,000+
- **Use HNSW when**: Need fastest search, have sufficient memory, vector count is up to 50,000
- **Use IVF when**: Want configurable accuracy/speed trade-offs, vector count is under 10,000

### Tuning Parameters
- **Batch sizes**: Adjust `LOAD_SIZE_BATCH` and `EMBEDDING_SIZE_BATCH` based on API rate limits and memory
- **Vector dimensions**: Must match your embedding model (1536 for text-embedding-ada-002)
- **Index parameters**: Tune for your specific accuracy/speed requirements

### Cost Optimization
- Use appropriate Azure OpenAI pricing tier
- Monitor API usage and optimize batch processing

## Further Resources

- [Azure DocumentDB Documentation](https://learn.microsoft.com/azure/documentdb/)
- [Azure OpenAI Service Documentation](https://learn.microsoft.com/azure/cognitive-services/openai/)
- [Vector Search in Azure DocumentDB](https://learn.microsoft.com/azure/cosmos-db/vector-database)
- [MongoDB Java Driver Documentation](https://mongodb.github.io/mongo-java-driver/)
- [Azure SDK for Java Documentation](https://learn.microsoft.com/java/api/overview/azure/)

## Support

If you encounter issues:
1. Check the troubleshooting section above
2. Review Azure resource configurations
3. Verify environment variable settings
4. Check Azure service status and quotas

## License

This project is licensed under the MIT License - see the [LICENSE](../LICENSE.md) file for details.

## Contributing

Contributions are welcome! Please see [CONTRIBUTING](../CONTRIBUTING.md) for details.
