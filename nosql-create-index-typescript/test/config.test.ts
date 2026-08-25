import { describe, expect, it } from "vitest";
import {
  loadConfigFromEnv,
  validateRequiredEnvironmentVariables,
} from "../src/config.js";

const validEnv: NodeJS.ProcessEnv = {
  AZURE_COSMOSDB_ENDPOINT: "https://example.documents.azure.com:443/",
  AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME: "HotelsCreateIndex",
  AZURE_OPENAI_EMBEDDING_ENDPOINT:
    "https://canonical.openai.azure.com/",
  AZURE_OPENAI_EMBEDDING_DEPLOYMENT: "text-embedding-3-small",
  AZURE_SUBSCRIPTION_ID: "00000000-0000-0000-0000-000000000000",
  AZURE_RESOURCE_GROUP: "example-rg",
  AZURE_COSMOSDB_ACCOUNT_NAME: "example-account",
  AZURE_LOCATION: "eastus2",
  DATA_FILE_WITH_VECTORS_AND_REGIONS:
    "./data/HotelsData_toCosmosDB_Vector_byRegion.json",
};

describe("create-index TypeScript configuration", () => {
  it("prefers the canonical Azure OpenAI embedding endpoint", () => {
    const config = loadConfigFromEnv({
      ...validEnv,
      AZURE_OPENAI_ENDPOINT: "https://legacy.openai.azure.com/",
    });

    expect(config.openai.endpoint).toBe(
      "https://canonical.openai.azure.com/"
    );
  });

  it("supports AZURE_OPENAI_ENDPOINT as a legacy fallback", () => {
    const env = { ...validEnv };
    delete env.AZURE_OPENAI_EMBEDDING_ENDPOINT;
    env.AZURE_OPENAI_ENDPOINT = "https://legacy.openai.azure.com/";

    const config = loadConfigFromEnv(env);
    validateRequiredEnvironmentVariables(config);

    expect(config.openai.endpoint).toBe(
      "https://legacy.openai.azure.com/"
    );
  });

  it("reports the canonical endpoint label when both names are missing", () => {
    const env = { ...validEnv };
    delete env.AZURE_OPENAI_EMBEDDING_ENDPOINT;

    expect(() =>
      validateRequiredEnvironmentVariables(loadConfigFromEnv(env))
    ).toThrow("AZURE_OPENAI_EMBEDDING_ENDPOINT");
  });

  it("rejects identical configured container names", () => {
    const config = loadConfigFromEnv({
      ...validEnv,
      AZURE_COSMOSDB_CREATE_INDEX_DISKANN_CONTAINER_NAME: "same",
      AZURE_COSMOSDB_CREATE_INDEX_QUANTIZEDFLAT_CONTAINER_NAME: "same",
      AZURE_COSMOSDB_CREATE_INDEX_ALLOW_DESTRUCTIVE_OPERATIONS: "true",
    });

    expect(() => validateRequiredEnvironmentVariables(config)).toThrow(
      "must be different"
    );
  });

  it("requires destructive opt-in for custom cleanup targets", () => {
    const config = loadConfigFromEnv({
      ...validEnv,
      AZURE_COSMOSDB_CREATE_INDEX_DISKANN_CONTAINER_NAME: "unrelated",
    });

    expect(() => validateRequiredEnvironmentVariables(config)).toThrow(
      "ALLOW_DESTRUCTIVE_OPERATIONS"
    );
  });
});
