# Azure DocumentDB Vector Search - Go Agent Sample

This sample demonstrates building an intelligent AI agent using Go with Azure DocumentDB vector search capabilities. The agent provides hotel recommendations based on user queries by leveraging a two-agent architecture: a planner agent for query refinement and vector search, and a synthesizer agent for comparative analysis of results.

> **⚠️ Important Note on agentic architecture**  
> This sample is a reference implementation demonstrating agentic patterns in Go. It uses a custom-built agent architecture rather than an agent framework, which is the recommended approach for production agentic applications.

## Architecture

The sample implements a two-agent architecture for hotel recommendations:

- **Planner Agent** (`gpt-4o-mini`): Refines queries and executes vector search using a custom tool
- **Synthesizer Agent** (`gpt-4o`): Analyzes search results and provides comparative recommendations

The application uses:
- **Embeddings**: `text-embedding-3-small` (1536 dimensions)
- **Vector Database**: Azure DocumentDB
- **Vector Algorithms**: Supports IVF, HNSW, and DiskANN

### Architecture Flow

```mermaid
flowchart TD
    A[User Query] --> B[Planner Agent]
    B --> C{Refines query &<br/>calls tool}
    C --> D[Vector Search Tool]
    D --> E[Generates embedding]
    E --> F[Searches Azure DocumentDB]
    F --> G[Returns top K hotels]
    G --> H[Synthesizer Agent]
    H --> I[Analyzes & compares results]
    I --> J[Final Recommendation]
    
    style B fill:#e1f5ff
    style D fill:#fff4e1
    style H fill:#e1f5ff
    style F fill:#f0f0f0
```

**Implementation Notes:**
- This is a custom implementation using OpenAI SDK directly with no framework
- Uses OpenAI function calling for tool integration
- Linear workflow: Planner → Tool → Synthesizer
- Stateless execution with no conversation history
- Suitable for single-turn query/response scenarios

## Prerequisites

### Azure Resources

1. **Azure OpenAI Service** with deployed models:
   - `text-embedding-3-small` deployment (Embeddings)
   - `gpt-4o-mini` deployment (Planner Agent)
   - `gpt-4o` deployment (Synthesizer Agent)

2. **Azure DocumentDB** cluster with:
   - Vector search support enabled
   - Appropriate cluster tier (M10+ for IVF, M30+ for HNSW/DiskANN)
   - Firewall rules configured to allow your IP. For more information, see [Grant access from your IP address](https://learn.microsoft.com/azure/cosmos-db/how-to-configure-firewall#grant-access-from-your-ip-address).

### Development Tools

- [Go](https://golang.org/dl/) 1.22 or later

## Project Structure

```
mongo-vcore-agent-go/
├── cmd/
│   ├── agent/          # Main agent application
│   ├── upload/         # Data upload utility
│   └── cleanup/        # Database cleanup utility
├── internal/
│   ├── models/         # Hotel data models
│   ├── clients/        # Azure OpenAI client
│   ├── vectorstore/    # Azure DocumentDB vector store operations
│   ├── agents/         # Agent and tool implementations
│   │   ├── agents.go   # Planner and synthesizer agents
│   │   └── tools.go    # Vector search tool definition
│   └── prompts/        # System prompts and tool definitions
├── go.mod
├── go.sum
└── README.md
```

## Installation

1. Clone the repository:

```bash
git clone https://github.com/Azure-Samples/cosmos-db-vector-samples.git
cd cosmos-db-vector-samples/mongo-vcore-agent-go
```

2. Install dependencies:

```bash
go mod download
```

3. Configure authentication by creating a `.env` file.

The sample uses a two-agent architecture (planner + synthesizer) with three model deployments (two chat models + embeddings). The environment variables are configured for each model deployment. 

- `AZURE_OPENAI_PLANNER_DEPLOYMENT`: Your gpt-4o-mini deployment name
- `AZURE_OPENAI_SYNTH_DEPLOYMENT`: Your gpt-4o deployment name
- `AZURE_OPENAI_EMBEDDING_DEPLOYMENT`: Your text-embedding-3-small deployment name

You can choose between two authentication methods: passwordless authentication using Azure Identity (recommended) or traditional connection string and API key.

### Option 1: Passwordless authentication (Recommended)

Use Azure Identity for passwordless authentication with both Azure OpenAI and Azure DocumentDB. Set `USE_PASSWORDLESS=true` or omit `AZURE_OPENAI_API_KEY` and `AZURE_DOCUMENTDB_CONNECTION_STRING`, and provide `AZURE_OPENAI_API_INSTANCE_NAME` and `MONGO_CLUSTER_NAME` instead.

```.env
# Enable passwordless authentication
USE_PASSWORDLESS=true

# Azure OpenAI Configuration (passwordless)
AZURE_OPENAI_API_INSTANCE_NAME=your-openai-instance-name

# Azure DocumentDB (passwordless)
MONGO_CLUSTER_NAME=your-mongo-cluster-name
MONGO_DB_NAME=vectorSearchDB
MONGO_DB_COLLECTION=vectorSearchCollection
MONGO_DB_INDEX_NAME=vectorSearchIndex

# Optional settings
DEBUG=true
QUERY=quintessential lodging near running trails, eateries, retail
NEAREST_NEIGHBORS=5
```

**Prerequisites for passwordless authentication:**
- Ensure you're logged in to Azure: `az login`
- OR have appropriate managed identity/service principal/workload identity configured
- Grant your identity the following roles:
  - `Cognitive Services OpenAI User` on the Azure OpenAI resource
  - `DocumentDB Account Contributor` and `Cosmos DB Account Reader Role` on the Azure DocumentDB resource

### Option 2: Connection String and API Key Authentication

Use key-based authentication by setting `USE_PASSWORDLESS=false` and providing `AZURE_OPENAI_API_KEY` and `AZURE_DOCUMENTDB_CONNECTION_STRING` in your `.env` file.

```.env
# Disable passwordless authentication
USE_PASSWORDLESS=false

# Azure OpenAI Configuration (API key)
AZURE_OPENAI_API_INSTANCE_NAME=your-openai-instance-name
AZURE_OPENAI_API_KEY=your-azure-openai-api-key

# Azure DocumentDB (connection string)
AZURE_DOCUMENTDB_CONNECTION_STRING=mongodb+srv://username:password@cluster.mongocluster.cosmos.azure.com/
MONGO_DB_NAME=vectorSearchDB
MONGO_DB_COLLECTION=vectorSearchCollection
MONGO_DB_INDEX_NAME=vectorSearchIndex
```

## Usage

### 1. Upload Hotel Data

Copy the hotel data file `HotelsData_toCosmosDB.JSON` from the `data/` directory in the parent repository to the `data/` directory in this repository.

```
mongo-vcore-agent-go/
├── data
│   ├── HotelsData_toCosmosDB.JSON          # Hotel data file
```

Upload the hotel data with embeddings:

```bash
go run cmd/upload/main.go
```

The upload command will:
- Load hotels from the JSON file
- Generate embeddings for each hotel
- Insert documents into Azure DocumentDB
- Create a vector index

### 2. Run the Agent

Run the hotel recommendation agent:

```bash
go run cmd/agent/main.go
```

The agent will:
- Connect to the existing vector store
- Execute the planner agent (query refinement + vector search)
- Execute the synthesizer agent (comparative analysis)
- Display the final recommendation

Example output:

```
Query: quintessential lodging near running trails, eateries, retail
Nearest Neighbors: 5

--- PLANNER ---
Tool: search_hotels_collection
Query: quintessential lodging near running trails, eateries, and retail shops with good amenities and comfort
K: 5
Hotel #1: Country Comfort Inn, Score: 0.513081
Hotel #2: Nordick's Valley Motel, Score: 0.494860
Hotel #3: Trails End Motel, Score: 0.492937
Hotel #4: Lakefront Captain Inn, Score: 0.478377
Hotel #5: White Mountain Lodge & Suites, Score: 0.477240

--- SYNTHESIZER ---
Context size: 3233 characters

--- FINAL ANSWER ---
1. COMPARISON SUMMARY:
• Country Comfort Inn has the lowest rating (2.5) but offers free parking, free wifi, and pet-friendly extended-stay suites. It is located in Bellevue, WA near a lake.
• Nordick's Valley Motel has the highest rating (4.5) and offers free parking and continental breakfast. It is a boutique hotel near hiking and wine tasting in Washington D.C.
• Trails End Motel has a mid-range rating (3.2) and offers free wifi, free parking, and a hot breakfast buffet. It is a budget hotel located 8 miles from Downtown Scottsdale, AZ.

Key tradeoffs:
- Nordick's Valley Motel excels in rating but lacks free wifi and is not near running trails.
- Country Comfort Inn is pet-friendly and offers functional kitchens but has the lowest rating.
- Trails End Motel balances amenities (wifi, breakfast, parking) with a moderate rating but is farther from natural trails.

2. BEST OVERALL:
Trails End Motel is the best overall for its balanced rating, free wifi, free parking, and proximity to Downtown Scottsdale.

3. ALTERNATIVE PICKS:
• Choose Nordick's Valley Motel if high rating and boutique charm near hiking or wine tasting are priorities.
• Choose Country Comfort Inn if pet-friendly extended stays near a lake are essential.
```

### 3. Cleanup

To delete the test database:

```bash
go run cmd/cleanup/main.go
```

## Key Implementation Details

### No Framework

This implementation demonstrates how to build an agent system without using a framework:

- **Direct Azure OpenAI SDK usage**: Uses the official `github.com/openai/openai-go/v3` package with Azure support
- **Passwordless authentication**: Leverages `github.com/Azure/azure-sdk-for-go/sdk/azidentity` for secure, keyless authentication
- **Custom tool calling**: Implements tool definitions and execution manually
- **Manual agent orchestration**: Explicit control flow between planner and synthesizer
- **MongoDB native driver**: Uses `go.mongodb.org/mongo-driver` directly with OIDC authentication support

### Two-Agent Pattern

**Planner Agent**:
- Uses OpenAI function calling to invoke the vector search tool
- Refines user queries for better semantic search
- Returns structured hotel data with similarity scores

**Synthesizer Agent**:
- Analyzes top 3 results comparatively
- Generates natural language recommendations
- Explains tradeoffs between options

### Vector Search Tool

The search tool:
1. Generates embeddings using `text-embedding-3-small`
2. Executes MongoDB vector search with cosine similarity
3. Formats results for the synthesizer agent

## Configuration Options

### Authentication Methods

The application supports two authentication methods for both Azure OpenAI and Azure DocumentDB:

1. **Passwordless Authentication (Recommended)**:
   - Set `USE_PASSWORDLESS=true` in your `.env` file
   - Uses Azure Identity (`DefaultAzureCredential`) for authentication
   - For **Azure OpenAI**: Omit `AZURE_OPENAI_API_KEY` and provide only `AZURE_OPENAI_API_INSTANCE_NAME`
   - For **Azure DocumentDB**: Omit `AZURE_DOCUMENTDB_CONNECTION_STRING` and provide `MONGO_CLUSTER_NAME` instead
   - Supports multiple credential types: Azure CLI, Managed Identity, Service Principal, Workload Identity
   - More secure as no secrets are stored in code or config files
   - Requires appropriate RBAC roles assigned to your identity
   
2. **API Key / Connection String Authentication**:
   - Set `USE_PASSWORDLESS=false` in your `.env` file (or omit the variable)
   - For **Azure OpenAI**: Provide `AZURE_OPENAI_API_KEY`
   - For **Azure DocumentDB**: Provide `AZURE_DOCUMENTDB_CONNECTION_STRING`
   - Simpler setup but requires managing secrets

**Auto-detection**: If `USE_PASSWORDLESS` is not explicitly set, the application automatically detects which authentication method to use:
- Uses passwordless for OpenAI if `AZURE_OPENAI_API_KEY` is not set
- Uses passwordless for Azure DocumentDB if `AZURE_DOCUMENTDB_CONNECTION_STRING` is not set but `MONGO_CLUSTER_NAME` is set

### Vector Index Algorithms

- **IVF** (default): `VECTOR_INDEX_ALGORITHM=vector-ivf`
- **HNSW**: `VECTOR_INDEX_ALGORITHM=vector-hnsw`
- **DiskANN**: `VECTOR_INDEX_ALGORITHM=vector-diskann`

### Similarity Metrics

- **Cosine** (default): `VECTOR_SIMILARITY=COS`
- **Euclidean**: `VECTOR_SIMILARITY=L2`
- **Inner Product**: `VECTOR_SIMILARITY=IP`

### Debug Mode

Enable detailed logging:

```bash
DEBUG=true
```

## Troubleshooting

### Connection Errors

If you get connection timeouts:
- Verify your IP is in the Azure DocumentDB firewall rules
- Check your connection string is correct
- Ensure the cluster is running

### Rate Limiting

If you encounter 429 errors:
- Increase TPM quotas in Azure portal
- Reduce the number of hotels processed
- Add retry logic with exponential backoff

### Tool Not Called

If the planner doesn't call the search tool:
- Verify the tool definition matches the prompt
- Check the planner system prompt is explicit
- Enable DEBUG mode to see LLM responses

## Related Documentation

- [Azure OpenAI Go SDK](https://pkg.go.dev/github.com/Azure/azure-sdk-for-go/sdk/ai/azopenai)
- [MongoDB Go Driver](https://pkg.go.dev/go.mongodb.org/mongo-driver/mongo)
- [Azure Identity for Go](https://pkg.go.dev/github.com/Azure/azure-sdk-for-go/sdk/azidentity)
- [Azure DocumentDB](https://learn.microsoft.com/azure/documentdb/)

