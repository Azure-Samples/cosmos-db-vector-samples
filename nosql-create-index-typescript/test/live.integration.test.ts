import { CosmosDBManagementClient } from "@azure/arm-cosmosdb";
import type { Container } from "@azure/cosmos";
import { DefaultAzureCredential } from "@azure/identity";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createArmClient,
  createContainer,
  createRbacAccess,
  ROLE_ASSIGNMENT_GUID,
  ROLE_DEFINITION_GUID,
} from "../src/control-plane.js";
import {
  loadConfigFromEnv,
  validateRequiredEnvironmentVariables,
  type SampleConfig,
} from "../src/config.js";
import {
  createCosmosClient,
  createOpenAIClient,
  insertDocuments,
  vectorQuery,
  verifyEmbeddingDimensions,
} from "../src/data-plane.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const sampleRoot = resolve(__dirname, "..");

async function loadEnvFile(envPath: string) {
  const envText = await readFile(envPath, "utf8");

  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function delay(ms: number) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

describe("nosql-create-index-typescript live integration tests", () => {
  let config: SampleConfig;
  let credential: DefaultAzureCredential;
  let armClient: CosmosDBManagementClient;
  let openAiClient: ReturnType<typeof createOpenAIClient>;
  let container: Container;
  let createdContainer = false;

  beforeAll(async () => {
    await loadEnvFile(resolve(sampleRoot, ".env"));

    const baseConfig = loadConfigFromEnv();
    validateRequiredEnvironmentVariables(baseConfig);

    if (!baseConfig.azure.userPrincipalId) {
      throw new Error(
        "AZURE_USER_PRINCIPAL_ID is required for the live RBAC integration test."
      );
    }

    const suffix = `${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    config = {
      ...baseConfig,
      cosmos: {
        ...baseConfig.cosmos,
        containerName: `${baseConfig.cosmos.containerName}-vitest-${suffix}`,
      },
    };

    credential = new DefaultAzureCredential();
    armClient = createArmClient(credential, config.azure.subscriptionId!);

    const cosmosClient = createCosmosClient(
      credential,
      config.cosmos.endpoint!
    );
    openAiClient = createOpenAIClient(credential, config);
    container = cosmosClient
      .database(config.cosmos.databaseName)
      .container(config.cosmos.containerName);
  });

  afterAll(async () => {
    if (!createdContainer) {
      return;
    }

    await armClient.sqlResources.beginDeleteSqlContainerAndWait(
      config.azure.resourceGroup!,
      config.cosmos.accountName!,
      config.cosmos.databaseName,
      config.cosmos.containerName
    );
  });

  it("loads config from env vars", () => {
    expect(config.azure.subscriptionId).toBe(process.env.AZURE_SUBSCRIPTION_ID);
    expect(config.azure.resourceGroup).toBe(process.env.AZURE_RESOURCE_GROUP);
    expect(config.cosmos.accountName).toBe(
      process.env.AZURE_COSMOSDB_ACCOUNT_NAME
    );
    expect(config.cosmos.endpoint).toBe(process.env.AZURE_COSMOSDB_ENDPOINT);
    expect(config.openai.endpoint).toBe(process.env.AZURE_OPENAI_ENDPOINT);
    expect(config.expectedDimensions).toBe(
      Number(process.env.EMBEDDING_DIMENSIONS || 1536)
    );
  });

  it("creates an ARM client", () => {
    expect(armClient).toBeInstanceOf(CosmosDBManagementClient);
  });

  it("creates a container with a vector index (live)", async () => {
    await createContainer(armClient, config);
    createdContainer = true;

    const response = await armClient.sqlResources.getSqlContainer(
      config.azure.resourceGroup!,
      config.cosmos.accountName!,
      config.cosmos.databaseName,
      config.cosmos.containerName
    );

    expect(response.resource?.id).toBe(config.cosmos.containerName);
    expect(
      response.resource?.indexingPolicy?.vectorIndexes?.[0]?.path
    ).toBe(`/${config.embeddingField}`);
    expect(
      response.resource?.indexingPolicy?.vectorIndexes?.[0]?.type
    ).toBe(config.vectorIndexType);
    expect(
      response.resource?.vectorEmbeddingPolicy?.vectorEmbeddings?.[0]?.dimensions
    ).toBe(config.expectedDimensions);
  });

  it("creates RBAC role definition and assignment (live)", async () => {
    await createRbacAccess(armClient, config);

    const roleDefinition = await armClient.sqlResources.getSqlRoleDefinition(
      ROLE_DEFINITION_GUID,
      config.azure.resourceGroup!,
      config.cosmos.accountName!
    );
    const roleAssignment = await armClient.sqlResources.getSqlRoleAssignment(
      ROLE_ASSIGNMENT_GUID,
      config.azure.resourceGroup!,
      config.cosmos.accountName!
    );

    expect(roleDefinition.roleName).toBe(
      "Write to Azure Cosmos DB for NoSQL data plane"
    );
    expect(roleAssignment.principalId).toBe(config.azure.userPrincipalId);

    await delay(15_000);
  });

  it("verifies embedding dimensions (live, hits OpenAI)", async () => {
    const actualDimensions = await verifyEmbeddingDimensions(openAiClient, config);

    expect(actualDimensions).toBe(config.expectedDimensions);
  });

  it("inserts documents (live, hits Cosmos DB)", async () => {
    const result = await insertDocuments(container, config);
    const { resources: countResult } = await container.items
      .query("SELECT VALUE COUNT(1) FROM c")
      .fetchAll();

    expect(result.total).toBeGreaterThan(0);
    expect(result.inserted).toBe(result.total);
    expect(result.failed).toBe(0);
    expect(countResult[0]).toBe(result.total);
  });

  it("runs a vector similarity query (live, hits OpenAI and Cosmos DB)", async () => {
    const result = await vectorQuery(container, openAiClient, config);

    expect(result.success).toBe(true);
    expect(result.latency).toBeGreaterThan(0);
    expect(result.requestCharge).toBeGreaterThan(0);
  });
});
