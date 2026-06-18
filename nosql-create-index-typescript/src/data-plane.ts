/**
 * Data-plane operations using @azure/cosmos and Azure OpenAI.
 *
 *   3. Verify embedding dimensions
 *   4. Insert documents from pre-vectorized data file (bulk)
 *   5. Run a vector similarity query using VectorDistance()
 */

import { CosmosClient, BulkOperationType, type Container } from "@azure/cosmos";
import { AzureOpenAI } from "openai";
import { getBearerTokenProvider, type TokenCredential } from "@azure/identity";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { SampleConfig } from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Client factories
// ---------------------------------------------------------------------------

/** Create a Cosmos DB data-plane client. */
export function createCosmosClient(
  credential: TokenCredential,
  endpoint: string
) {
  return new CosmosClient({
    endpoint,
    aadCredentials: credential,
  });
}

/** Create an Azure OpenAI client for embedding generation. */
export function createOpenAIClient(
  credential: TokenCredential,
  config: SampleConfig
) {
  const tokenProvider = getBearerTokenProvider(
    credential,
    "https://cognitiveservices.azure.com/.default"
  );
  return new AzureOpenAI({
    azureADTokenProvider: tokenProvider,
    endpoint: config.openai.endpoint!,
    apiVersion: config.openai.embeddingApiVersion,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate an embedding vector for the given text. */
async function generateEmbedding(
  openaiClient: AzureOpenAI,
  deployment: string,
  text: string
) {
  const response = await openaiClient.embeddings.create({
    model: deployment,
    input: [text],
  });
  return response.data[0].embedding;
}

// ---------------------------------------------------------------------------
// Step 3 — Verify embedding dimensions
// ---------------------------------------------------------------------------
export async function verifyEmbeddingDimensions(
  openaiClient: AzureOpenAI,
  config: SampleConfig
) {
  const embedding = await generateEmbedding(
    openaiClient,
    config.openai.embeddingDeployment,
    "dimension check"
  );
  const actual = embedding.length;

  if (actual !== config.expectedDimensions) {
    throw new Error(
      `Dimension mismatch: model produces ${actual} but container expects ${config.expectedDimensions}. ` +
        "Update EMBEDDING_DIMENSIONS and recreate the container."
    );
  }

  return actual;
}

// ---------------------------------------------------------------------------
// Step 4 — Insert documents from data file (bulk)
// ---------------------------------------------------------------------------
export async function insertDocuments(
  container: Container,
  config: SampleConfig,
  containerName?: string
) {
  const actualContainerName = containerName || config.cosmos.containerName;
  
  // Load pre-vectorized hotel data from JSON file
  const filePath = resolve(__dirname, "..", config.dataFile);
  const fileContent = await readFile(filePath, "utf-8");
  const data = JSON.parse(fileContent);
  console.log(`\nReading JSON file from ${filePath}`);
  console.log(`Loaded ${data.length} documents`);

  // Check if container already has documents
  const { resources: countResult } = await container.items
    .query("SELECT VALUE COUNT(1) FROM c")
    .fetchAll();

  if (countResult[0] > 0) {
    console.log(
      `  \u2713 ${actualContainerName}: ${countResult[0]} documents already exist (skipped)`
    );
    return { total: data.length, inserted: 0, skipped: countResult[0] };
  }

  // Build bulk operations — SDK handles batching and throttling
  console.log(`Processing in batches of ${data.length}...`);
  const operations = data.map((item) => ({
    operationType: BulkOperationType.Create,
    resourceBody: {
      id: item.HotelId,
      ...item,
    },
    partitionKey: [item.HotelId],
  }));

  const response = await container.items.executeBulkOperations(operations);

  let inserted = 0;
  let failed = 0;
  let totalRU = 0;

  if (response) {
    for (const result of response) {
      const code = result.response?.statusCode ?? result.error?.code;
      const ru = result.response?.requestCharge ?? 0;

      if (code && Number(code) >= 200 && Number(code) < 300) {
        inserted++;
      } else if (Number(code) === 409) {
        inserted++;
      } else if (result.error) {
        failed++;
      } else {
        inserted++;
      }
      totalRU += ru;
    }
  }

  console.log(`  \u2713 ${actualContainerName}: ${inserted} inserted (${totalRU.toFixed(2)} RUs)`);
  return { total: data.length, inserted, failed };
}

// ---------------------------------------------------------------------------
// Step 5 — Vector similarity queries
// ---------------------------------------------------------------------------
export async function vectorQuery(
  container: Container,
  containerName: string,
  openaiClient: AzureOpenAI,
  config: SampleConfig
) {
  const embeddingField = config.embeddingField;

  // Cosmos DB SQL does not support parameter placeholders for field names,
  // so the field name is string-interpolated. Validate to prevent injection.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(embeddingField)) {
    throw new Error(`Invalid embedding field name: ${embeddingField}`);
  }

  const queryText = "hotel near the ocean";
  const queryEmbedding = await generateEmbedding(
    openaiClient,
    config.openai.embeddingDeployment,
    queryText
  );

  console.log(`\nQuery: "${queryText}"`);
  console.log(`Embedding generated (${queryEmbedding.length} dimensions)`);
  console.log(`\nRunning search (top 3 results for each distance function)...`);

  // Query with 3 distance functions using VectorDistance() options parameter
  const distanceFunctions = ["Cosine", "DotProduct", "Euclidean"];
  const results: Array<{ container: string; metric: string; top1: string; top1Score: number; top2: string; top2Score: number; diff: number; ru: number }> = [];

  for (const distanceFunction of distanceFunctions) {
    const querySpec = {
      query: `SELECT TOP 3
                c.id,
                c.HotelName,
                c.Description,
                VectorDistance(c.${embeddingField}, @embedding, false, {distanceFunction: "${distanceFunction}"}) AS similarity
              FROM c
              ORDER BY VectorDistance(c.${embeddingField}, @embedding, false, {distanceFunction: "${distanceFunction}"})`,
      parameters: [{ name: "@embedding", value: queryEmbedding }],
    };

    const { resources, requestCharge } = await container.items
      .query(querySpec)
      .fetchAll();

    if (resources.length > 0) {
      const top1Name = (resources[0].HotelName || resources[0].Description || "").substring(0, 26);
      const top1Score = resources[0].similarity;
      const top2Name = resources.length > 1 ? (resources[1].HotelName || resources[1].Description || "").substring(0, 26) : "";
      const top2Score = resources.length > 1 ? resources[1].similarity : 0;
      const diff = top1Score - top2Score;

      results.push({
        container: containerName,
        metric: distanceFunction,
        top1: top1Name,
        top1Score,
        top2: top2Name,
        top2Score,
        diff,
        ru: requestCharge,
      });
    }
  }

  console.log(`  ✓ ${containerName} queried with 3 distance functions (${results.reduce((acc, r) => acc + r.ru, 0).toFixed(2)} RUs)`);

  return results;
}
