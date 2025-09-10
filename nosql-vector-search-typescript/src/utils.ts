import { CosmosClient } from '@azure/cosmos';
import { AzureOpenAI } from 'openai/index.js';
import { promises as fs } from "fs";
import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";
// Define a type for JSON data
export type JsonData = Record<string, any>;

export function getClients(): { aiClient: AzureOpenAI | null; dbClient: CosmosClient | null } {

    let aiClient: AzureOpenAI | null = null;
    let dbClient: CosmosClient | null = null;

    const apiKey = process.env.AZURE_OPENAI_EMBEDDING_KEY!;
    const apiVersion = process.env.AZURE_OPENAI_EMBEDDING_API_VERSION!;
    const endpoint = process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT!;
    const deployment = process.env.AZURE_OPENAI_EMBEDDING_MODEL!;

    if (apiKey && apiVersion && endpoint && deployment) {

        aiClient = new AzureOpenAI({
            apiKey,
            apiVersion,
            endpoint,
            deployment
        });
    }

    // Cosmos DB connection string or endpoint/key
    // You may need to use endpoint and key separately for CosmosClient
    const cosmosEndpoint = process.env.COSMOS_ENDPOINT!;
    const cosmosKey = process.env.COSMOS_KEY!;

    if (cosmosEndpoint && cosmosKey) {
        dbClient = new CosmosClient({ endpoint: cosmosEndpoint, key: cosmosKey });
    }

    return { aiClient, dbClient };
}

/**
 * Get Azure OpenAI and Cosmos DB clients using passwordless authentication (managed identity)
 * This function uses DefaultAzureCredential for authentication instead of API keys
 * 
 * @returns Object containing AzureOpenAI and CosmosClient instances or null if configuration is missing
 */
export function getClientsPasswordless(): { aiClient: AzureOpenAI | null; dbClient: CosmosClient | null } {
    let aiClient: AzureOpenAI | null = null;
    let dbClient: CosmosClient | null = null;

    // For Azure OpenAI with DefaultAzureCredential
    const apiVersion = process.env.AZURE_OPENAI_EMBEDDING_API_VERSION!;
    const endpoint = process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT!;
    const deployment = process.env.AZURE_OPENAI_EMBEDDING_MODEL!;

    if (apiVersion && endpoint && deployment) {
        const credential = new DefaultAzureCredential();
        const scope = "https://cognitiveservices.azure.com/.default";
        const azureADTokenProvider = getBearerTokenProvider(credential, scope);
        aiClient = new AzureOpenAI({
            apiVersion,
            endpoint,
            deployment,
            azureADTokenProvider 
        });
    }

    // For Cosmos DB with DefaultAzureCredential
    const cosmosEndpoint = process.env.COSMOS_ENDPOINT!;

    if (cosmosEndpoint) {
        const credential = new DefaultAzureCredential();

        dbClient = new CosmosClient({ 
            endpoint: cosmosEndpoint,
            aadCredentials: credential // Use DefaultAzureCredential instead of key
        });
    }

    return { aiClient, dbClient };
}
export async function readFileReturnJson(filePath: string): Promise<JsonData[]> {

    console.log(`Reading JSON file from ${filePath}`);

    const fileAsString = await fs.readFile(filePath, "utf-8");
    return JSON.parse(fileAsString);
}
export async function writeFileJson(filePath: string, jsonData: JsonData): Promise<void> {
    const jsonString = JSON.stringify(jsonData, null, 2);
    await fs.writeFile(filePath, jsonString, "utf-8");

    console.log(`Wrote JSON file to ${filePath}`);
}
export async function insertData(config, container, data) {
    // Cosmos DB uses containers instead of collections
    // Insert documents in batches
    console.log(`Processing in batches of ${config.batchSize}...`);
    const totalBatches = Math.ceil(data.length / config.batchSize);

    let inserted = 0;
    let failed = 0;
    // Cosmos DB does not support bulk insert natively in SDK, but you can use stored procedures or loop
    // Here we use a simple loop for demonstration
    for (let i = 0; i < totalBatches; i++) {
        const start = i * config.batchSize;
        const end = Math.min(start + config.batchSize, data.length);
        const batch = data.slice(start, end);
        for (const doc of batch) {
            try {
                await container.items.create(doc);
                inserted++;
            } catch (error) {
                console.error(`Error inserting document:`, error);
                failed++;
            }
        }
        // Small pause between batches to reduce resource contention
        if (i < totalBatches - 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    // Index creation is handled by indexing policy in Cosmos DB, not programmatically per field
    //TBD: If custom indexing policy is needed, update container indexing policy via SDK or portal
    return { total: data.length, inserted, failed };
}

/**
 * Calculate estimated cost for Request Units (RUs) in different pricing models
 * 
 * Pricing (as of September 2023):
 * - Serverless: $0.008 per 1 million RUs
 * - Provisioned: $0.008 per 100 RU/s per hour
 */
export function calculateRUCost(options: {
  /** Total RUs consumed */
  totalRUs: number;
  /** Whether to use serverless or provisioned pricing model */
  isServerless?: boolean;
  /** RU/s provisioned (only for provisioned model) */
  provisionedRUs?: number;
  /** Price per million RUs for serverless ($0.008 is default) */
  serverlessPricePerMillionRUs?: number;
  /** Price per 100 RU/s per hour for provisioned ($0.008 is default) */
  provisionedPricePer100RUsHour?: number;
  /** Number of days to calculate cost for (default: 30) */
  days?: number;
  /** Number of regions (default: 1) */
  regionCount?: number;
}): {
  /** Estimated cost in USD */
  estimatedCost: number;
  /** Description of the calculation */
  description: string;
  /** Additional details for calculation */
  details: Record<string, any>;
} {
  const {
    totalRUs,
    isServerless = false,
    provisionedRUs = 400, // Minimum is 400 RU/s
    serverlessPricePerMillionRUs = 0.008, // Updated from 0.25
    provisionedPricePer100RUsHour = 0.008,
    days = 30,
    regionCount = 1
  } = options;

  if (isServerless) {
    // Serverless model: pay per million RUs consumed
    const costPerMillionRUs = serverlessPricePerMillionRUs * regionCount;
    const estimatedCost = (totalRUs / 1_000_000) * costPerMillionRUs;
    
    return {
      estimatedCost,
      description: `Serverless: ${totalRUs.toLocaleString()} RUs = ${(totalRUs / 1_000_000).toFixed(6)} million RUs * $${costPerMillionRUs}/million = $${estimatedCost.toFixed(6)}`,
      details: {
        model: 'Serverless',
        totalRUs,
        costPerMillionRUs,
        regionCount
      }
    };
  } else {
    // Provisioned model: pay per RU/s provisioned per hour
    const rusPer100 = provisionedRUs / 100;
    const hoursPerMonth = 24 * days;
    const estimatedCost = rusPer100 * provisionedPricePer100RUsHour * hoursPerMonth * regionCount;
    
    // Also calculate what the same workload would cost in serverless
    const serverlessCost = (totalRUs / 1_000_000) * serverlessPricePerMillionRUs * regionCount;
    
    return {
      estimatedCost,
      description: `Provisioned: ${provisionedRUs} RU/s = ${rusPer100} x 100 RU/s * $${provisionedPricePer100RUsHour}/hour * ${hoursPerMonth} hours * ${regionCount} region(s) = $${estimatedCost.toFixed(2)}`,
      details: {
        model: 'Provisioned',
        provisionedRUs,
        rusPer100,
        hoursPerMonth,
        regionCount,
        costPer100RUsHour: provisionedPricePer100RUsHour,
        comparisonToServerless: {
          serverlessCost,
          differencePercentage: ((serverlessCost - estimatedCost) / estimatedCost * 100).toFixed(2)
        }
      }
    };
  }
}

/**
 * Estimate monthly cost based on current RU usage pattern
 */
export function estimateMonthlyRUCost(options: {
  /** Current total RUs consumed */
  currentTotalRUs: number;
  /** Duration in milliseconds over which the RUs were consumed */
  durationMs: number;
  /** Whether the account is serverless */
  isServerless?: boolean;
  /** If provisioned, the current RU/s setting */
  provisionedRUs?: number;
  /** Price per million RUs for serverless */
  serverlessPricePerMillionRUs?: number;
  /** Price per 100 RU/s per hour for provisioned */
  provisionedPricePer100RUsHour?: number;
  /** Number of regions */
  regionCount?: number;
}): {
  /** Estimated monthly cost in USD */
  monthlyCost: number;
  /** Projected RU consumption for a month */
  projectedMonthlyRUs: number;
  /** Detailed breakdown of the calculation */
  details: Record<string, any>;
} {
  const {
    currentTotalRUs,
    durationMs,
    isServerless = false,
    provisionedRUs = 400,
    serverlessPricePerMillionRUs = 0.008, // Updated from 0.25
    provisionedPricePer100RUsHour = 0.008,
    regionCount = 1
  } = options;

  // Calculate projected monthly RU usage based on current consumption rate
  const msInMonth = 30 * 24 * 60 * 60 * 1000;
  const projectedMonthlyRUs = currentTotalRUs * (msInMonth / durationMs);

  // Calculate cost using the RU calculation function
  const costCalculation = calculateRUCost({
    totalRUs: projectedMonthlyRUs,
    isServerless,
    provisionedRUs,
    serverlessPricePerMillionRUs,
    provisionedPricePer100RUsHour,
    regionCount
  });

  return {
    monthlyCost: costCalculation.estimatedCost,
    projectedMonthlyRUs,
    details: {
      ...costCalculation.details,
      currentRate: {
        ruPerSecond: (currentTotalRUs / (durationMs / 1000)).toFixed(2),
        ruPerMinute: (currentTotalRUs / (durationMs / 60000)).toFixed(2),
        ruPerHour: (currentTotalRUs / (durationMs / 3600000)).toFixed(2),
        durationMs,
        currentTotalRUs
      },
      projectionBasis: `Projected ${(projectedMonthlyRUs / 1_000_000).toFixed(2)} million RUs/month based on current rate`
    }
  };
}
