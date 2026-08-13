package com.azure.cosmos.createindex;

import com.azure.core.credential.TokenCredential;
import com.azure.core.management.AzureEnvironment;
import com.azure.core.management.exception.ManagementException;
import com.azure.core.management.profile.AzureProfile;
import com.azure.resourcemanager.AzureResourceManager;
import com.azure.resourcemanager.cosmos.models.*;
import com.azure.resourcemanager.cosmos.fluent.SqlResourcesClient;
import java.util.Arrays;

/**
 * Control plane example for creating Cosmos DB SQL containers with vector indexes.
 * Demonstrates ARM SDK control-plane usage for container and vector index creation.
 * The database is assumed to already exist (created by azd up).
 */
public class ControlPlane {
    private static final String REGION_PARTITION_KEY = "/Region";
    private static final int EMBEDDING_DIMENSIONS = 1536;

    public static void createContainersWithVectorIndexes(
            TokenCredential credential,
            String subscriptionId,
            String resourceGroup,
            String accountName,
            String location,
            String databaseName,
            String embeddingFieldName,
            String diskannContainerName,
            String quantizedflatContainerName) throws Exception {

        AzureProfile profile = new AzureProfile(AzureEnvironment.AZURE);
        AzureResourceManager azure = AzureResourceManager
                .authenticate(credential, profile)
                .withSubscription(subscriptionId);

        SqlResourcesClient sqlResourcesClient = azure.cosmosDBAccounts()
                .manager()
                .serviceClient()
                .getSqlResources();

        String embeddingPath = "/" + embeddingFieldName;

        createContainer(sqlResourcesClient, resourceGroup, accountName, location,
                databaseName, embeddingPath, diskannContainerName, VectorIndexType.DISK_ANN);
        createContainer(sqlResourcesClient, resourceGroup, accountName, location,
                databaseName, embeddingPath, quantizedflatContainerName, VectorIndexType.QUANTIZED_FLAT);
    }

    private static void createContainer(
            SqlResourcesClient sqlResourcesClient,
            String resourceGroup,
            String accountName,
            String location,
            String databaseName,
            String embeddingPath,
            String containerName,
            VectorIndexType indexType) throws Exception {

        String indexLabel = indexType == VectorIndexType.DISK_ANN ? "diskANN" : "quantizedFlat";

        System.out.println("\n=== Step 1: Create Container with Vector Index ===");
        System.out.printf("  Container:      %s%n", containerName);
        System.out.printf("  Index type:     %s%n", indexLabel);
        System.out.printf("  Dimensions:     %d%n", EMBEDDING_DIMENSIONS);
        System.out.println("  Distance func:  cosine (queried with all 3 metrics)");

        System.out.println("  Deleting existing container if present...");
        try {
            sqlResourcesClient.getSqlContainer(resourceGroup, accountName, databaseName, containerName);
            sqlResourcesClient.deleteSqlContainer(resourceGroup, accountName, databaseName, containerName);
            System.out.println("  Deleted existing container");
        } catch (ManagementException e) {
            if (e.getResponse() != null && e.getResponse().getStatusCode() == 404) {
                System.out.println("  Container does not exist (OK)");
            } else {
                throw e;
            }
        }

        long startMs = System.currentTimeMillis();

        VectorEmbedding vectorEmbedding = new VectorEmbedding()
                .withPath(embeddingPath)
                .withDataType(VectorDataType.FLOAT32)
                .withDimensions(EMBEDDING_DIMENSIONS)
                .withDistanceFunction(DistanceFunction.COSINE);

        VectorEmbeddingPolicy vectorEmbeddingPolicy = new VectorEmbeddingPolicy()
                .withVectorEmbeddings(Arrays.asList(vectorEmbedding));

        VectorIndex vectorIndex = new VectorIndex()
                .withPath(embeddingPath)
                .withType(indexType);

        IndexingPolicy indexingPolicy = new IndexingPolicy()
                .withIndexingMode(IndexingMode.CONSISTENT)
                .withAutomatic(true)
                .withIncludedPaths(Arrays.asList(new IncludedPath().withPath("/*")))
                .withExcludedPaths(Arrays.asList(
                        new ExcludedPath().withPath("/_etag/?"),
                        new ExcludedPath().withPath(embeddingPath + "/*")))
                .withVectorIndexes(Arrays.asList(vectorIndex));

        SqlContainerResource containerResource = new SqlContainerResource()
                .withId(containerName)
                .withPartitionKey(new ContainerPartitionKey()
                        .withPaths(Arrays.asList(REGION_PARTITION_KEY))
                        .withKind(PartitionKind.HASH))
                .withVectorEmbeddingPolicy(vectorEmbeddingPolicy)
                .withIndexingPolicy(indexingPolicy);

        SqlContainerCreateUpdateParameters containerParams = new SqlContainerCreateUpdateParameters()
                .withLocation(location)
                .withResource(containerResource)
                .withOptions(new CreateUpdateOptions());

        sqlResourcesClient.createUpdateSqlContainer(
                resourceGroup, accountName, databaseName, containerName, containerParams);

        double elapsed = (System.currentTimeMillis() - startMs) / 1000.0;
        System.out.printf("  Created in %.1fs%n", elapsed);
        System.out.println("  Vector index is IMMUTABLE \u2014 cannot be changed after creation");
    }

    public static void cleanupContainers(
            TokenCredential credential,
            String subscriptionId,
            String resourceGroup,
            String accountName,
            String databaseName,
            String diskannContainerName,
            String quantizedflatContainerName) {

        System.out.println("\n=== Cleanup: Remove Sample Containers ===");

        AzureProfile profile = new AzureProfile(AzureEnvironment.AZURE);
        AzureResourceManager azure;
        try {
            azure = AzureResourceManager
                    .authenticate(credential, profile)
                    .withSubscription(subscriptionId);
        } catch (Exception e) {
            System.out.printf("  \u26a0 Failed to authenticate for cleanup: %s%n", e.getMessage());
            return;
        }

        SqlResourcesClient sqlResourcesClient = azure.cosmosDBAccounts()
                .manager()
                .serviceClient()
                .getSqlResources();

        for (String containerName : new String[]{diskannContainerName, quantizedflatContainerName}) {
            try {
                sqlResourcesClient.getSqlContainer(resourceGroup, accountName, databaseName, containerName);
                sqlResourcesClient.deleteSqlContainer(resourceGroup, accountName, databaseName, containerName);
                System.out.printf("  \u2713 Deleted container: %s%n", containerName);
            } catch (ManagementException e) {
                if (e.getResponse() != null && e.getResponse().getStatusCode() == 404) {
                    System.out.printf("  \u2713 Container does not exist: %s%n", containerName);
                } else {
                    System.out.printf("  \u26a0 Failed to delete %s: %s%n", containerName, e.getMessage());
                }
            } catch (Exception e) {
                System.out.printf("  \u26a0 Failed to delete %s: %s%n", containerName, e.getMessage());
            }
        }
    }
}
