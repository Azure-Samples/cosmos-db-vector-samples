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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Client factories
// ---------------------------------------------------------------------------

/** Create a Cosmos DB data-plane client. */
export function createCosmosClient(credential: TokenCredential, endpoint: string) {
  return new CosmosClient({
    endpoint,
    aadCredentials: credential,
  });
}

/** Create an Azure OpenAI client for embedding generation. */
export function createOpenAIClient(credential: TokenCredential, config) {
  const tokenProvider = getBearerTokenProvider(
    credential,
    "https://cognitiveservices.azure.com/.default"
  );
  return new AzureOpenAI({
    azureADTokenProvider: tokenProvider,
    endpoint: config.openai.endpoint,
    apiVersion: config.openai.embeddingApiVersion,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate an embedding vector for the given text. */
async function generateEmbedding(openaiClient: AzureOpenAI, deployment: string, text: string) {
  const response = await openaiClient.embeddings.create({
    model: deployment,
    input: [text],
  });
  return response.data[0].embedding;
}

// ---------------------------------------------------------------------------
// Step 3 — Verify embedding dimensions
// ---------------------------------------------------------------------------
export async function verifyEmbeddingDimensions(openaiClient: AzureOpenAI, config) {
  console.log("\n=== Step 3: Verify Embedding Dimensions ===");

  const embedding = await generateEmbedding(
    openaiClient,
    config.openai.embeddingDeployment,
    "dimension check"
  );
  const actual = embedding.length;

  console.log(`  Model:    ${config.openai.embeddingDeployment}`);
  console.log(`  Actual:   ${actual}`);
  console.log(`  Expected: ${config.expectedDimensions}`);

  if (actual !== config.expectedDimensions) {
    throw new Error(
      `Dimension mismatch: model produces ${actual} but container expects ${config.expectedDimensions}. ` +
        `Update EMBEDDING_DIMENSIONS and recreate the container.`
    );
  }

  console.log("  Dimensions match");
  return actual;
}

// ---------------------------------------------------------------------------
// Step 4 — Insert documents from data file (bulk)
// ---------------------------------------------------------------------------
export async function insertDocuments(container: Container, config) {
  console.log("\n=== Step 4: Insert Documents ===");

  // Load pre-vectorized hotel data from JSON file
  const filePath = resolve(__dirname, "..", config.dataFile);
  console.log(`  Data file: ${filePath}`);

  const fileContent = await readFile(filePath, "utf-8");
  const data = JSON.parse(fileContent);
  console.log(
    `  Loaded ${data.length} documents (embeddings already included)`
  );

  // Check if container already has documents
  const { resources: countResult } = await container.items
    .query("SELECT VALUE COUNT(1) FROM c")
    .fetchAll();

  if (countResult[0] > 0) {
    console.log(
      `  Container already has ${countResult[0]} documents — skipping insert`
    );
    return { total: data.length, inserted: 0, skipped: countResult[0] };
  }

  // Build bulk operations — SDK handles batching and throttling
  const operations = data.map((item) => ({
    operationType: BulkOperationType.Create,
    resourceBody: {
      id: item.HotelId,
      ...item,
    },
    partitionKey: [item.HotelId],
  }));

  console.log(
    `  Inserting ${operations.length} items using executeBulkOperations...`
  );

  const start = Date.now();
  const response = await container.items.executeBulkOperations(operations);
  const elapsed = ((Date.now() - start) / 1000).toFixed(2);

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
        // Already exists — treat as success
        inserted++;
      } else if (result.error) {
        failed++;
        console.error(`  Failed: ${result.error.message}`);
      } else {
        inserted++;
      }
      totalRU += ru;
    }
  }

  console.log(`  Bulk insert completed in ${elapsed}s`);
  console.log(
    `  Inserted: ${inserted}/${data.length} | Failed: ${failed} | RU: ${totalRU.toFixed(2)}`
  );
  return { total: data.length, inserted, failed };
}

// ---------------------------------------------------------------------------
// Step 5 — Vector similarity query
// ---------------------------------------------------------------------------
export async function vectorQuery(container: Container, openaiClient: AzureOpenAI, config) {
  console.log("\n=== Step 5: Vector Similarity Query ===");

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

  const querySpec = {
    query: `SELECT TOP 3
              c.id,
              c.Description,
              VectorDistance(c.${embeddingField}, @embedding) AS similarity
            FROM c
            ORDER BY VectorDistance(c.${embeddingField}, @embedding)`,
    parameters: [{ name: "@embedding", value: queryEmbedding }],
  };

  const start = Date.now();
  const { resources, requestCharge } = await container.items
    .query(querySpec)
    .fetchAll();
  const latency = Date.now() - start;

  console.log(`  Query:   "${queryText}"`);
  console.log(
    `  Latency: ${latency}ms | RU: ${requestCharge.toFixed(2)} | Results: ${resources.length}`
  );

  resources.forEach((r, i) => {
    console.log(
      `    ${i + 1}. ${r.Description} (similarity: ${r.similarity.toFixed(4)})`
    );
  });

  return { success: resources.length > 0, latency, requestCharge };
}


