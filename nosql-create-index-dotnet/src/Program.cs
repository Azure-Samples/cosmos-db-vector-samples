using Azure.Identity;
using NosqlCreateIndexDotnet;

var cancellationToken = CancellationToken.None;

try
{
    var config = Config.Load();
    Config.Validate(config);

    Console.WriteLine(new string('=', 72));
    Console.WriteLine("Azure Cosmos DB for NoSQL - create and query vector indexes with .NET");
    Console.WriteLine(new string('=', 72));
    Console.WriteLine($"Database: {config.DatabaseName}");
    Console.WriteLine($"Data file: {config.DataFileWithVectors}");
    Console.WriteLine($"Target containers: {string.Join(", ", Config.TargetContainers(config))}");

    var credential = new DefaultAzureCredential();
    using var cosmosClient = DataPlane.CreateCosmosClient(config, credential);
    var azureOpenAIClient = DataPlane.CreateAzureOpenAIClient(config, credential);
    var database = cosmosClient.GetDatabase(config.DatabaseName);

    await DataPlane.VerifyEmbeddingDimensionsAsync(azureOpenAIClient, config, cancellationToken);
    var documents = await DataPlane.ReadDocumentsAsync(config.DataFileWithVectors, cancellationToken);

    foreach (var containerName in Config.TargetContainers(config))
    {
        var container = database.GetContainer(containerName);
        await DataPlane.IngestDocumentsAsync(container, containerName, documents, cancellationToken);
    }

    var queryEmbedding = await DataPlane.GenerateEmbeddingAsync(azureOpenAIClient, config, config.QueryText, cancellationToken);
    Console.WriteLine($"\nQuery text: {config.QueryText}");

    foreach (var containerName in Config.TargetContainers(config))
    {
        var container = database.GetContainer(containerName);
        var summary = await DataPlane.QueryTopMatchesAsync(container, containerName, config, queryEmbedding, cancellationToken);

        Console.WriteLine($"\n=== Query results: {summary.ContainerName} ({Config.AlgorithmLabel(summary.ContainerName)}) ===");
        if (!string.IsNullOrWhiteSpace(summary.ActivityId))
        {
            Console.WriteLine($"Activity ID: {summary.ActivityId}");
        }

        Console.WriteLine($"Request charge: {summary.RequestCharge:F2} RUs");
        var rank = 1;
        foreach (var result in summary.Results)
        {
            Console.WriteLine($"{rank}. HotelId={result.HotelId} | HotelName={result.HotelName} | score={result.SimilarityScore:F4} | Description={Shorten(result.Description)}");
            rank++;
        }
    }

    Console.WriteLine();
    Console.WriteLine(new string('=', 72));
    Console.WriteLine("Complete");
    Console.WriteLine(new string('=', 72));
}
catch (Exception exception)
{
    var wrappedException = DataPlane.WrapRuntimeException(exception);
    Console.Error.WriteLine();
    Console.Error.WriteLine($"Error: {wrappedException.Message}");
    Environment.ExitCode = 1;
}

static string Shorten(string value, int limit = 110)
{
    if (value.Length <= limit)
    {
        return value;
    }

    return value[..(limit - 3)].TrimEnd() + "...";
}
