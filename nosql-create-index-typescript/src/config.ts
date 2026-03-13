export interface SampleConfig {
  azure: {
    subscriptionId?: string;
    resourceGroup?: string;
    location: string;
    userPrincipalId?: string;
  };
  cosmos: {
    accountName?: string;
    endpoint?: string;
    databaseName: string;
    containerName: string;
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
}

export function loadConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): SampleConfig {
  return {
    azure: {
      subscriptionId: env.AZURE_SUBSCRIPTION_ID,
      resourceGroup: env.AZURE_RESOURCE_GROUP,
      location: env.AZURE_LOCATION || "eastus2",
      userPrincipalId: env.AZURE_USER_PRINCIPAL_ID,
    },
    cosmos: {
      accountName: env.AZURE_COSMOSDB_ACCOUNT_NAME,
      endpoint: env.AZURE_COSMOSDB_ENDPOINT,
      databaseName: env.AZURE_COSMOSDB_DATABASENAME || "Hotels",
      containerName: env.AZURE_COSMOSDB_CONTAINER_NAME || "hotels_diskann",
    },
    openai: {
      endpoint: env.AZURE_OPENAI_ENDPOINT,
      embeddingDeployment:
        env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || "text-embedding-3-small",
      embeddingApiVersion:
        env.AZURE_OPENAI_EMBEDDING_API_VERSION || "2024-08-01-preview",
    },
    vectorIndexType: env.VECTOR_INDEX_TYPE || "diskANN",
    embeddingField: env.EMBEDDED_FIELD || "DescriptionVector",
    expectedDimensions: parseInt(env.EMBEDDING_DIMENSIONS || "1536", 10),
    dataFile:
      env.DATA_FILE_WITH_VECTORS || "../data/HotelsData_toCosmosDB_Vector.json",
  };
}

export function getMissingEnvironmentVariables(config: SampleConfig): string[] {
  const required: Array<[string, string | undefined]> = [
    ["AZURE_SUBSCRIPTION_ID", config.azure.subscriptionId],
    ["AZURE_RESOURCE_GROUP", config.azure.resourceGroup],
    ["AZURE_COSMOSDB_ACCOUNT_NAME", config.cosmos.accountName],
    ["AZURE_COSMOSDB_ENDPOINT", config.cosmos.endpoint],
    ["AZURE_OPENAI_ENDPOINT", config.openai.endpoint],
  ];

  return required.filter(([, value]) => !value).map(([name]) => name);
}

export function validateRequiredEnvironmentVariables(config: SampleConfig): void {
  const missing = getMissingEnvironmentVariables(config);

  if (missing.length === 0) {
    return;
  }

  throw new Error(
    `Missing required environment variables: ${missing.join(", ")}. ` +
      "Run scripts/create-resources.sh first, or populate .env manually."
  );
}
