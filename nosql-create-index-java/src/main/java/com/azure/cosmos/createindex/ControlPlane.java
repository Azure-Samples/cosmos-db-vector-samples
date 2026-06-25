package com.azure.cosmos.createindex;

import com.azure.core.credential.TokenCredential;
import com.azure.core.management.profile.AzureProfile;
import com.azure.identity.DefaultAzureCredentialBuilder;
import com.azure.resourcemanager.AzureResourceManager;
import com.azure.resourcemanager.cosmos.models.*;
import com.azure.resourcemanager.cosmos.fluent.SqlResourcesClient;
import java.util.Arrays;

/**
 * Control plane example for creating Cosmos DB SQL containers with vector indexes.
 * Demonstrates Goal 1: ARM SDK control-plane usage for container and vector index creation.
 */
public class ControlPlane {
    private static final String DATABASE_NAME = "HotelsCreateIndex";
    private static final String REGION_PARTITION_KEY = "/Region";
    private static final String EMBEDDING_PATH = "/embedding";
    private static final int EMBEDDING_DIMENSIONS = 1536;
    private static final int THROUGHPUT_RUS = 400;
    
    private static final String CONTAINER_DISKANN = "hotels_diskann";
    private static final String CONTAINER_QUANTIZED_FLAT = "hotels_quantizedflat";

    public static void createContainersWithVectorIndexes(
            String subscriptionId,
            String resourceGroup,
            String accountName,
            String location) throws Exception {
        
        System.out.println("\n==> Initializing Azure authentication...");
        TokenCredential credential = new DefaultAzureCredentialBuilder().build();
        
        // Create Azure profile with subscription
        AzureProfile profile = new AzureProfile(com.azure.core.management.AzureEnvironment.AZURE);
        
        // Authenticate and get Azure Resource Manager with subscription
        AzureResourceManager azure = AzureResourceManager
                .authenticate(credential, profile)
                .withSubscription(subscriptionId);
        
        System.out.printf("Subscription: %s%n", azure.subscriptionId());
        System.out.printf("Target:       %s / %s (%s)%n", resourceGroup, accountName, location);
        
        try {
            // Get the SQL resources client from the manager
            SqlResourcesClient sqlResourcesClient = azure.cosmosDBAccounts()
                    .manager()
                    .serviceClient()
                    .getSqlResources();
            
            // Create the database
            System.out.printf("%n==> Creating database '%s' ...%n", DATABASE_NAME);
            sqlResourcesClient.createUpdateSqlDatabase(
                    resourceGroup,
                    accountName,
                    DATABASE_NAME,
                    new SqlDatabaseCreateUpdateParameters()
                            .withLocation(location)
                            .withResource(new SqlDatabaseResource().withId(DATABASE_NAME))
                            .withOptions(new CreateUpdateOptions()));
            
            System.out.println("    database created.");
            
            // Create containers
            createContainer(sqlResourcesClient, resourceGroup, accountName, location,
                    CONTAINER_DISKANN, VectorIndexType.DISK_ANN);
            createContainer(sqlResourcesClient, resourceGroup, accountName, location,
                    CONTAINER_QUANTIZED_FLAT, VectorIndexType.QUANTIZED_FLAT);
            
            System.out.println("\n✓ All containers created successfully with vector indexes.");
            
        } catch (Exception e) {
            System.out.printf("FATAL: %s%n", e.getMessage());
            throw e;
        }
    }
    
    private static void createContainer(
            SqlResourcesClient sqlResourcesClient,
            String resourceGroup,
            String accountName,
            String location,
            String containerName,
            VectorIndexType indexType) throws Exception {
        
        System.out.printf("%n==> Creating container '%s' with %s vector index...%n", 
                containerName, indexType);
        
        // Build vector embedding policy with Cosine distance function
        VectorEmbedding vectorEmbedding = new VectorEmbedding()
                .withPath(EMBEDDING_PATH)
                .withDataType(VectorDataType.FLOAT32)
                .withDimensions(EMBEDDING_DIMENSIONS)
                .withDistanceFunction(DistanceFunction.COSINE);
        
        VectorEmbeddingPolicy vectorEmbeddingPolicy = new VectorEmbeddingPolicy()
                .withVectorEmbeddings(Arrays.asList(vectorEmbedding));
        
        // Build vector index
        VectorIndex vectorIndex = new VectorIndex()
                .withPath(EMBEDDING_PATH)
                .withType(indexType);
        
        // Build indexing policy
        IndexingPolicy indexingPolicy = new IndexingPolicy()
                .withIndexingMode(IndexingMode.CONSISTENT)
                .withAutomatic(true)
                .withIncludedPaths(Arrays.asList(new IncludedPath().withPath("/*")))
                .withExcludedPaths(Arrays.asList(
                        new ExcludedPath().withPath("\"_etag\"/?"),
                        new ExcludedPath().withPath("/embedding/*")))
                .withVectorIndexes(Arrays.asList(vectorIndex));
        
        // Build container resource
        SqlContainerResource containerResource = new SqlContainerResource()
                .withId(containerName)
                .withPartitionKey(new ContainerPartitionKey()
                        .withPaths(Arrays.asList(REGION_PARTITION_KEY))
                        .withKind(PartitionKind.HASH))
                .withVectorEmbeddingPolicy(vectorEmbeddingPolicy)
                .withIndexingPolicy(indexingPolicy);
        
        // Build container creation parameters
        SqlContainerCreateUpdateParameters containerParams = 
                new SqlContainerCreateUpdateParameters()
                        .withLocation(location)
                        .withResource(containerResource)
                        .withOptions(new CreateUpdateOptions().withThroughput(THROUGHPUT_RUS));
        
        try {
            // Create the container
            sqlResourcesClient.createUpdateSqlContainer(
                    resourceGroup,
                    accountName,
                    DATABASE_NAME,
                    containerName,
                    containerParams);
            
            System.out.println("    container created.");
            System.out.printf("✓ Container '%s' ready%n", containerName);
            
        } catch (Exception e) {
            System.out.printf("FATAL: create container %s: %s%n", containerName, e.getMessage());
            throw e;
        }
    }
}
