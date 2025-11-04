/**
 * Azure Cosmos DB Low-Level Operations Module
 * 
 * This module contains core Cosmos DB NoSQL operations including:
 * - Client creation and authentication
 * - Document validation and preparation
 * - Database and container management
 * - Basic CRUD operations using executeBulkOperations API
 * - Generic bulk operation execution with timeout and error handling
 */
import { Container, CosmosClient, BulkOperationType, OperationInput } from '@azure/cosmos';
import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";
import { v4 as uuidv4 } from 'uuid';
import { JsonData } from './utils.js';

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
 * Query all documents in a container for deletion
 * Returns only id and partition key for efficient bulk delete operations
 */
export async function queryAllDocumentRefs(container: Container, partitionKeyPath: string): Promise<{ id: string; partitionKey: any }[]> {
    try {
        // Extract partition key field name from path (remove leading /)
        const partitionKeyField = partitionKeyPath.slice(1);
        
        // Query all documents but only fetch id and partition key for efficient deletion
        const querySpec = {
            query: `SELECT c.id, c["${partitionKeyField}"] as partitionKey FROM c`
        };

        console.log(`🔍 Querying document references from container...`);
        const { resources: documents } = await container.items.query(querySpec).fetchAll();
        
        console.log(`✅ Found ${documents.length} document references`);
        
        return documents.map(doc => ({
            id: doc.id,
            partitionKey: doc.partitionKey
        }));
    } catch (error) {
        console.error(`❌ Failed to query document references:`, error);
        throw error;
    }
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
// Generic Bulk Operations
// -------------------------------------------

/**
 * Configuration for bulk operation execution
 */
export interface BulkExecutionConfig {
  /** Timeout for bulk operations in milliseconds */
  timeoutMs: number;
  /** Enable debug logging */
  enableDebugLogging?: boolean;
}

/**
 * Result of a bulk operation execution
 */
export interface BulkExecutionResult {
  /** The response from executeBulkOperations */
  bulkResponse: any[];
  /** Latency of the operation in milliseconds */
  latency: number;
  /** Any error that occurred during execution */
  error?: Error;
}

/**
 * Generic function to execute bulk operations with timeout and error handling
 * 
 * This function handles the common pattern of:
 * 1. Executing bulk operations with a timeout
 * 2. Logging operation summary
 * 3. Returning standardized results
 * 
 * @param container - Cosmos DB container instance
 * @param bulkOperations - Array of bulk operations to execute
 * @param config - Configuration for the bulk execution
 * @returns Promise<BulkExecutionResult> with response, latency, and any errors
 */
export async function executeBulkOperationsWithTimeout(
  container: Container,
  bulkOperations: OperationInput[],
  config: BulkExecutionConfig
): Promise<BulkExecutionResult> {
  const startTime = Date.now();
  
  try {
    // Execute bulk operations with timeout
    // SDK automatically handles retries for: 408, 410, 429, 449, 503
    const bulkPromise = container.items.executeBulkOperations(bulkOperations);
    
    let timeoutId: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Bulk operation timeout')), config.timeoutMs);
    });

    const bulkResponse = await Promise.race([bulkPromise, timeoutPromise]) as any;
    if (timeoutId) clearTimeout(timeoutId); // Clean up timeout if operation completes first
    const latency = Date.now() - startTime;

    // Debug logging if enabled
    if (config.enableDebugLogging) {
      console.log(`📋 Bulk operation completed for document group with ${bulkOperations.length} operations`);
      console.log(`   Response length: ${bulkResponse.length}`);
      
      // Count status codes for quick overview
      const statusCounts: { [key: string]: number } = {};
      bulkResponse.forEach((result: any) => {
        // BulkOperationResult has response property containing the statusCode
        const status = result.response?.statusCode || (result.error ? 'error' : 'unknown');
        statusCounts[status] = (statusCounts[status] || 0) + 1;
      });
      console.log(`   Status code summary:`, statusCounts);
    }

    return {
      bulkResponse,
      latency
    };

  } catch (error: any) {
    const latency = Date.now() - startTime;
    
    return {
      bulkResponse: [],
      latency,
      error
    };
  }
}

// -------------------------------------------
