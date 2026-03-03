/**
 * Azure Cosmos DB — Create Container with Vector Index via ARM SDK
 *
 * Orchestrates control-plane and data-plane operations:
 *
 * Control plane (control-plane.ts — @azure/arm-cosmosdb):
 *   1. Create container with vector index
 *   2. Create data-plane RBAC role definition and assignment
 *
 * Data plane (data-plane.ts — @azure/cosmos + Azure OpenAI):
 *   3. Verify embedding dimensions
 *   4. Insert documents from pre-vectorized data file (bulk)
 *   5. Run a vector similarity query using VectorDistance()
 *
 * Prerequisites:
 *   - Run scripts/create-resources.sh to create the resource group,
 *     Azure OpenAI, Cosmos DB account, and database
 *   - Or manually populate .env with the required variables
 */

import { DefaultAzureCredential } from "@azure/identity";
import { createArmClient, createContainer, createRbacAccess } from "./control-plane.js";
import {
  createCosmosClient,
  createOpenAIClient,
  verifyEmbeddingDimensions,
  insertDocuments,
  vectorQuery,
} from "./data-plane.js";

// ---------------------------------------------------------------------------
// Configuration (from scripts/create-resources.sh → .env)
// ---------------------------------------------------------------------------
const config = {
  azure: {
    subscriptionId: process.env.AZURE_SUBSCRIPTION_ID,
    resourceGroup: process.env.AZURE_RESOURCE_GROUP,
    location: process.env.AZURE_LOCATION || "eastus2",
    userPrincipalId: process.env.AZURE_USER_PRINCIPAL_ID,
  },
  cosmos: {
    accountName: process.env.AZURE_COSMOSDB_ACCOUNT_NAME,
    endpoint: process.env.AZURE_COSMOSDB_ENDPOINT,
    databaseName: process.env.AZURE_COSMOSDB_DATABASENAME || "Hotels",
    containerName:
      process.env.AZURE_COSMOSDB_CONTAINER_NAME || "hotels_diskann",
  },
  openai: {
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    embeddingDeployment:
      process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT ||
      "text-embedding-3-small",
    embeddingApiVersion:
      process.env.AZURE_OPENAI_EMBEDDING_API_VERSION || "2024-08-01-preview",
  },
  embeddingField: process.env.EMBEDDED_FIELD || "DescriptionVector",
  expectedDimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || "1536", 10),
  dataFile:
    process.env.DATA_FILE_WITH_VECTORS ||
    "../data/HotelsData_toCosmosDB_Vector.json",
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("=".repeat(70));
  console.log(
    "Azure Cosmos DB — Create Container with Vector Index via ARM SDK"
  );
  console.log("=".repeat(70));

  // Validate required env vars
  const required = [
    ["AZURE_SUBSCRIPTION_ID", config.azure.subscriptionId],
    ["AZURE_RESOURCE_GROUP", config.azure.resourceGroup],
    ["AZURE_COSMOSDB_ACCOUNT_NAME", config.cosmos.accountName],
    ["AZURE_COSMOSDB_ENDPOINT", config.cosmos.endpoint],
    ["AZURE_OPENAI_ENDPOINT", config.openai.endpoint],
  ];
  const missing = required.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    console.error(
      `\nMissing required environment variables: ${missing.join(", ")}`
    );
    console.error(
      "Run scripts/create-resources.sh first, or populate .env manually."
    );
    process.exit(1);
  }

  const credential = new DefaultAzureCredential();

  // ---- Control plane: ARM SDK ----
  const armClient = createArmClient(credential, config.azure.subscriptionId!);
  await createContainer(armClient, config);
  await createRbacAccess(armClient, config);

  // RBAC propagation can take a few seconds
  console.log("\n  Waiting 15 s for RBAC propagation...");
  await new Promise((resolve) => setTimeout(resolve, 15_000));

  // ---- Data plane: Cosmos SDK + Azure OpenAI ----
  const cosmosClient = createCosmosClient(credential, config.cosmos.endpoint!);
  const openaiClient = createOpenAIClient(credential, config);

  const database = cosmosClient.database(config.cosmos.databaseName);
  const container = database.container(config.cosmos.containerName);

  await verifyEmbeddingDimensions(openaiClient, config);
  await insertDocuments(container, config);
  await vectorQuery(container, openaiClient, config);

  console.log("\n" + "=".repeat(70));
  console.log("Complete — container, vector index, and RBAC created");
  console.log("=".repeat(70));
}

main().catch((err) => {
  console.error("\nError:", err.message);
  process.exit(1);
});
