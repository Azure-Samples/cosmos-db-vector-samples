using Azure;
using Azure.Core;
using Azure.Identity;
using Azure.ResourceManager;
using Azure.ResourceManager.CosmosDB;
using Azure.ResourceManager.CosmosDB.Models;

namespace NosqlCreateIndexDotnet;

public static class ControlPlane
{
    private const string PartitionKeyPath = "/Region";
    private const string EmbeddingPath = "/embedding";

    public static Task CreateContainersAsync(SampleConfig config, CancellationToken cancellationToken = default)
    {
        return CreateContainersAsync(config, new DefaultAzureCredential(), cancellationToken);
    }

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

        foreach (var containerName in Config.TargetContainers(config))
        {
            Console.WriteLine("\n=== Phase 1: Create Containers with ARM SDK ===");
            Console.WriteLine($"  Container:      {containerName}");
            Console.WriteLine($"  Partition key:  {PartitionKeyPath}");
            Console.WriteLine($"  Vector field:   {EmbeddingPath}");
            Console.WriteLine($"  Dimensions:     {config.ExpectedDimensions}");
            Console.WriteLine("  Distance func:  cosine");

            await DeleteContainerIfExistsAsync(containers, containerName, cancellationToken);

            var containerDefinition = BuildContainerDefinition(containerName, config.ExpectedDimensions, account.Value.Data.Location);
            await containers.CreateOrUpdateAsync(WaitUntil.Completed, containerName, containerDefinition, cancellationToken);

            Console.WriteLine("  Created container with DiskANN + QuantizedFlat vector index policy");
        }
    }

    private static CosmosDBSqlContainerCreateOrUpdateContent BuildContainerDefinition(
        string containerName,
        int dimensions,
        AzureLocation location)
    {
        var indexingPolicy = new CosmosDBIndexingPolicy
        {
            IsAutomatic = true,
            IndexingMode = CosmosDBIndexingMode.Consistent
        };
        indexingPolicy.IncludedPaths.Add(new CosmosDBIncludedPath
        {
            Path = "/*"
        });
        indexingPolicy.ExcludedPaths.Add(new CosmosDBExcludedPath
        {
            Path = "/_etag/?"
        });
        indexingPolicy.VectorIndexes.Add(new CosmosDBVectorIndex(EmbeddingPath, CosmosDBVectorIndexType.DiskAnn));
        indexingPolicy.VectorIndexes.Add(new CosmosDBVectorIndex(EmbeddingPath, CosmosDBVectorIndexType.QuantizedFlat));

        var resource = new CosmosDBSqlContainerResourceInfo(containerName)
        {
            PartitionKey = new CosmosDBContainerPartitionKey
            {
                Kind = CosmosDBPartitionKind.Hash,
                Version = 2
            },
            IndexingPolicy = indexingPolicy
        };
        resource.PartitionKey.Paths.Add(PartitionKeyPath);
        resource.VectorEmbeddings.Add(
            new CosmosDBVectorEmbedding(
                EmbeddingPath,
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
        var existingContainer = await containers.GetIfExistsAsync(containerName, cancellationToken);
        if (existingContainer.HasValue)
        {
            Console.WriteLine("  Deleting existing container to refresh immutable vector indexes...");
            var containerResource = existingContainer.Value!;
            await containerResource.DeleteAsync(WaitUntil.Completed, cancellationToken);
        }
        else
        {
            Console.WriteLine("  Container does not exist yet (OK)");
        }
    }
}
