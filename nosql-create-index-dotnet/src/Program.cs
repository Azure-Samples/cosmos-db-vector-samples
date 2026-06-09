using Azure.Identity;
using NosqlCreateIndexDotnet;

var cancellationToken = CancellationToken.None;

try
{
    var config = Config.Load();
    Config.Validate(config);

    var credential = new DefaultAzureCredential();
    using var cosmosClient = DataPlane.CreateCosmosClient(config, credential);
    var azureOpenAIClient = DataPlane.CreateAzureOpenAIClient(config, credential);
    var database = cosmosClient.GetDatabase(config.DatabaseName);

    // --- Setup ---
    Console.WriteLine($"Using Azure OpenAI Embedding Deployment/Model: {config.OpenAIEmbeddingDeployment}");
    Console.WriteLine($"Reading JSON file from {config.DataFileWithVectors}");

    await DataPlane.VerifyEmbeddingDimensionsAsync(azureOpenAIClient, config, cancellationToken);
    var documents = await DataPlane.ReadDocumentsAsync(config.DataFileWithVectors, cancellationToken);
    Console.WriteLine($"Loaded {documents.Count} documents");

    // --- Ingest ---
    Console.WriteLine($"Processing in batches of {documents.Count}...");
    foreach (var containerName in Config.TargetContainers(config))
    {
        var container = database.GetContainer(containerName);
        var summary = await DataPlane.IngestDocumentsAsync(container, containerName, documents, cancellationToken);
        if (summary.SkippedContainer)
        {
            Console.WriteLine($"  \u2713 {containerName}: {summary.TotalDocuments} documents already exist (skipped)");
        }
        else
        {
            Console.WriteLine($"  \u2713 {containerName}: {summary.InsertedDocuments} inserted ({summary.RequestCharge:F2} RUs)");
        }
    }

    // --- Query ---
    var queryEmbedding = await DataPlane.GenerateEmbeddingAsync(azureOpenAIClient, config, config.QueryText, cancellationToken);
    Console.WriteLine($"\nQuery: \"{config.QueryText}\"");
    Console.WriteLine($"Embedding generated ({queryEmbedding.Length} dimensions)");
    Console.WriteLine($"\nRunning searches (top 5 results)...");

    var allResults = new List<(string Label, DataPlane.QuerySummary Summary)>();
    foreach (var containerName in Config.TargetContainers(config))
    {
        var container = database.GetContainer(containerName);
        var summary = await DataPlane.QueryTopMatchesAsync(container, containerName, config, queryEmbedding, cancellationToken);
        var label = Config.AlgorithmLabel(containerName);
        Console.WriteLine($"  \u2713 {containerName} queried ({summary.RequestCharge:F2} RUs)");
        allResults.Add((label, summary));
    }

    // --- Comparison table ---
    Console.WriteLine();
    Console.WriteLine($"| {"Algorithm",-14} | {"Top 1 Result",-26} | {"Score",-6} | {"Top 2 Result",-26} | {"Score",-6} | {"Diff",-6} |");
    Console.WriteLine($"|{new string('-', 16)}|{new string('-', 28)}|{new string('-', 8)}|{new string('-', 28)}|{new string('-', 8)}|{new string('-', 8)}|");
    foreach (var (label, summary) in allResults)
    {
        var top1Name = summary.Results.Count > 0 ? Shorten(summary.Results[0].HotelName, 26) : "";
        var top1Score = summary.Results.Count > 0 ? summary.Results[0].SimilarityScore : 0.0;
        var top2Name = summary.Results.Count > 1 ? Shorten(summary.Results[1].HotelName, 26) : "";
        var top2Score = summary.Results.Count > 1 ? summary.Results[1].SimilarityScore : 0.0;
        var diff = top1Score - top2Score;
        Console.WriteLine($"| {label,-14} | {top1Name,-26} | {top1Score:F4} | {top2Name,-26} | {top2Score:F4} | {diff:F4} |");
    }

    Console.WriteLine("\nComplete");
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
