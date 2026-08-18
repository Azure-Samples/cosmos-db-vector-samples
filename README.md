# Azure Cosmos DB Vector Search Samples

This repository demonstrates how to integrate vector search capabilities into Azure Cosmos DB using various programming languages and APIs.

## Overview

Azure Cosmos DB provides integrated vector search capabilities for AI-powered semantic search, Retrieval-Augmented Generation (RAG), and recommendation systems. This repository contains comprehensive code samples showing how to:

- Generate embeddings with Azure OpenAI
- Store vector embeddings in Cosmos DB
- Query with vector similarity search
- Use different vector indexing algorithms
- Implement managed identity authentication

## 📁 Repository Structure

### NoSQL API Samples

- **[nosql-vector-search-typescript](./nosql-vector-search-typescript/)** - TypeScript samples for Cosmos DB NoSQL API
  - DiskANN, Flat, and QuantizedFlat indexing algorithms
  - Managed identity authentication
  - Comprehensive documentation and examples

## 🚀 Features

This project demonstrates:

✅ **Vector Embedding Generation** - Using Azure OpenAI to generate embeddings  
✅ **Vector Storage** - Storing embeddings directly in JSON documents  
✅ **Similarity Search** - Querying with VectorDistance for nearest neighbors  
✅ **Multiple Algorithms** - DiskANN, Flat, QuantizedFlat indexing  
✅ **Distance Metrics** - Cosine, Euclidean (L2), and DotProduct  
✅ **Managed Identity** - Passwordless authentication with Azure AD  
✅ **Production Ready** - Enterprise-grade patterns with retry logic  

## 📋 Prerequisites

- **Azure Subscription** - [Create a free account](https://azure.microsoft.com/free/)
- **Azure Cosmos DB Account** - NoSQL API
- **Azure OpenAI Service** - With embedding model deployed
- **Development Environment** - Node.js, Python, .NET, or Go depending on sample

## 🎯 Getting Started

### Deployment Scenarios

This repository supports **two distinct deployment scenarios** based on what you want to demonstrate:

| Scenario | Database | Env Variable | Use Case |
|----------|----------|---|----------|
| **Vector Search** | Standard Cosmos DB NoSQL with vector search | Not set (default) | Query existing vectors with similarity search |
| **Create Index** | Cosmos DB NoSQL with custom vector indexing | `AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME='HotelsCreateIndex'` | Demonstrate building and configuring vector indexes |

### How to Set Environment Variables

> [!IMPORTANT]
> Set `AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME` before `azd up`, preferably
> with `azd env set`. Bicep creates the configured create-index database. The
> language samples create and delete only `hotels_diskann` and
> `hotels_quantizedflat`.

#### Vector Search Scenario (Default - No Env Variable Needed)
```powershell
# PowerShell - Just run without env variable
azd up
```

```bash
# Bash - Just run without env variable
azd up
```

#### Create Index Scenario (Requires Env Variable)

You have two options to set the environment variable:

**Option 1: Session Environment Variable (Quickest)**

**Windows (PowerShell):**
```powershell
# Set for current session (variable persists until you close PowerShell)
$env:AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME='HotelsCreateIndex'

# Verify it's set
$env:AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME

# Provision the create-index database and shared resources
azd up
```

**Bash/Linux/macOS/WSL:**
```bash
# Set for current session (variable persists in this terminal)
export AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME='HotelsCreateIndex'

# Verify it's set
echo $AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME

# Provision the create-index database and shared resources
azd up
```

**Option 2: AZD Environment (Recommended for Repeated Deployments)**

Store the variable in your azd environment so it persists across sessions:

```powershell
# PowerShell
azd env set AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME "HotelsCreateIndex"

# Verify it's set
azd env get-values | findstr /i "CREATE_INDEX"

# Now you can run deployments in new PowerShell sessions
azd up
```

```bash
# Bash
azd env set AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME "HotelsCreateIndex"

# Verify it's set
azd env get-values | grep CREATE_INDEX

# Now you can run deployments in new terminal sessions
azd up
```

**Option 3: Permanent System Environment (Persists Across All Sessions)**

**Windows (PowerShell):**
```powershell
[Environment]::SetEnvironmentVariable('AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME', 'HotelsCreateIndex', 'User')
# Restart PowerShell to see the permanent setting
azd up
```

**Bash/Linux/macOS:**
```bash
# Add to your shell configuration (~/.bashrc, ~/.zshrc, etc.)
echo "export AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME='HotelsCreateIndex'" >> ~/.bashrc
source ~/.bashrc
azd up
```

### Quick Example (TypeScript + Vector Search)

```bash
# Clone the repository
git clone https://github.com/Azure-Samples/cosmos-db-vector-samples.git

# Provision Azure resources with Azure Developer CLI (default: vector-search scenario)
azd auth login
azd up

# Work with TypeScript sample
cd cosmos-db-vector-samples/nosql-vector-search-typescript

# Install dependencies
npm install

# Set environment variables from provisioned infrastructure
azd env get-values > .env

# Build and run
npm run build
npm run start:diskann
```

**Why the environment variable matters:**
- Bicep uses it to select and name the create-index database.
- The lifecycle hooks use the resulting `azd` environment output to select the
  create-index data files.
- The samples read the same variable for data-plane database access.

## 📖 Key Concepts

### Vector Embeddings
Vector embeddings are numerical representations of text, images, or other data in high-dimensional space. Similar items have similar vector representations, enabling semantic search.

### Vector Search Algorithms

| Algorithm      | Accuracy | Speed    | Scale   | Best For                        |
|---------------|----------|----------|---------|----------------------------------|
| **Flat** | High | Slow | Very small | Testing or isolated-partition searches with up to about 50,000 vectors |
| **QuantizedFlat** | High | Fast | Large | Low-latency workloads with efficient RU consumption at scale |
| **DiskANN** | High | Very fast | Massive | Highly scalable RAG and AI workloads |

### Distance Metrics

- **Cosine Similarity** - Measures angle between vectors (most common for text)
- **Euclidean Distance (L2)** - Straight-line distance in n-dimensional space
- **Dot Product** - Projection of one vector onto another

## 📚 Resources

### Official Documentation

- [Azure Cosmos DB Vector Search Overview](https://learn.microsoft.com/azure/cosmos-db/vector-search)
- [Vector Search for NoSQL API](https://learn.microsoft.com/azure/cosmos-db/nosql/vector-search)
- [DiskANN in Cosmos DB](https://learn.microsoft.com/azure/cosmos-db/gen-ai/sharded-diskann)
- [Azure OpenAI Embeddings](https://learn.microsoft.com/azure/ai-services/openai/how-to/embeddings)

### Getting Started

- [Cosmos DB Introduction](https://learn.microsoft.com/azure/cosmos-db/introduction)
- [Quickstart: Create with Bicep](https://learn.microsoft.com/azure/cosmos-db/quickstart-template-bicep)

## 🤝 Contributing

This project welcomes contributions and suggestions. Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit https://cla.opensource.microsoft.com.

When you submit a pull request, a CLA bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

### NoSQL Quickstart Sample Governance

All Azure Cosmos DB NoSQL quickstarts in this repository are governed by:
- [**Quickstart Base Constitution**](./.github/QUICKSTART-CONSTITUTION.md) — Shared contract applying to all NoSQL quickstarts (authentication, environment variable handling, SQL injection safety, terminology, and SDK pinning).

Additionally, each sample scenario extends the base with scenario-specific requirements:
- [**Vector Search Scenario Constitution**](./.github/docs/VECTOR-SEARCH-CONSTITUTION.md) — Requirements for `nosql-vector-search-*` data-plane quickstarts.
- [**Create Index Scenario Constitution**](./.github/docs/CREATE-INDEX-CONSTITUTION.md) — Requirements for `nosql-create-index-*` control-plane and data-plane quickstarts.

All quickstart samples must conform to the base contract and their scenario constitution.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE.md) file for details.

## 🔒 Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft 
trademarks or logos is subject to and must follow 
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
