using Microsoft.Extensions.Configuration;

namespace NosqlCreateIndexDotnet;

public sealed record SampleConfig(
    string SampleRoot,
    string CosmosEndpoint,
    string DatabaseName,
    string? ContainerName,
    string OpenAIEmbeddingEndpoint,
    string OpenAIEmbeddingDeployment,
    string OpenAIEmbeddingApiVersion,
    string? VectorAlgorithm,
    string DataFileWithVectors,
    string EmbeddingFieldName,
    string QueryText,
    int ExpectedDimensions,
    int TopCount)
{
    public static readonly IReadOnlyDictionary<string, string> KnownContainers =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["diskann"] = "hotels_diskann",
            ["quantizedflat"] = "hotels_quantizedflat"
        };
}

public static class Config
{
    private const string ProjectFileName = "nosql-create-index-dotnet.csproj";
    private const string DefaultDataFile = "../data/HotelsData_toCosmosDB_Vector.json";
    private const string DefaultQueryText = "hotel near the ocean";
    private const string DefaultEmbeddingFieldName = "DescriptionVector";
    private const string DefaultOpenAIEmbeddingApiVersion = "2024-08-01-preview";

    public static SampleConfig Load()
    {
        var sampleRoot = ResolveSampleRoot();

        var configuration = new ConfigurationBuilder()
            .SetBasePath(sampleRoot)
            .AddJsonFile("appsettings.json", optional: false, reloadOnChange: false)
            .AddEnvironmentVariables()
            .Build();

        var dataFileValue = Normalize(configuration["DATA_FILE_WITH_VECTORS"]) ?? DefaultDataFile;

        return new SampleConfig(
            SampleRoot: sampleRoot,
            CosmosEndpoint: Normalize(configuration["AZURE_COSMOSDB_ENDPOINT"]) ?? string.Empty,
            DatabaseName: Normalize(configuration["AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME"]) ?? string.Empty,
            ContainerName: Normalize(configuration["AZURE_COSMOSDB_CONTAINER_NAME"]),
            OpenAIEmbeddingEndpoint: Normalize(configuration["AZURE_OPENAI_EMBEDDING_ENDPOINT"]) ?? string.Empty,
            OpenAIEmbeddingDeployment: Normalize(configuration["AZURE_OPENAI_EMBEDDING_DEPLOYMENT"]) ?? string.Empty,
            OpenAIEmbeddingApiVersion: Normalize(configuration["AZURE_OPENAI_EMBEDDING_API_VERSION"]) ?? DefaultOpenAIEmbeddingApiVersion,
            VectorAlgorithm: Normalize(configuration["VECTOR_ALGORITHM"])?.ToLowerInvariant(),
            DataFileWithVectors: ResolvePath(sampleRoot, dataFileValue),
            EmbeddingFieldName: DefaultEmbeddingFieldName,
            QueryText: DefaultQueryText,
            ExpectedDimensions: 1536,
            TopCount: 5);
    }

    public static void Validate(SampleConfig config)
    {
        var missing = new List<string>();
        if (string.IsNullOrWhiteSpace(config.CosmosEndpoint)) missing.Add("AZURE_COSMOSDB_ENDPOINT");
        if (string.IsNullOrWhiteSpace(config.DatabaseName)) missing.Add("AZURE_COSMOSDB_DATABASENAME");
        if (string.IsNullOrWhiteSpace(config.OpenAIEmbeddingEndpoint)) missing.Add("AZURE_OPENAI_EMBEDDING_ENDPOINT");
        if (string.IsNullOrWhiteSpace(config.OpenAIEmbeddingDeployment)) missing.Add("AZURE_OPENAI_EMBEDDING_DEPLOYMENT");

        if (missing.Count > 0)
        {
            throw new InvalidOperationException(
                $"Missing required configuration: {string.Join(", ", missing)}. " +
                "Set values in appsettings.json or as environment variables.");
        }

        if (config.VectorAlgorithm is not null && !SampleConfig.KnownContainers.ContainsKey(config.VectorAlgorithm))
        {
            throw new InvalidOperationException("VECTOR_ALGORITHM must be one of: diskann, quantizedflat.");
        }

        if (config.ContainerName is not null && !SampleConfig.KnownContainers.Values.Contains(config.ContainerName, StringComparer.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("AZURE_COSMOSDB_CONTAINER_NAME must be one of: hotels_diskann, hotels_quantizedflat.");
        }

        if (config.ContainerName is not null && config.VectorAlgorithm is not null)
        {
            var expectedContainer = SampleConfig.KnownContainers[config.VectorAlgorithm];
            if (!string.Equals(config.ContainerName, expectedContainer, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("AZURE_COSMOSDB_CONTAINER_NAME and VECTOR_ALGORITHM refer to different containers.");
            }
        }

        if (!File.Exists(config.DataFileWithVectors))
        {
            throw new InvalidOperationException($"DATA_FILE_WITH_VECTORS does not exist: {config.DataFileWithVectors}");
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
            return new[] { SampleConfig.KnownContainers[config.VectorAlgorithm] };
        }

        return SampleConfig.KnownContainers.Values.ToArray();
    }

    public static string AlgorithmLabel(string containerName)
    {
        return containerName switch
        {
            "hotels_diskann" => "DiskANN",
            "hotels_quantizedflat" => "QuantizedFlat",
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
