/**
 * Azure Cosmos DB Low-Level Operations Module
 * 
 * This module contains core Cosmos DB NoSQL operations including:
 * - Client creation and authentication
 * - Document validation and preparation
 * - Database and container management
 * - Basic CRUD operations
 */
import { Container, CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";
import { v4 as uuidv4 } from 'uuid';
import { JsonData } from './interfaces.js';

// -------------------------------------------
// Client Creation Functions
// -------------------------------------------

export function getClients(): { dbClient: CosmosClient | null } {
    let dbClient: CosmosClient | null = null;

    // Cosmos DB connection string or endpoint/key
    // You may need to use endpoint and key separately for CosmosClient
    const cosmosEndpoint = process.env.COSMOS_ENDPOINT!;
    const cosmosKey = process.env.COSMOS_KEY!;

    if (cosmosEndpoint && cosmosKey) {
        dbClient = new CosmosClient({ endpoint: cosmosEndpoint, key: cosmosKey });
    }

    return { dbClient };
}

/**
 * Get Cosmos DB client using passwordless authentication (managed identity)
 * This function uses DefaultAzureCredential for authentication instead of API keys
 * 
 * @returns Object containing CosmosClient instance or null if configuration is missing
 */
export function getClientsPasswordless(): { dbClient: CosmosClient | null } {
    let dbClient: CosmosClient | null = null;

    // For Cosmos DB with DefaultAzureCredential
    const cosmosEndpoint = process.env.COSMOS_ENDPOINT!;

    if (cosmosEndpoint) {
        const credential = new DefaultAzureCredential();

        dbClient = new CosmosClient({ 
            endpoint: cosmosEndpoint, 
            aadCredentials: credential
        });
    }

    return { dbClient };
}

// -------------------------------------------
// Document Operations
// -------------------------------------------

/**
 * Generate a unique operation ID for a document
 */
export function generateOperationId(doc: JsonData, idField: string = 'id'): string {
  const baseId = doc[idField] || uuidv4();
  return `${baseId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Validate a document before insertion
 */
export function validateDocument(doc: JsonData, idField: string = 'id', schema?: Record<string, any>): boolean {
  // Basic validation - document must be an object
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return false;
  }

  // Ensure document has an ID field or can generate one
  if (!doc[idField]) {
    // Allow documents without explicit ID as we can generate one
    doc[idField] = uuidv4();
  }

  // Optional schema validation
  if (schema) {
    // Basic schema validation - could be enhanced with more sophisticated validation
    for (const [key, expectedType] of Object.entries(schema)) {
      if (doc[key] && typeof doc[key] !== expectedType) {
        return false;
      }
    }
  }

  return true;
}

// -------------------------------------------
// Utility Functions
// -------------------------------------------

// -------------------------------------------
// Core Insert Operations
// -------------------------------------------

/**
 * Simple batch insert function for basic Cosmos DB operations
 * This is a basic implementation without resilience features
 */
export async function insertData(config: any, container: Container, data: JsonData[]): Promise<{ total: number; inserted: number; failed: number }> {
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
 * Get Azure Cosmos DB database and container (assumes they already exist)
 */
export async function ensureDatabaseAndContainer(
  client: any, 
  databaseName: string, 
  containerName: string, 
  partitionKeyPath: string
): Promise<{ database: any, container: any }> {
  try {
    console.log(`Getting database ${databaseName}...`);
    const database = client.database(databaseName);
    
    console.log(`Getting container ${containerName}...`);
    const container = database.container(containerName);
    
    // Verify the container exists by reading its properties
    const { resource: containerDef } = await container.read();
    
    console.log(`✅ Database: ${databaseName}`);
    console.log(`✅ Container: ${containerName}`);
    console.log(`✅ Partition key: ${containerDef.partitionKey.paths[0]}`);
    
    // Warn if partition key doesn't match expected
    if (containerDef.partitionKey.paths[0] !== partitionKeyPath) {
      console.warn(`⚠️  Warning: Container partition key is ${containerDef.partitionKey.paths[0]} but expected ${partitionKeyPath}`);
    }

    return { database, container };
  } catch (error: any) {
    console.error(`\n❌ ERROR: Cannot access database or container.`);
    console.error(`Error details: ${error.message}\n`);
    console.error(`REQUIRED: Database and container must exist before running this script:\n`);
    console.error(`1. Database name: ${databaseName}`);
    console.error(`2. Container name: ${containerName} `);
    console.error(`3. Partition key: ${partitionKeyPath}\n`);
    console.error(`Create these resources through:`);
    console.error(`- Azure Portal: https://portal.azure.com`);
    console.error(`- Azure CLI: `);
    console.error(`  az cosmosdb sql database create --account-name <your-account> --name ${databaseName} --resource-group <your-resource-group>`);
    console.error(`  az cosmosdb sql container create --account-name <your-account> --database-name ${databaseName} --name ${containerName} --partition-key-path ${partitionKeyPath} --resource-group <your-resource-group>\n`);
    
    throw error;
  }
}

// -------------------------------------------
