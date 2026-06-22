/**
 * Control-plane operations using @azure/arm-cosmosdb (ARM SDK).
 *
 *   1. Create container with vector index
 *   2. Clean up sample-created containers (not azd infra)
 *
 * Note: RBAC role definitions and assignments are created by `azd up` via Bicep templates.
 * This sample assumes the role already exists and uses passwordless (AAD) authentication.
 */

import { CosmosDBManagementClient } from "@azure/arm-cosmosdb";
import type { TokenCredential } from "@azure/identity";
import type { SampleConfig } from "./config.js";

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
  const indexTypes = [
    { type: "diskANN", containerName: "hotels_diskann" },
    { type: "quantizedFlat", containerName: "hotels_quantizedflat" },
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
            excludedPaths: [{ path: "/_etag/?" }],
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
  const containerNames = ["hotels_diskann", "hotels_quantizedflat"];

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
// RBAC Role Definition and Assignment (SQL role, not database-level)
// ---------------------------------------------------------------------------

// Static GUIDs for SQL role definition and assignment
// These are predictable identifiers used for both creation and verification
export const ROLE_DEFINITION_GUID = "3d3f2f24-7d5e-11ed-a1eb-0242ac120002";
export const ROLE_ASSIGNMENT_GUID = "4d4f3f25-8e6f-12fe-b2fc-1353bd231113";

/**
 * Create SQL role definition and assignment for the user principal.
 * This grants the user permission to read and write documents via Microsoft Entra ID (RBAC).
 *
 * Note: This is separate from container creation. The role is created once and shared
 * across all containers in the account. In production, azd up handles this via Bicep.
 */
export async function createRbacAccess(
  armClient: CosmosDBManagementClient,
  config: SampleConfig
) {
  console.log("\n=== Step 0: Set Up RBAC (SQL Role) ===");

  const resourceGroup = config.azure.resourceGroup!;
  const accountName = config.cosmos.accountName!;
  const principalId = config.azure.userPrincipalId!;

  // Step 1: Create SQL role definition (if it doesn't exist)
  // This role grants permission to read/write documents on the data plane
  console.log("  Creating SQL role definition...");

  try {
    await armClient.sqlResources.beginCreateUpdateSqlRoleDefinitionAndWait(
      resourceGroup,
      accountName,
      ROLE_DEFINITION_GUID,
      {
        roleName: "Write to Azure Cosmos DB for NoSQL data plane",
        type: "CustomRole",
        assignableScopes: [`/subscriptions/${config.azure.subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.DocumentDB/databaseAccounts/${accountName}`],
        permissions: [
          {
            dataActions: ["Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/items/*"],
            notDataActions: [],
          },
        ],
      }
    );
    console.log("  ✓ SQL role definition created");
  } catch (error) {
    // Role may already exist; check if it's the expected error
    const errorMsg = (error as any).message?.toLowerCase() || "";
    if (
      errorMsg.includes("already exists") ||
      errorMsg.includes("conflict") ||
      (error as any).code === 409
    ) {
      console.log("  ✓ SQL role definition already exists");
    } else {
      throw error;
    }
  }

  // Step 2: Create SQL role assignment
  // This assigns the role to the user principal, granting them the permissions defined above
  console.log("  Creating SQL role assignment...");

  try {
    await armClient.sqlResources.beginCreateUpdateSqlRoleAssignmentAndWait(
      resourceGroup,
      accountName,
      ROLE_ASSIGNMENT_GUID,
      {
        roleDefinitionId: `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.DocumentDB/databaseAccounts/${accountName}/sqlRoleDefinitions/${ROLE_DEFINITION_GUID}`,
        principalId: principalId,
        scope: `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.DocumentDB/databaseAccounts/${accountName}`,
      }
    );
    console.log(`  ✓ SQL role assignment created for principal: ${principalId}`);
  } catch (error) {
    const errorMsg = (error as any).message?.toLowerCase() || "";
    if (
      errorMsg.includes("already exists") ||
      errorMsg.includes("conflict") ||
      (error as any).code === 409
    ) {
      console.log("  ✓ SQL role assignment already exists");
    } else {
      throw error;
    }
  }
}
