using Microsoft.Extensions.Configuration;

namespace NosqlCreateIndexDotnet;

public sealed record SampleConfig(
    string SampleRoot,
    string SubscriptionId,
    string ResourceGroup,
    string AccountName,
    string Location,
    string CosmosEndpoint,
    string DatabaseName,
    string DiskANNContainerName,
    string QuantizedFlatContainerName,
    string? ContainerName,
    string OpenAIEmbeddingEndpoint,
    string OpenAIEmbeddingDeployment,
    string OpenAIEmbeddingApiVersion,
    string? VectorAlgorithm,
    string DataFileWithVectors,
    string EmbeddingFieldName,
    string PartitionKeyValue,
    string QueryText,
    int ExpectedDimensions,
    int TopCount)
{
    public IReadOnlyDictionary<string, string> KnownContainers =>
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["diskann"] = DiskANNContainerName,
            ["quantizedflat"] = QuantizedFlatContainerName
        };
}

public static class Config
{
    private const string ProjectFileName = "nosql-create-index-dotnet.csproj";
    private const string DefaultDataFile = "./data/HotelsData_toCosmosDB_Vector_byRegion.json";
    private const string DefaultQueryText = "hotel near the ocean";
    private const string DefaultEmbeddingFieldName = "embedding";
    private const string DefaultPartitionKeyValue = "Northeast";
    private const string DefaultOpenAIEmbeddingApiVersion = "2024-08-01-preview";
    private const string DefaultDiskANNContainerName = "hotels_diskann";
    private const string DefaultQuantizedFlatContainerName = "hotels_quantizedflat";

    public static SampleConfig Load()
    {
        var sampleRoot = ResolveSampleRoot();

        var configuration = new ConfigurationBuilder()
            .SetBasePath(sampleRoot)
            .AddJsonFile("appsettings.json", optional: true, reloadOnChange: false)
            .AddEnvironmentVariables()
            .Build();

        string? GetValue(string envKey, string? appsettingsKey = null)
        {
            return Normalize(configuration[envKey]) ?? Normalize(configuration[appsettingsKey ?? envKey]);
        }

        var dataFileValue =
            GetValue("DATA_FILE_WITH_VECTORS_AND_REGIONS", "DataFilePath")
            ?? GetValue("DATA_FILE_WITH_VECTORS")
            ?? DefaultDataFile;

        return new SampleConfig(
            SampleRoot: sampleRoot,
            SubscriptionId: GetValue("AZURE_SUBSCRIPTION_ID", "CosmosDbSettings:SubscriptionId") ?? string.Empty,
            ResourceGroup: GetValue("AZURE_RESOURCE_GROUP", "CosmosDbSettings:ResourceGroup") ?? string.Empty,
            AccountName: GetValue("AZURE_COSMOSDB_ACCOUNT_NAME", "CosmosDbSettings:AccountName") ?? string.Empty,
            Location: GetValue("AZURE_LOCATION", "CosmosDbSettings:Location") ?? string.Empty,
            CosmosEndpoint: GetValue("AZURE_COSMOSDB_ENDPOINT", "CosmosDbSettings:Endpoint") ?? string.Empty,
            DatabaseName: GetValue("AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME", "CosmosDbSettings:DatabaseName") ?? "HotelsCreateIndex",
            DiskANNContainerName: GetValue("AZURE_COSMOSDB_CREATE_INDEX_DISKANN_CONTAINER_NAME") ?? DefaultDiskANNContainerName,
            QuantizedFlatContainerName: GetValue("AZURE_COSMOSDB_CREATE_INDEX_QUANTIZEDFLAT_CONTAINER_NAME") ?? DefaultQuantizedFlatContainerName,
            ContainerName: GetValue("AZURE_COSMOSDB_CONTAINER_NAME", "CosmosDbSettings:ContainerName"),
            OpenAIEmbeddingEndpoint: GetValue("AZURE_OPENAI_EMBEDDING_ENDPOINT", "OpenAiSettings:Endpoint")
                                    ?? GetValue("AZURE_OPENAI_ENDPOINT")
                                    ?? string.Empty,
            OpenAIEmbeddingDeployment: GetValue("AZURE_OPENAI_EMBEDDING_DEPLOYMENT", "OpenAiSettings:Deployment") ?? string.Empty,
            OpenAIEmbeddingApiVersion: GetValue("AZURE_OPENAI_EMBEDDING_API_VERSION", "OpenAiSettings:ApiVersion") ?? DefaultOpenAIEmbeddingApiVersion,
            VectorAlgorithm: GetValue("VECTOR_ALGORITHM", "VectorAlgorithm")?.ToLowerInvariant(),
            DataFileWithVectors: ResolvePath(sampleRoot, dataFileValue),
            EmbeddingFieldName: GetValue("AZURE_COSMOSDB_CREATE_INDEX_EMBEDDED_FIELD", "EmbeddedField") ?? DefaultEmbeddingFieldName,
            PartitionKeyValue: GetValue("PARTITION_KEY_VALUE", "CosmosDbSettings:PartitionKeyValue") ?? DefaultPartitionKeyValue,
            QueryText: DefaultQueryText,
            ExpectedDimensions: 1536,
            TopCount: 5);
    }

    public static void Validate(SampleConfig config)
    {
        var missing = new List<string>();
        if (string.IsNullOrWhiteSpace(config.CosmosEndpoint)) missing.Add("AZURE_COSMOSDB_ENDPOINT");
        if (string.IsNullOrWhiteSpace(config.DatabaseName)) missing.Add("AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME");
        if (string.IsNullOrWhiteSpace(config.OpenAIEmbeddingEndpoint)) missing.Add("AZURE_OPENAI_EMBEDDING_ENDPOINT");
        if (string.IsNullOrWhiteSpace(config.OpenAIEmbeddingDeployment)) missing.Add("AZURE_OPENAI_EMBEDDING_DEPLOYMENT");
        // ARM SDK variables required for control plane operations
        if (string.IsNullOrWhiteSpace(config.SubscriptionId)) missing.Add("AZURE_SUBSCRIPTION_ID");
        if (string.IsNullOrWhiteSpace(config.ResourceGroup)) missing.Add("AZURE_RESOURCE_GROUP");
        if (string.IsNullOrWhiteSpace(config.AccountName)) missing.Add("AZURE_COSMOSDB_ACCOUNT_NAME");
        if (string.IsNullOrWhiteSpace(config.Location)) missing.Add("AZURE_LOCATION");

        if (missing.Count > 0)
        {
            throw new InvalidOperationException(
                $"Missing required environment variables for control plane operations: {string.Join(", ", missing)}. " +
                "Set values in appsettings.json or as environment variables.");
        }

        if (config.VectorAlgorithm is not null && !config.KnownContainers.ContainsKey(config.VectorAlgorithm))
        {
            throw new InvalidOperationException("VECTOR_ALGORITHM must be one of: diskann, quantizedflat.");
        }

        if (config.ContainerName is not null && !config.KnownContainers.Values.Contains(config.ContainerName, StringComparer.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException($"AZURE_COSMOSDB_CONTAINER_NAME must be one of: {string.Join(", ", config.KnownContainers.Values)}.");
        }

        if (config.ContainerName is not null && config.VectorAlgorithm is not null)
        {
            var expectedContainer = config.KnownContainers[config.VectorAlgorithm];
            if (!string.Equals(config.ContainerName, expectedContainer, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("AZURE_COSMOSDB_CONTAINER_NAME and VECTOR_ALGORITHM refer to different containers.");
            }
        }

        if (!DataPlane.ValidRegions.Contains(config.PartitionKeyValue, StringComparer.Ordinal))
        {
            throw new InvalidOperationException("PARTITION_KEY_VALUE must be one of: Northeast, Midwest, South, West.");
        }

        if (!File.Exists(config.DataFileWithVectors))
        {
            throw new InvalidOperationException($"DATA_FILE_WITH_VECTORS_AND_REGIONS does not exist: {config.DataFileWithVectors}");
        }
    }

    public static IReadOnlyList<string> TargetContainers(SampleConfig config)
    {
        if (!string.IsNullOrWhiteSpace(config.ContainerName))
        {
            return new[] { config.ContainerName };
        }

        if (!string.IsNullOrWhiteSpace(config.VectorAlgorithm))
        {
            return new[] { config.KnownContainers[config.VectorAlgorithm] };
        }

        return config.KnownContainers.Values.ToArray();
    }

    public static string AlgorithmLabel(string containerName)
    {
        return containerName switch
        {
            _ when containerName.Contains("diskann") => "DiskANN",
            _ when containerName.Contains("quantizedflat") => "QuantizedFlat",
            _ => containerName
        };
    }

    private static string ResolveSampleRoot()
    {
        foreach (var startPath in new[] { Directory.GetCurrentDirectory(), AppContext.BaseDirectory })
        {
            var found = FindAncestorContaining(startPath, ProjectFileName);
            if (found is not null)
            {
                return found;
            }
        }

        throw new InvalidOperationException("Could not locate the sample root directory.");
    }

    private static string? FindAncestorContaining(string startPath, string fileName)
    {
        var directory = new DirectoryInfo(startPath);
        if (!directory.Exists && directory.Parent is not null)
        {
            directory = directory.Parent;
        }

        while (directory is not null)
        {
            if (File.Exists(Path.Combine(directory.FullName, fileName)))
            {
                return directory.FullName;
            }

            directory = directory.Parent;
        }

        return null;
    }

    private static string ResolvePath(string sampleRoot, string value)
    {
        if (Path.IsPathRooted(value))
        {
            return value;
        }

        return Path.GetFullPath(Path.Combine(sampleRoot, value));
    }

    private static string? Normalize(string? value)
    {
        var trimmed = value?.Trim();
        return string.IsNullOrWhiteSpace(trimmed) ? null : trimmed;
    }
}
