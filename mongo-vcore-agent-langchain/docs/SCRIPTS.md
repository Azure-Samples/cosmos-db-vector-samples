# Verification Scripts

The `./scripts` folder contains standalone scripts to verify passwordless (Azure AD) authentication to Azure services after running `azd provision` or `azd up`.

## Purpose

These scripts help you validate that your Azure environment is correctly configured for passwordless authentication using managed identities or DefaultAzureCredential. They test connectivity to:

- **Azure OpenAI** - Embedding and chat completion models
- **Azure Cosmos DB for MongoDB vCore** - Database connection with OIDC authentication

## Quick Start

**Run all verification tests with a single command:**

```bash
npm run auth
```

This comprehensive test suite runs all four verification scripts below and provides a summary report. Use this as your first step to validate your Azure environment.

## Prerequisites

1. **Run infrastructure deployment:**
   ```bash
   azd provision
   # or
   azd up
   ```

2. **Environment file:** Scripts require the `.env` file in the workspace root (created by `azd` post-provision hooks)

3. **Authentication:** You must be logged into Azure CLI or have a managed identity configured:
   ```bash
   az login
   ```

## Scripts

### `test-auth.ts` (Recommended)
Comprehensive authentication test suite that runs all verification scripts below.

**Validates:**
- All four Azure service connections in sequence
- Displays detailed configuration information
- Provides pass/fail summary report

**Run:**
```bash
npm run auth
```

**What it tests:**
1. Azure OpenAI Embeddings API
2. Azure OpenAI Chat (Planner model)
3. Azure OpenAI Chat (Synthesizer model)
4. Azure Cosmos DB MongoDB connection

---

### Individual Verification Scripts

You can also run each test individually if you need to troubleshoot a specific service:

### `embed.ts`
Tests Azure OpenAI Embeddings API with passwordless authentication.

**Validates:**
- DefaultAzureCredential token acquisition
- Azure OpenAI instance connectivity
- Embedding model deployment accessibility
- Vector generation from sample text

**Run:**
```bash
npm run embed
```

### `llm-planner.ts`
Tests Azure OpenAI Chat Completion API (Planner model) with passwordless authentication.

**Validates:**
- Planner model deployment (gpt-4o-mini)
- Chat completion API functionality
- Token provider configuration

**Run:**
```bash
npm run planner
```

### `llm-synth.ts`
Tests Azure OpenAI Chat Completion API (Synthesizer model) with passwordless authentication.

**Validates:**
- Synthesizer model deployment (gpt-4o)
- Chat completion API functionality
- Response generation

**Run:**
```bash
npm run synth
```

### `mongo.ts`
Tests MongoDB connection to Azure Cosmos DB with OIDC (passwordless) authentication.

**Validates:**
- DefaultAzureCredential token acquisition for Document DB scope
- MongoDB OIDC authentication mechanism
- Database and collection listing
- Connection stability

**Run:**
```bash
npm run mongo
```

## Expected Output

Each script will:
- ✅ Connect to the Azure service using DefaultAzureCredential
- ✅ Display configuration details (instance names, deployments, database info)
- ✅ Execute a test operation (embed text, generate response, list databases)
- ✅ Exit cleanly

## Troubleshooting

### "Resource not found" errors
- Verify `azd provision` completed successfully
- Check that `.env` file exists in the root directory
- Confirm environment variables are set correctly

### "Authentication failed" errors
- Ensure you're logged in: `az login`
- Verify your user account has appropriate role assignments:
  - **Cognitive Services OpenAI User** (for Azure OpenAI)
  - **DocumentDB Account Contributor** or custom role with `Microsoft.DocumentDB/mongoClusters/users/read` (for Cosmos DB)

### "DefaultAzureCredential failed" errors
- Check that `AZURE_TENANT_ID` is set in `.env`
- Verify Azure CLI is installed and logged in
- Try refreshing credentials: `az account get-access-token`

## Environment Variables Required

These scripts expect the following variables in `../.env`:

```bash
# Debug (optional)
DEBUG="false"  # Set to "true" for verbose logging in embed.ts

# Azure OpenAI
AZURE_OPENAI_API_INSTANCE_NAME="your-openai-instance"
AZURE_OPENAI_EMBEDDING_MODEL="text-embedding-3-small"
AZURE_OPENAI_EMBEDDING_API_VERSION="2023-05-15"
AZURE_OPENAI_PLANNER_DEPLOYMENT="gpt-4o-mini"
AZURE_OPENAI_PLANNER_API_VERSION="2024-08-01-preview"
AZURE_OPENAI_SYNTH_DEPLOYMENT="gpt-4o"
AZURE_OPENAI_SYNTH_API_VERSION="2024-08-01-preview"

# Azure Cosmos DB for MongoDB vCore
MONGO_CLUSTER_NAME="your-mongo-cluster"

# Azure Identity (automatically set by DefaultAzureCredential when using az login)
AZURE_TENANT_ID="your-tenant-id"
```

**Note:** `MONGO_DB_NAME` and `MONGO_DB_COLLECTION` are not required by these verification scripts but are needed for the main agent application.

## Next Steps

After running `npm run auth` successfully (all tests pass):

1. Upload hotel data: `npm run upload`
2. Run the full agent application: `npm run start`
3. Test vector search queries with the two-agent pipeline

**If tests fail:** Run individual scripts (`npm run embed`, `npm run planner`, etc.) to isolate the issue.
