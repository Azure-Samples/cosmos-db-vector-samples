/**
 * Control-plane operations using @azure/arm-cosmosdb (ARM SDK).
 *
 *   1. Create container with vector index
 *   2. Create data-plane RBAC role definition and assignment
 */

import { CosmosDBManagementClient } from "@azure/arm-cosmosdb";
import type { TokenCredential } from "@azure/identity";

// Deterministic GUIDs for idempotent role definition / assignment
const ROLE_DEFINITION_GUID = "e4e1a8b7-0a7e-4c6c-8f1d-000000000001";
const ROLE_ASSIGNMENT_GUID = "e4e1a8b7-0a7e-4c6c-8f1d-000000000002";

/** Build the full ARM resource ID for the Cosmos DB account. */
function accountResourceId(config) {
  return (
    `/subscriptions/${config.azure.subscriptionId}` +
    `/resourceGroups/${config.azure.resourceGroup}` +
    `/providers/Microsoft.DocumentDB/databaseAccounts/${config.cosmos.accountName}`
  );
}

/** Create an ARM management client for Cosmos DB. */
export function createArmClient(credential: TokenCredential, subscriptionId: string) {
  return new CosmosDBManagementClient(credential, subscriptionId);
}

// ---------------------------------------------------------------------------
// Step 1 — Create container with vector index
// ---------------------------------------------------------------------------
export async function createContainer(armClient: CosmosDBManagementClient, config) {
  console.log("\n=== Step 1: Create Container with Vector Index ===");
  console.log(`  Container:         ${config.cosmos.containerName}`);
  console.log(`  Index type:        ${config.vectorIndexType}`);
  console.log(`  Dimensions:        ${config.expectedDimensions}`);
  console.log(`  Distance function: cosine`);

  const embeddingPath = `/${config.embeddingField}`;

  const start = Date.now();
  await armClient.sqlResources.beginCreateUpdateSqlContainerAndWait(
    config.azure.resourceGroup,
    config.cosmos.accountName,
    config.cosmos.databaseName,
    config.cosmos.containerName,
    {
      resource: {
        id: config.cosmos.containerName,
        partitionKey: {
          paths: ["/HotelId"],
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
              type: config.vectorIndexType,
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
    `  Vector index is IMMUTABLE — cannot be changed after creation`
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Create data-plane RBAC role definition + assignment
// ---------------------------------------------------------------------------
export async function createRbacAccess(armClient: CosmosDBManagementClient, config) {
  console.log("\n=== Step 2: Create Data-Plane RBAC Access ===");

  const accountId = accountResourceId(config);

  // ---- Role definition ----
  console.log("  Creating role definition...");
  await armClient.sqlResources.beginCreateUpdateSqlRoleDefinitionAndWait(
    ROLE_DEFINITION_GUID,
    config.azure.resourceGroup,
    config.cosmos.accountName,
    {
      roleName: "Write to Azure Cosmos DB for NoSQL data plane",
      type: "CustomRole",
      assignableScopes: [accountId],
      permissions: [
        {
          dataActions: [
            "Microsoft.DocumentDB/databaseAccounts/readMetadata",
            "Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/items/*",
            "Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/*",
          ],
        },
      ],
    }
  );
  console.log("  Role definition created");

  // ---- Role assignment for current user ----
  if (!config.azure.userPrincipalId) {
    console.log(
      "  AZURE_USER_PRINCIPAL_ID not set — skipping role assignment"
    );
    return;
  }

  console.log("  Assigning role to current user...");
  const roleDefinitionId = `${accountId}/sqlRoleDefinitions/${ROLE_DEFINITION_GUID}`;

  await armClient.sqlResources.beginCreateUpdateSqlRoleAssignmentAndWait(
    ROLE_ASSIGNMENT_GUID,
    config.azure.resourceGroup,
    config.cosmos.accountName,
    {
      roleDefinitionId,
      scope: accountId,
      principalId: config.azure.userPrincipalId,
    }
  );
  console.log(`  Role assigned to principal: ${config.azure.userPrincipalId}`);
}


