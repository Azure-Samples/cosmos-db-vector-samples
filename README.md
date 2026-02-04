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

### MongoDB vCore API Samples

- **[mongo-vcore-vector-search-typescript](./mongo-vcore-vector-search-typescript/)** - TypeScript samples for MongoDB vCore
- **[mongo-vcore-vector-search-python](./mongo-vcore-vector-search-python/)** - Python samples for MongoDB vCore
- **[mongo-vcore-vector-search-dotnet](./mongo-vcore-vector-search-dotnet/)** - .NET samples for MongoDB vCore
- **[mongo-vcore-vector-search-go](./mongo-vcore-vector-search-go/)** - Go samples for MongoDB vCore

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
- **Azure Cosmos DB Account** - NoSQL or MongoDB vCore API
- **Azure OpenAI Service** - With embedding model deployed
- **Development Environment** - Node.js, Python, .NET, or Go depending on sample

## 🎯 Getting Started

1. **Choose a sample** from the repository structure above
2. **Navigate to the sample directory** and follow its README
3. **Configure environment variables** with your Azure resource information
4. **Run the sample** to see vector search in action

### Quick Example (TypeScript + NoSQL API)

```bash
# Clone the repository
git clone https://github.com/Azure-Samples/cosmos-db-vector-samples.git
cd cosmos-db-vector-samples/nosql-vector-search-typescript

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env
# Edit .env with your Azure resource information

# Build and run
npm run build
npm run start:diskann
```

## 📖 Key Concepts

### Vector Embeddings
Vector embeddings are numerical representations of text, images, or other data in high-dimensional space. Similar items have similar vector representations, enabling semantic search.

### Vector Search Algorithms

| Algorithm      | Accuracy | Speed    | Scale   | Best For                        |
|---------------|----------|----------|---------|----------------------------------|
| **Flat**      | 100%     | Slow     | Small   | Dev/test, maximum accuracy      |
| **QuantizedFlat** | ~100% | Fast     | Large   | Balanced performance            |
| **DiskANN**   | High     | Very Fast| Massive | Enterprise scale, RAG, AI apps  |

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

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔒 Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft 
trademarks or logos is subject to and must follow 
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.