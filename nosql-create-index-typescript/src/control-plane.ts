/**
 * Control-plane operations using @azure/arm-cosmosdb (ARM SDK).
 *
 *   1. Create containers with vector indexes
 *   2. Clean up sample-created containers
 *
 * RBAC Setup:
 * - Role definitions and assignments are created by `azd up` via Bicep (infra/database.bicep lines 195-226)
 * - Sample code uses DefaultAzureCredential() for authentication
 * - No RBAC creation code is needed in the sample
 */

import { CosmosDBManagementClient } from "@azure/arm-cosmosdb";
import type { TokenCredential } from "@azure/identity";
import type { SampleConfig } from "./config.js";
import { validateContainerDeletionTargets } from "./config.js";

/** Create an ARM management client for Cosmos DB. */
export function createArmClient(
  credential: TokenCredential,
  subscriptionId: string
) {
  return new CosmosDBManagementClient(credential, subscriptionId);
}

// ---------------------------------------------------------------------------
// Delete container (if it exists) to ensure clean state
// ---------------------------------------------------------------------------
async function deleteContainerIfExists(
  armClient: CosmosDBManagementClient,
  config: SampleConfig,
  containerName?: string
) {
  const actualContainerName = containerName || config.cosmos.containerName;
  try {
    console.log(`  Deleting existing container if present...`);
    await armClient.sqlResources.beginDeleteSqlContainerAndWait(
      config.azure.resourceGroup!,
      config.cosmos.accountName!,
      config.cosmos.databaseName,
      actualContainerName
    );
    console.log(`  Deleted existing container`);
  } catch (error) {
    // 404 means container doesn't exist — that's fine
    if ((error as any).code === 404 || (error as any).message?.includes("NotFound")) {
      console.log(`  Container does not exist (OK)`);
    } else {
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// Step 1 — Create container with vector index
// ---------------------------------------------------------------------------
export async function createContainer(
  armClient: CosmosDBManagementClient,
  config: SampleConfig
) {
  validateContainerDeletionTargets(config);
  const indexTypes = [
    { type: "diskANN", containerName: config.cosmos.diskannContainerName },
    { type: "quantizedFlat", containerName: config.cosmos.quantizedflatContainerName },
  ];

  const embeddingPath = `/${config.embeddingField}`;

  for (const indexConfig of indexTypes) {
    console.log("\n=== Step 1: Create Container with Vector Index ===");
    console.log(`  Container:      ${indexConfig.containerName}`);
    console.log(`  Index type:     ${indexConfig.type}`);
    console.log(`  Dimensions:     ${config.expectedDimensions}`);
    console.log(`  Distance func:  cosine (queried with all 3 metrics)`);

    // Delete existing container to ensure clean state (idempotent)
    await deleteContainerIfExists(armClient, config, indexConfig.containerName);

    const start = Date.now();
    await armClient.sqlResources.beginCreateUpdateSqlContainerAndWait(
      config.azure.resourceGroup!,
      config.cosmos.accountName!,
      config.cosmos.databaseName,
      indexConfig.containerName,
      {
        resource: {
          id: indexConfig.containerName,
          partitionKey: {
            paths: ["/Region"],
            kind: "MultiHash",
            version: 2,
          },
          indexingPolicy: {
            indexingMode: "consistent",
            automatic: true,
            includedPaths: [{ path: "/*" }],
            excludedPaths: [{ path: "/_etag/?" }, { path: `${embeddingPath}/*` }],
            vectorIndexes: [
              {
                path: embeddingPath,
                type: indexConfig.type,
              },
            ],
          },
          vectorEmbeddingPolicy: {
            vectorEmbeddings: [
              {
                path: embeddingPath,
                dataType: "float32",
                dimensions: config.expectedDimensions,
                distanceFunction: "cosine",
              },
            ],
          },
        },
        location: config.azure.location,
      }
    );

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`  Created in ${elapsed}s`);
    console.log(
      "  Vector index is IMMUTABLE — cannot be changed after creation"
    );
  }
}

// ---------------------------------------------------------------------------
// Step 6 — Clean up sample-created containers (not azd infra)
// ---------------------------------------------------------------------------
export async function cleanupSampleContainers(
  armClient: CosmosDBManagementClient,
  config: SampleConfig
) {
  validateContainerDeletionTargets(config);
  const containerNames = [
    config.cosmos.diskannContainerName,
    config.cosmos.quantizedflatContainerName,
  ];

  console.log("\n=== Cleanup: Remove Sample Containers ===");
  for (const containerName of containerNames) {
    try {
      await armClient.sqlResources.beginDeleteSqlContainerAndWait(
        config.azure.resourceGroup!,
        config.cosmos.accountName!,
        config.cosmos.databaseName,
        containerName
      );
      console.log(`  ✓ Deleted container: ${containerName}`);
    } catch (error) {
      if ((error as any).code === 404 || (error as any).message?.includes("NotFound")) {
        console.log(`  ✓ Container does not exist: ${containerName}`);
      } else {
        throw error;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Exports for testing
// ---------------------------------------------------------------------------
export { CosmosDBManagementClient } from "@azure/arm-cosmosdb";
