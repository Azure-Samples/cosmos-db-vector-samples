using Azure;
using Azure.Core;
using Azure.Identity;
using Azure.ResourceManager;
using Azure.ResourceManager.CosmosDB;
using Azure.ResourceManager.CosmosDB.Models;

namespace NosqlCreateIndexDotnet;

/// <summary>
/// Control-plane operations using Azure.ResourceManager.CosmosDB (ARM SDK).
/// 
///   1. Create containers with vector indexes (hotels_diskann, hotels_quantizedflat)
///   2. Clean up sample-created containers
/// 
/// RBAC Setup:
/// - Role definitions and assignments are created by `azd up` via Bicep
/// - Sample code uses DefaultAzureCredential() for authentication
/// - No RBAC creation code is needed in the sample
/// </summary>
public static class ControlPlane
{
    private const string PartitionKeyPath = "/Region";

    public static async Task CreateContainersAsync(
        SampleConfig config,
        TokenCredential credential,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(config);
        ArgumentNullException.ThrowIfNull(credential);

        var armClient = new ArmClient(credential);
        var accountIdentifier = CosmosDBAccountResource.CreateResourceIdentifier(
            config.SubscriptionId,
            config.ResourceGroup,
            config.AccountName);

        var accountResource = armClient.GetCosmosDBAccountResource(accountIdentifier);
        var account = await accountResource.GetAsync(cancellationToken);
        var database = await account.Value.GetCosmosDBSqlDatabaseAsync(config.DatabaseName, cancellationToken);
        var containers = database.Value.GetCosmosDBSqlContainers();

        var embeddingPath = $"/{config.EmbeddingFieldName}";

        // Create separate containers for each index type
        var indexConfigs = new[]
        {
            (Name: config.DiskANNContainerName, IndexType: CosmosDBVectorIndexType.DiskAnn),
            (Name: config.QuantizedFlatContainerName, IndexType: CosmosDBVectorIndexType.QuantizedFlat)
        };

        foreach (var indexConfig in indexConfigs)
        {
            Console.WriteLine("\n=== Step 1: Create Container with Vector Index ===");
            Console.WriteLine($"  Container:      {indexConfig.Name}");
            Console.WriteLine($"  Index type:     {indexConfig.IndexType}");
            Console.WriteLine($"  Dimensions:     {config.ExpectedDimensions}");
            Console.WriteLine($"  Distance func:  cosine (queried with all 3 metrics)");

            await DeleteContainerIfExistsAsync(containers, indexConfig.Name, cancellationToken);

            var start = DateTime.UtcNow;
            var containerDefinition = BuildContainerDefinition(
                indexConfig.Name, 
                indexConfig.IndexType,
                embeddingPath,
                config.ExpectedDimensions, 
                account.Value.Data.Location);
            
            await containers.CreateOrUpdateAsync(WaitUntil.Completed, indexConfig.Name, containerDefinition, cancellationToken);

            var elapsed = (DateTime.UtcNow - start).TotalSeconds;
            Console.WriteLine($"  Created in {elapsed:F1}s");
            Console.WriteLine("  Vector index is IMMUTABLE — cannot be changed after creation");
        }
    }

    public static async Task CleanupContainersAsync(
        SampleConfig config,
        TokenCredential credential,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(config);
        ArgumentNullException.ThrowIfNull(credential);

        var armClient = new ArmClient(credential);
        var accountIdentifier = CosmosDBAccountResource.CreateResourceIdentifier(
            config.SubscriptionId,
            config.ResourceGroup,
            config.AccountName);

        var accountResource = armClient.GetCosmosDBAccountResource(accountIdentifier);
        var account = await accountResource.GetAsync(cancellationToken);
        var database = await account.Value.GetCosmosDBSqlDatabaseAsync(config.DatabaseName, cancellationToken);
        var containers = database.Value.GetCosmosDBSqlContainers();

        var containerNames = new[] { config.DiskANNContainerName, config.QuantizedFlatContainerName };

        Console.WriteLine("\n=== Cleanup: Remove Sample Containers ===");
        foreach (var containerName in containerNames)
        {
            try
            {
                var existingContainer = await containers.GetIfExistsAsync(containerName, cancellationToken);
                if (existingContainer.HasValue)
                {
                    await existingContainer.Value!.DeleteAsync(WaitUntil.Completed, cancellationToken);
                    Console.WriteLine($"  ✓ Deleted container: {containerName}");
                }
                else
                {
                    Console.WriteLine($"  ✓ Container does not exist: {containerName}");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"  ⚠ Failed to delete {containerName}: {ex.Message}");
            }
        }
    }

    private static CosmosDBSqlContainerCreateOrUpdateContent BuildContainerDefinition(
        string containerName,
        CosmosDBVectorIndexType indexType,
        string embeddingPath,
        int dimensions,
        AzureLocation location)
    {
        var indexingPolicy = new CosmosDBIndexingPolicy
        {
            IsAutomatic = true,
            IndexingMode = CosmosDBIndexingMode.Consistent
        };
        indexingPolicy.IncludedPaths.Add(new CosmosDBIncludedPath { Path = "/*" });
        indexingPolicy.ExcludedPaths.Add(new CosmosDBExcludedPath { Path = "/_etag/?" });
        indexingPolicy.ExcludedPaths.Add(new CosmosDBExcludedPath { Path = $"{embeddingPath}/*" });
        indexingPolicy.VectorIndexes.Add(new CosmosDBVectorIndex(embeddingPath, indexType));

        var resource = new CosmosDBSqlContainerResourceInfo(containerName)
        {
            PartitionKey = new CosmosDBContainerPartitionKey
            {
                Kind = CosmosDBPartitionKind.MultiHash,
                Version = 2
            },
            IndexingPolicy = indexingPolicy
        };
        resource.PartitionKey.Paths.Add(PartitionKeyPath);
        resource.VectorEmbeddings.Add(
            new CosmosDBVectorEmbedding(
                embeddingPath,
                CosmosDBVectorDataType.Float32,
                VectorDistanceFunction.Cosine,
                dimensions));

        return new CosmosDBSqlContainerCreateOrUpdateContent(location, resource);
    }

    private static async Task DeleteContainerIfExistsAsync(
        CosmosDBSqlContainerCollection containers,
        string containerName,
        CancellationToken cancellationToken)
    {
        Console.WriteLine("  Deleting existing container if present...");
        var existingContainer = await containers.GetIfExistsAsync(containerName, cancellationToken);
        if (existingContainer.HasValue)
        {
            await existingContainer.Value!.DeleteAsync(WaitUntil.Completed, cancellationToken);
            Console.WriteLine("  Deleted existing container");
        }
        else
        {
            Console.WriteLine("  Container does not exist (OK)");
        }
    }
}
