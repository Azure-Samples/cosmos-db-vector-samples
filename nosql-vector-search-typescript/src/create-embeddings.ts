/**
 * Module for creating embedding vectors using OpenAI API
 * Supports text embedding models for generating embeddings
 * that can be used with Cosmos DB MongoDB vCore vector search
 */
import * as path from "node:path";
import { AzureOpenAI } from "openai";
import { Embedding } from "openai/resources";
import { readFileReturnJson, writeFileJson, JsonData, getClientsPasswordless } from "./utils.js";

// ESM specific features - create __dirname equivalent
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


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

/**
 * Configuration options for embedding processing
 */
export interface EmbeddingConfig {
    /** Field name to embed. If null/undefined, entire document will be embedded */
    fieldToEmbed?: string;
    /** Name of the new field where embeddings will be stored */
    newEmbeddedField: string;
    /** Maximum number of items to process */
    maxEmbeddings?: number;
    /** Fields to exclude when embedding entire document */
    excludeFields?: string[];
    /** Custom separator for joining document fields (default: " ") */
    fieldSeparator?: string;
    /** Whether to include field names in document embedding (default: false) */
    includeFieldNames?: boolean;
}

/**
 * Extract text content from a document for embedding
 */
function extractTextFromDocument<T>(
    item: T, 
    fieldToEmbed?: string,
    excludeFields: string[] = [],
    fieldSeparator: string = " ",
    includeFieldNames: boolean = false
): string {
    // If specific field is requested, extract only that field
    if (fieldToEmbed) {
        const fieldValue = (item as any)[fieldToEmbed];
        if (!fieldValue) {
            console.warn(`Item is missing the field to embed: ${fieldToEmbed}`);
            return ""; // Provide a fallback value to prevent API errors
        }
        return String(fieldValue);
    }

    // Embed entire document
    if (!item || typeof item !== 'object') {
        return String(item || "");
    }

    const textParts: string[] = [];
    const itemObj = item as Record<string, any>;
    
    // Default fields to exclude for document embedding
    const defaultExcludeFields = ['id', '_id', 'embedding', 'embeddings', 'vector', 'vectors'];
    const fieldsToExclude = [...defaultExcludeFields, ...excludeFields];
    
    Object.entries(itemObj).forEach(([key, value]) => {
        // Skip excluded fields
        if (fieldsToExclude.includes(key)) {
            return;
        }
        
        // Skip null, undefined, or empty values
        if (value == null || value === "") {
            return;
        }
        
        // Convert value to string
        let textValue: string;
        if (typeof value === 'object') {
            // For objects/arrays, stringify them
            textValue = JSON.stringify(value);
        } else {
            textValue = String(value);
        }
        
        // Add to text parts with optional field name
        if (includeFieldNames) {
            textParts.push(`${key}: ${textValue}`);
        } else {
            textParts.push(textValue);
        }
    });
    
    return textParts.join(fieldSeparator);
}

/**
 * Prepare batch of texts for embedding
 */
function prepareBatchTexts<T>(
    batchItems: T[],
    config: EmbeddingConfig
): string[] {
    return batchItems.map(item => extractTextFromDocument(
        item,
        config.fieldToEmbed,
        config.excludeFields,
        config.fieldSeparator,
        config.includeFieldNames
    ));
}

export async function processEmbeddingBatch<T>(
    client: AzureOpenAI,
    model: string,
    fieldToEmbed: string | null | undefined,
    newEmbeddedField: string,
    maxEmbeddings: number,
    items: T[]
): Promise<T[]>;

export async function processEmbeddingBatch<T>(
    client: AzureOpenAI,
    model: string,
    config: EmbeddingConfig,
    items: T[]
): Promise<T[]>;

export async function processEmbeddingBatch<T>(
    client: AzureOpenAI,
    model: string,
    fieldToEmbedOrConfig: string | null | undefined | EmbeddingConfig,
    newEmbeddedFieldOrItems: string | T[],
    maxEmbeddingsOrUndefined?: number,
    itemsOrUndefined?: T[]
): Promise<T[]> {
    // Handle overloaded function signatures
    let config: EmbeddingConfig;
    let items: T[];
    
    if (Array.isArray(newEmbeddedFieldOrItems)) {
        // New signature: processEmbeddingBatch(client, model, config, items)
        config = fieldToEmbedOrConfig as EmbeddingConfig;
        items = newEmbeddedFieldOrItems;
    } else {
        // Legacy signature: processEmbeddingBatch(client, model, fieldToEmbed, newEmbeddedField, maxEmbeddings, items)
        const fieldToEmbed = fieldToEmbedOrConfig as string | null | undefined;
        const newEmbeddedField = newEmbeddedFieldOrItems as string;
        const maxEmbeddings = maxEmbeddingsOrUndefined;
        items = itemsOrUndefined!;
        
        config = {
            fieldToEmbed: fieldToEmbed || undefined,
            newEmbeddedField,
            maxEmbeddings
        };
    }

    // Validation
    if (!Array.isArray(items) || items.length === 0) {
        throw new Error("Items must be a non-empty array");
    }

    if (!config.newEmbeddedField) {
        throw new Error("New embedded field name must be specified");
    }

    const itemsWithEmbeddings: T[] = [];
    const maxItems = Math.min(config.maxEmbeddings || items.length, items.length);
    
    const embeddingMode = config.fieldToEmbed ? `field '${config.fieldToEmbed}'` : 'entire document';
    console.log(`Processing ${maxItems} items for embedding (${embeddingMode})`);
    
    if (!config.fieldToEmbed) {
        console.log(`Excluding fields: ${['id', '_id', 'embedding', 'embeddings', 'vector', 'vectors', ...(config.excludeFields || [])].join(', ')}`);
    }

    // Process in batches to avoid rate limits and memory issues
    for (let i = 0; i < maxItems; i += batchSize) {
        const batchEnd = Math.min(i + batchSize, maxItems);
        console.log(`Processing batch: ${i} to ${batchEnd - 1} (of ${maxItems} items)`);

        const batchItems = items.slice(i, batchEnd);
        const textsToEmbed = prepareBatchTexts(batchItems, config);

        try {
            const embeddings = await createEmbeddings(client, model, textsToEmbed);

            embeddings.forEach((embeddingData, index) => {
                const originalItem = batchItems[index];
                const newItem = {
                    ...originalItem,
                    [config.newEmbeddedField]: embeddingData.embedding
                };
                itemsWithEmbeddings.push(newItem);
            });

            // Add a small delay between batches to avoid rate limiting
            if (batchEnd < maxItems) {
                await delay();
            }
        } catch (error) {
            console.error(`Error generating embeddings for batch ${i}:`, error);
            throw error;
        }
    }

    return itemsWithEmbeddings;
}

// Testing function to demonstrate both embedding modes
export async function testEmbeddingModes(
    client: AzureOpenAI,
    model: string,
    sampleItems: any[]
): Promise<void> {
    console.log("Testing field-specific embedding...");
    
    // Test field-specific embedding (legacy style)
    const fieldEmbeddings = await processEmbeddingBatch(
        client,
        model,
        "hotelName",  // embed only the hotel name field
        "nameEmbedding",
        3,
        sampleItems
    );
    
    console.log(`Generated ${fieldEmbeddings.length} field-specific embeddings`);
    
    console.log("\nTesting full document embedding...");
    
    // Test full document embedding (new config style)
    const docEmbeddings = await processEmbeddingBatch(
        client,
        model,
        {
            // No fieldToEmbed specified = embed entire document
            newEmbeddedField: "documentEmbedding",
            maxEmbeddings: 3,
            excludeFields: ["hotelId", "category"], // custom exclusions
            fieldSeparator: " | ",
            includeFieldNames: true
        },
        sampleItems
    );
    
    console.log(`Generated ${docEmbeddings.length} full document embeddings`);
}

// Main execution function
async function main(): Promise<void> {
    try {
        const { aiClient } = getClientsPasswordless();

        if (!aiClient) {
            throw new Error('OpenAI client is not configured properly. Please check your environment variables.');
        }

        const data = await readFileReturnJson(path.join(__dirname, "..", dataWithoutVectors!));
        const model = deployment;
        const maxEmbeddings = data.length; 

        const embeddings = await processEmbeddingBatch<JsonData>(
            aiClient,
            model,
            fieldToEmbed,
            newEmbeddedField,
            maxEmbeddings,
            data
        );

        await writeFileJson(path.join(__dirname, "..", dataWithVectors!), embeddings);

    } catch (error) {
        console.error(`Failed to save embeddings to file: ${(error as Error).message}`);
        process.exit(1);
    }
}

// Only run main if this file is being executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}