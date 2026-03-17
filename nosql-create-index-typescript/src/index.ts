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
import { pathToFileURL } from "node:url";
import { createArmClient, createContainer, createRbacAccess } from "./control-plane.js";
import {
  loadConfigFromEnv,
  validateRequiredEnvironmentVariables,
} from "./config.js";
import {
  createCosmosClient,
  createOpenAIClient,
  verifyEmbeddingDimensions,
  insertDocuments,
  vectorQuery,
} from "./data-plane.js";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export async function main() {
  console.log("=".repeat(70));
  console.log(
    "Azure Cosmos DB — Create Container with Vector Index via ARM SDK"
  );
  console.log("=".repeat(70));

  const config = loadConfigFromEnv();
  validateRequiredEnvironmentVariables(config);

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

const isDirectExecution = process.argv[1]
  ? pathToFileURL(process.argv[1]).href === import.meta.url
  : false;

if (isDirectExecution) {
  main().catch((err: Error) => {
    console.error("\nError:", err.message);
    process.exit(1);
  });
}
