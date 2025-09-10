/**
 * Module for creating embedding vectors using OpenAI API
 * Supports text embedding models for generating embeddings
 * that can be used with Cosmos DB MongoDB vCore vector search
 */
import * as path from "node:path";
import { AzureOpenAI } from "openai";
import { Embedding } from "openai/resources";
import { readFileReturnJson, writeFileJson, JsonData } from "./utils.js";

// ESM specific features - create __dirname equivalent
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const apiKey = process.env.AZURE_OPENAI_EMBEDDING_KEY;
const apiVersion = process.env.AZURE_OPENAI_EMBEDDING_API_VERSION;
const endpoint = process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT;
console.log(`Using OpenAI endpoint: ${endpoint}`);
const deployment = process.env.AZURE_OPENAI_EMBEDDING_MODEL!;

const dataWithVectors = process.env.DATA_FILE_WITH_VECTORS!;
const dataWithoutVectors = process.env.DATA_FILE_WITHOUT_VECTORS!;
const fieldToEmbed = process.env.FIELD_TO_EMBED! || "description";
const newEmbeddedField = process.env.EMBEDDED_FIELD! || deployment;
const batchSize = parseInt(process.env.EMBEDDING_BATCH_SIZE || '16', 10);

// Define a reusable delay function
async function delay(ms: number = 200): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
}

export async function createEmbeddings(client: AzureOpenAI, model: string, inputItems: string[]): Promise<Embedding[]> {
    const response = await client.embeddings.create({
        model,
        input: inputItems
    });

    if (!response.data || response.data.length === 0) {
        throw new Error(`No embedding data returned`);
    }
    return response.data;
}

export async function processEmbeddingBatch<T>(
    client: AzureOpenAI,
    model: string,
    fieldToEmbed: string,
    newEmbeddedField: string,
    maxEmbeddings: number,
    items: T[]

): Promise<T[]> {
    if (!Array.isArray(items) || items.length === 0) {
        throw new Error("Items must be a non-empty array");
    }

    if (!fieldToEmbed) {
        throw new Error("Field to embed must be specified");
    }

    const itemsWithEmbeddings: T[] = [];
    maxEmbeddings = maxEmbeddings || items.length;

    // Process in batches to avoid rate limits and memory issues
    for (let i = 0; i < maxEmbeddings; i += batchSize) {
        const batchEnd = Math.min(i + batchSize, items.length);
        console.log(`Processing batch: ${i} to ${batchEnd - 1} (of ${items.length} items)`);

        const batchItems = items.slice(i, batchEnd);
        const textsToEmbed = batchItems.map(item => {
            if (!item[fieldToEmbed]) {
                console.warn(`Item is missing the field to embed: ${fieldToEmbed}`);
                return ""; // Provide a fallback value to prevent API errors
            }
            return item[fieldToEmbed];
        });

        try {
            const embeddings = await createEmbeddings(client, model, textsToEmbed);

            embeddings.forEach((embeddingData, index) => {
                const originalItem = batchItems[index];
                const newItem = {
                    ...originalItem,
                    [newEmbeddedField]: embeddingData.embedding
                };
                itemsWithEmbeddings.push(newItem);
            });

            // Add a small delay between batches to avoid rate limiting
            if (batchEnd < items.length) {
                await delay();
            }
        } catch (error) {
            console.error(`Error generating embeddings for batch ${i}:`, error);
            throw error;
        }
    }

    return itemsWithEmbeddings;
}


try {

    const client =  new AzureOpenAI( {
        apiKey,
        apiVersion,
        endpoint,
        deployment
    });

    const data = await readFileReturnJson(path.join(__dirname, "..", dataWithoutVectors!));
    const model = deployment;
    const maxEmbeddings = data.length; 

    const embeddings = await processEmbeddingBatch<JsonData>(
        client,
        model,
        fieldToEmbed,
        newEmbeddedField,
        maxEmbeddings,
        data
    );

    await writeFileJson(path.join(__dirname, "..", dataWithVectors!), embeddings);

} catch (error) {
    console.error(`Failed to save embeddings to file: ${(error as Error).message}`);
}