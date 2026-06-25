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
import { appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
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

/**
 * Validate that all documents have a Region property and it's one of the expected regions.
 */
function validateRegionProperty(documents: any[]): void {
  const expectedRegions = new Set(["Northeast", "Midwest", "South", "West"]);
  const regionsFound = new Set<string>();

  for (let idx = 0; idx < documents.length; idx++) {
    const doc = documents[idx];
    if (!doc.Region) {
      throw new Error(
        `Document at index ${idx} (HotelId=${doc.HotelId || "unknown"}) missing Region property`
      );
    }
    const region = doc.Region;
    regionsFound.add(region);
    if (!expectedRegions.has(region)) {
      throw new Error(
        `Document at index ${idx} has unexpected Region '${region}'. Expected one of: ${Array.from(expectedRegions).join(", ")}`
      );
    }
  }

  console.log(`✓ Region validation passed. Found regions: ${Array.from(regionsFound).sort().join(", ")}`);
}

/**
 * Group documents by Region partition key.
 */
function groupByRegion(documents: any[]): Map<string, any[]> {
  const docsByRegion = new Map<string, any[]>();

  for (const doc of documents) {
    const region = doc.Region;
    if (!docsByRegion.has(region)) {
      docsByRegion.set(region, []);
    }
    docsByRegion.get(region)!.push(doc);
  }

  // Log region grouping summary
  for (const [region, docs] of Array.from(docsByRegion.entries()).sort()) {
    console.log(`  Region '${region}': ${docs.length} documents`);
  }

  return docsByRegion;
}

export async function insertDocuments(
  container: Container,
  config: SampleConfig,
  embeddingField: string,
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
      `  ✓ ${actualContainerName}: ${countResult[0]} documents already exist (skipped)`
    );
    return { total: data.length, inserted: 0, skipped: countResult[0] };
  }

  // Validate Region property and group by region
  validateRegionProperty(data);
  const docsByRegion = groupByRegion(data);

  console.log(`Processing by region...`);
  let inserted = 0;
  let failed = 0;
  let conflict = 0;
  let totalRU = 0;
  const errors: Array<{ doc: string; error: string; statusCode?: number }> = [];

  // Batch ingest by region (one batch per region)
  for (const [region, regionDocs] of docsByRegion) {
    const operations = regionDocs.map((item) => ({
      operationType: BulkOperationType.Create,
      resourceBody: {
        ...item,
        id: item.HotelId || randomUUID(), // Map HotelId to id (required for Cosmos bulk ops)
        // Use the pre-computed embedding from the data file (DescriptionVector)
        [embeddingField]: item.DescriptionVector || item.embedding,
      },
      partitionKey: [region],
    }));

    try {
      const response = await container.items.executeBulkOperations(operations);

      if (response) {
        for (const result of response) {
          const statusCode = result.response?.statusCode;
          const errorCode = result.error?.code;
          const ru = result.response?.requestCharge ?? 0;

          if (statusCode && Number(statusCode) >= 200 && Number(statusCode) < 300) {
            inserted++;
          } else if (Number(statusCode) === 409) {
            // 409 Conflict: document already exists
            conflict++;
            inserted++;
          } else if (result.error) {
            failed++;
            const docId = (result as any).resourceBody?.id || "unknown";
            errors.push({
              doc: docId,
              error: result.error.message || "Unknown error",
              statusCode: statusCode as number | undefined,
            });
          } else {
            inserted++;
          }
          totalRU += ru;
        }
      }
    } catch (error) {
      failed += regionDocs.length;
      errors.push({
        doc: `Region: ${region} (${regionDocs.length} docs)`,
        error: (error as Error).message || "Batch operation failed",
      });
    }
  }

  if (errors.length > 0) {
    console.error(`  ✗ Errors during ingestion:`);
    for (const err of errors.slice(0, 5)) {
      console.error(`    - ${err.doc}: ${err.error}${err.statusCode ? ` (${err.statusCode})` : ""}`);
    }
    if (errors.length > 5) {
      console.error(`    ... and ${errors.length - 5} more errors`);
    }
  }

  if (failed > 0) {
    throw new Error(
      `Batch ingestion incomplete: ${failed} documents failed, ${conflict} conflicts, ${inserted} inserted in container '${actualContainerName}'.`
    );
  }

  console.log(`  ✓ ${actualContainerName}: ${inserted} inserted (${conflict > 0 ? `${conflict} conflicts, ` : ""}${totalRU.toFixed(2)} RUs)`);
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
  console.log(`\nRunning search (top 5 results for each distance function)...`);

  // Query with 3 distance functions using VectorDistance() options parameter
  const distanceFunctions = [
    { name: "Cosine", orderDirection: "DESC" },      // Similarity: higher = better
    { name: "DotProduct", orderDirection: "DESC" },  // Similarity: higher = better
    { name: "Euclidean", orderDirection: "ASC" },    // Distance: lower = better
  ];
  const results: Array<{ container: string; metric: string; top1: string; top1Score: number; top2: string; top2Score: number; diff: number; ru: number }> = [];

  for (const distFunc of distanceFunctions) {
    const distanceFunction = distFunc.name;
    
    // Query strategy: VectorDistance automatically sorts by similarity
    // (no ORDER BY clause allowed - it's automatic and always sorts most-to-least similar)
    
    // Single-partition query for efficiency:
    // - WHERE clause filters to the configured region
    // - SDK partition key routing ensures single-partition execution
    // - Belt-and-suspenders pattern: both mechanisms for guaranteed efficiency
    const partitionKeyValue = config.partitionKeyValue;
    
    const querySpec = {
      query: `SELECT TOP 5
                c.HotelId,
                c.HotelName,
                c.Description,
                VectorDistance(c.${embeddingField}, @embedding, false, {'distanceFunction': '${distanceFunction}'}) AS SimilarityScore
              FROM c
              WHERE c.Region = @partitionKey`,
      parameters: [
        { name: "@embedding", value: queryEmbedding },
        { name: "@partitionKey", value: partitionKeyValue }
      ],
    };

    try {
      const { resources, requestCharge } = await container.items
        .query(querySpec, { partitionKey: partitionKeyValue })
        .fetchAll();

      if (resources.length >= 2) {
        const top1 = resources[0];
        const top2 = resources[1];
        results.push({
          container: containerName,
          metric: distanceFunction,
          top1: (top1.HotelName || "").substring(0, 26),
          top1Score: top1.SimilarityScore,
          top2: (top2.HotelName || "").substring(0, 26),
          top2Score: top2.SimilarityScore,
          diff: Math.abs(top1.SimilarityScore - top2.SimilarityScore),
          ru: requestCharge,
        });
      } else if (resources.length === 1) {
        const top1 = resources[0];
        results.push({
          container: containerName,
          metric: distanceFunction,
          top1: (top1.HotelName || "").substring(0, 26),
          top1Score: top1.SimilarityScore,
          top2: "",
          top2Score: 0,
          diff: 0,
          ru: requestCharge,
        });
      }
      
      console.log(`  ✓ ${containerName} queried (${requestCharge.toFixed(2)} RUs)`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ ${distanceFunction} query failed: ${errMsg}`);
    }
  }

  return results;
}

/**
 * Delete all sample-inserted documents from a container.
 * Uses a query to find all documents and delete them in bulk by Region.
 */
export async function clearContainerData(container: Container): Promise<void> {
  const querySpec = {
    query: "SELECT c.id, c.Region FROM c",
  };

  const { resources: itemsToDelete } = await container.items.query(querySpec).fetchAll();

  if (itemsToDelete.length === 0) {
    return;
  }

  const operations = itemsToDelete.map((item: any) => ({
    operationType: BulkOperationType.Delete,
    id: item.id,
    partitionKey: [item.Region],  // Use Region as partition key
  }));

  await container.items.bulk(operations);
}
