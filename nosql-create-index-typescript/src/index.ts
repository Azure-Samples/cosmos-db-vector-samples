/**
 * Azure Cosmos DB — Vector Search Sample
 *
 * Orchestrates control-plane and data-plane operations:
 *
 * Control plane (control-plane.ts — @azure/arm-cosmosdb):
 *   1. Create container with vector index
 *
 * Data plane (data-plane.ts — @azure/cosmos + Azure OpenAI):
 *   2. Verify embedding dimensions
 *   3. Insert documents from pre-vectorized data file (bulk)
 *   4. Run a vector similarity query using VectorDistance()
 *
 * Prerequisites:
 *   - Run `azd up` to create resources and set up RBAC roles
 *   - Or manually populate .env with the required variables
 */

import { DefaultAzureCredential } from "@azure/identity";
import { pathToFileURL } from "node:url";
import { createArmClient, createContainer, cleanupSampleContainers } from "./control-plane.js";
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
  const config = loadConfigFromEnv();
  validateRequiredEnvironmentVariables(config);

  console.log(`Using Azure OpenAI Embedding Deployment/Model: ${config.openai.embeddingDeployment}`);

  const credential = new DefaultAzureCredential();

  // ---- Control plane: ARM SDK ----
  const armClient = createArmClient(credential, config.azure.subscriptionId!);
  await createContainer(armClient, config);

  // ---- Data plane: Cosmos SDK + Azure OpenAI ----
  const cosmosClient = createCosmosClient(credential, config.cosmos.endpoint!);
  const openaiClient = createOpenAIClient(credential, config);

  const database = cosmosClient.database(config.cosmos.databaseName);
  
  // Verify dimensions once
  await verifyEmbeddingDimensions(openaiClient, config);

  // Query both index types with all distance metrics
  const indexTypes = ["diskANN", "quantizedFlat"];
  const allResults: Array<{ container: string; metric: string; top1: string; top1Score: number; top2: string; top2Score: number; diff: number; ru: number }> = [];

  for (const indexType of indexTypes) {
    const containerName = indexType === "diskANN" ? "hotels_diskann_ts" : "hotels_quantizedflat_ts";
    const container = database.container(containerName);

    console.log(`\n${"=".repeat(50)}`);
    console.log(`Index type: ${indexType}`);
    console.log(`Container: ${containerName}`);
    console.log(`${"=".repeat(50)}`);

    await insertDocuments(container, config, config.embeddingField, containerName);
    const results = await vectorQuery(container, containerName, openaiClient, config);
    allResults.push(...results);
  }

  // Print consolidated results table
  console.log(`\n${"=".repeat(80)}`);
  console.log("CONSOLIDATED RESULTS — Vector Query with All Metrics & Index Types");
  console.log(`${"=".repeat(80)}`);
  console.log();
  console.log(`| ${"Container".padEnd(18)} | ${"Metric".padEnd(10)} | ${"Top 1 Result".padEnd(26)} | ${"Score".padEnd(6)} | ${"Top 2 Result".padEnd(26)} | ${"Score".padEnd(6)} | ${"Diff".padEnd(6)} |`);
  console.log(`|${"-".repeat(20)}|${"-".repeat(12)}|${"-".repeat(28)}|${"-".repeat(8)}|${"-".repeat(28)}|${"-".repeat(8)}|${"-".repeat(8)}|`);

  for (const result of allResults) {
    console.log(`| ${result.container.padEnd(18)} | ${result.metric.padEnd(10)} | ${result.top1.padEnd(26)} | ${result.top1Score.toFixed(4)} | ${result.top2.padEnd(26)} | ${result.top2Score.toFixed(4)} | ${result.diff.toFixed(4)} |`);
  }

  console.log();

  // Clean up sample-created containers
  await cleanupSampleContainers(armClient, config);

  console.log("\nComplete");
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

