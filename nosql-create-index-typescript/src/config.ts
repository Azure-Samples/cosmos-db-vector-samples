export interface SampleConfig {
  azure: {
    subscriptionId?: string;
    resourceGroup?: string;
    location: string;
  };
  cosmos: {
    accountName?: string;
    endpoint?: string;
    databaseName: string;
    containerName: string;
    diskannContainerName: string;
    quantizedflatContainerName: string;
  };
  openai: {
    endpoint?: string;
    embeddingDeployment: string;
    embeddingApiVersion: string;
  };
  vectorIndexType: string;
  embeddingField: string;
  expectedDimensions: number;
  dataFile: string;
  partitionKeyValue: string;  // Region to query (single-partition efficiency)
  allowDestructiveOperations: boolean;
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim() || undefined;
  }
  return trimmed;
}

export function loadConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): SampleConfig {
  const diskannContainerName =
    clean(env.AZURE_COSMOSDB_CREATE_INDEX_DISKANN_CONTAINER_NAME) ||
    "hotels_diskann";
  const quantizedflatContainerName =
    clean(env.AZURE_COSMOSDB_CREATE_INDEX_QUANTIZEDFLAT_CONTAINER_NAME) ||
    "hotels_quantizedflat";

  return {
    azure: {
      subscriptionId: clean(env.AZURE_SUBSCRIPTION_ID),
      resourceGroup: clean(env.AZURE_RESOURCE_GROUP),
      location: clean(env.AZURE_LOCATION) || "",
    },
    cosmos: {
      accountName: clean(env.AZURE_COSMOSDB_ACCOUNT_NAME),
      endpoint: clean(env.AZURE_COSMOSDB_ENDPOINT),
      databaseName:
        clean(env.AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME) || "",
      containerName:
        clean(env.AZURE_COSMOSDB_CONTAINER_NAME) || diskannContainerName,
      diskannContainerName,
      quantizedflatContainerName,
    },
    openai: {
      endpoint:
        clean(env.AZURE_OPENAI_EMBEDDING_ENDPOINT) ||
        clean(env.AZURE_OPENAI_ENDPOINT),
      embeddingDeployment:
        clean(env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT) || "",
      embeddingApiVersion:
        clean(env.AZURE_OPENAI_EMBEDDING_API_VERSION) || "2024-08-01-preview",
    },
    vectorIndexType: clean(env.VECTOR_INDEX_TYPE) || "diskANN",
    embeddingField:
      clean(env.AZURE_COSMOSDB_CREATE_INDEX_EMBEDDED_FIELD) || "embedding",
    expectedDimensions: parseInt(clean(env.EMBEDDING_DIMENSIONS) || "1536", 10),
    dataFile:
      clean(env.DATA_FILE_WITH_VECTORS_AND_REGIONS) ||
      "",
    partitionKeyValue: clean(env.PARTITION_KEY_VALUE) || "Northeast",
    allowDestructiveOperations:
      clean(
        env.AZURE_COSMOSDB_CREATE_INDEX_ALLOW_DESTRUCTIVE_OPERATIONS
      )?.toLowerCase() === "true",
  };
}

export function getMissingEnvironmentVariables(config: SampleConfig): string[] {
  // All required variables including ARM SDK variables needed for control plane operations
  const required: Array<[string, string | undefined]> = [
    ["AZURE_COSMOSDB_ENDPOINT", config.cosmos.endpoint],
    ["AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME", config.cosmos.databaseName],
    ["AZURE_OPENAI_EMBEDDING_ENDPOINT", config.openai.endpoint],
    ["AZURE_OPENAI_EMBEDDING_DEPLOYMENT", config.openai.embeddingDeployment],
    ["DATA_FILE_WITH_VECTORS_AND_REGIONS", config.dataFile],
    // ARM SDK variables required for control plane operations
    ["AZURE_SUBSCRIPTION_ID", config.azure.subscriptionId],
    ["AZURE_RESOURCE_GROUP", config.azure.resourceGroup],
    ["AZURE_COSMOSDB_ACCOUNT_NAME", config.cosmos.accountName],
    ["AZURE_LOCATION", config.azure.location],
  ];

  return required.filter(([, value]) => !value).map(([name]) => name);
}

export function validateRequiredEnvironmentVariables(config: SampleConfig): void {
  const missing = getMissingEnvironmentVariables(config);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables for control plane operations: ${missing.join(", ")}. ` +
        "Run 'azd up' first, or populate .env manually with 'azd env get-values > .env'."
    );
  }

  validateContainerDeletionTargets(config);
}

export function validateContainerDeletionTargets(config: SampleConfig): void {
  if (
    config.cosmos.diskannContainerName ===
    config.cosmos.quantizedflatContainerName
  ) {
    throw new Error(
      "DiskANN and QuantizedFlat container names must be different."
    );
  }

  const usesCustomContainerNames =
    config.cosmos.diskannContainerName !== "hotels_diskann" ||
    config.cosmos.quantizedflatContainerName !== "hotels_quantizedflat";
  if (usesCustomContainerNames && !config.allowDestructiveOperations) {
    throw new Error(
      "Custom container names require " +
        "AZURE_COSMOSDB_CREATE_INDEX_ALLOW_DESTRUCTIVE_OPERATIONS=true " +
        "because the sample deletes and recreates its configured containers."
    );
  }
}
