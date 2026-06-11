using Azure.AI.OpenAI;
using Azure.Identity;
using CosmosDbVectorSamples.Models;
using Microsoft.Azure.Cosmos;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using System.Reflection;

namespace CosmosDbVectorSamples.Services.VectorSearch;

/// <summary>
/// Service for performing vector similarity searches using Cosmos DB NoSQL.
/// </summary>
public class VectorSearchService
{
    private readonly ILogger<VectorSearchService> _logger;
    private readonly AzureOpenAIClient _openAIClient;
    private readonly CosmosDbService _cosmosService;
    private readonly AppConfiguration _config;
    private static readonly List<string> ValidDistanceFunctions = new() { "cosine", "euclidean", "dotproduct" };
    private static readonly Dictionary<string, string> MetricLabels = new()
    {
        ["cosine"] = "COS",
        ["euclidean"] = "L2",
        ["dotproduct"] = "IP"
    };
    private static readonly VectorIndexType[] ComparisonAlgorithms = { VectorIndexType.DiskANN, VectorIndexType.QuantizedFlat };

    public VectorSearchService(ILogger<VectorSearchService> logger, CosmosDbService cosmosService, AppConfiguration config)
    {
        _logger = logger;
        _cosmosService = cosmosService;
        _config = config;
        
        _openAIClient = new AzureOpenAIClient(new Uri(_config.AzureOpenAI.Endpoint), new DefaultAzureCredential());
    }

    /// <summary>
    /// Executes a complete vector search workflow: data setup, index creation, query embedding, and search
    /// </summary>
    public async Task RunSearchAsync(VectorIndexType indexType)
    {
        try
        {
            // Create embedding for the query
            var embeddingClient = _openAIClient.GetEmbeddingClient(_config.AzureOpenAI.EmbeddingModel);
            var queryEmbedding = (await embeddingClient.GenerateEmbeddingAsync(_config.VectorSearch.Query)).Value.ToFloats().ToArray();
            _logger.LogInformation($"Generated query embedding with {queryEmbedding.Length} dimensions");

            // Check for comparison mode
            var compareMetrics = "true".Equals(Environment.GetEnvironmentVariable("COMPARE_DISTANCE_METRICS"), StringComparison.OrdinalIgnoreCase);
            var distanceFunction = (Environment.GetEnvironmentVariable("VECTOR_DISTANCE_FUNCTION") ?? "cosine").ToLower();

            if (compareMetrics)
            {
                _logger.LogInformation("Comparison Mode: metrics across DiskANN and QuantizedFlat");
                await RunMetricComparison(queryEmbedding);
            }
            else
            {
                _logger.LogInformation($"Starting {indexType} vector search workflow");
                var container = await PrepareContainerAsync(indexType);
                await RunSingleMetricQuery(container, queryEmbedding, distanceFunction, indexType);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, $"{indexType} vector search failed");
            throw;
        }
    }

    private async Task<Container> PrepareContainerAsync(VectorIndexType indexType)
    {
        var containerName = GetContainerName(indexType);

        await _cosmosService.CreateVectorIndexAsync(
            _config.CosmosDb.DatabaseName,
            containerName,
            _config.Embedding.EmbeddedField,
            indexType,
            _config.Embedding.Dimensions);

        var container = await _cosmosService.GetContainerAsync(_config.CosmosDb.DatabaseName, containerName);

        var assemblyLocation = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location) ?? string.Empty;
        var dataFilePath = Path.Combine(assemblyLocation, _config.DataFiles.WithVectors);
        await _cosmosService.LoadDataIfNeededAsync(container, dataFilePath);

        _logger.LogInformation($"Vector index ready for {GetAlgorithmLabel(indexType)}. Waiting for indexing to catch up...");
        await Task.Delay(5000);

        return container;
    }

    private async Task RunSingleMetricQuery(Container container, float[] queryEmbedding, string distanceFunction, VectorIndexType indexType)
    {
        // Validate distance function
        if (!ValidDistanceFunctions.Contains(distanceFunction.ToLower()))
        {
            throw new ArgumentException($"Invalid distance function '{distanceFunction}'. Must be one of: {string.Join(", ", ValidDistanceFunctions)}");
        }

        var queryText = $@"
            SELECT TOP @topK 
                c AS Document, 
                VectorDistance(c.{_config.Embedding.EmbeddedField}, @embedding, false, {{""distanceFunction"": ""{distanceFunction}""}}) AS Score 
            FROM c 
            ORDER BY VectorDistance(c.{_config.Embedding.EmbeddedField}, @embedding, false, {{""distanceFunction"": ""{distanceFunction}""}})";

        var queryDef = new QueryDefinition(queryText)
            .WithParameter("@topK", _config.VectorSearch.TopK)
            .WithParameter("@embedding", queryEmbedding);

        using var iterator = container.GetItemQueryIterator<SearchResult>(queryDef);
        var results = new List<SearchResult>();

        _logger.LogInformation($"Executing {indexType} vector search with {distanceFunction} metric for top {_config.VectorSearch.TopK} results");
        while (iterator.HasMoreResults)
        {
            var response = await iterator.ReadNextAsync();
            results.AddRange(response);
        }

        // Print the results
        if (results.Count == 0) 
        { 
            _logger.LogInformation("No search results found. Check query terms and data availability."); 
        }
        else
        {
            _logger.LogInformation($"\nSearch Results ({results.Count} found using {indexType} with {distanceFunction}):");
            for (int i = 0; i < results.Count; i++)
            {
                var result = results[i];
                var hotelName = result.Document?.HotelName ?? "Unknown Hotel";
                _logger.LogInformation($"  {i + 1}. {hotelName} (Similarity: {result.Score:F4})");
            }
        }
    }

    private async Task RunMetricComparison(float[] queryEmbedding)
    {
        var rows = new List<ComparisonRow>();

        foreach (var algorithm in ComparisonAlgorithms)
        {
            var container = await PrepareContainerAsync(algorithm);

            foreach (var metric in ValidDistanceFunctions)
            {
                var queryText = $@"
                    SELECT TOP 2
                        c AS Document,
                        VectorDistance(c.{_config.Embedding.EmbeddedField}, @embedding, false, {{""distanceFunction"": ""{metric}""}}) AS Score
                    FROM c
                    ORDER BY VectorDistance(c.{_config.Embedding.EmbeddedField}, @embedding, false, {{""distanceFunction"": ""{metric}""}})";

                var queryDef = new QueryDefinition(queryText)
                    .WithParameter("@embedding", queryEmbedding);

                using var iterator = container.GetItemQueryIterator<SearchResult>(queryDef);
                var results = new List<SearchResult>();

                while (iterator.HasMoreResults)
                {
                    var response = await iterator.ReadNextAsync();
                    results.AddRange(response);
                }

                rows.Add(new ComparisonRow
                {
                    AlgorithmName = GetAlgorithmLabel(algorithm),
                    Metric = metric,
                    Results = results
                });
            }
        }

        PrintComparisonTable(rows);
    }

    private void PrintComparisonTable(IEnumerable<ComparisonRow> rows)
    {
        _logger.LogInformation("\n| Algorithm     | Metric | Top 1 Result            | Score  | Top 2 Result            | Score  |");
        _logger.LogInformation("|---------------|--------|-------------------------|--------|-------------------------|--------|");

        foreach (var row in rows)
        {
            var top1 = row.Results.Count > 0 ? row.Results[0] : null;
            var top2 = row.Results.Count > 1 ? row.Results[1] : null;

            var top1Name = top1?.Document?.HotelName is { Length: > 0 } name1 ? TruncateHotelName(name1) : "N/A";
            var top2Name = top2?.Document?.HotelName is { Length: > 0 } name2 ? TruncateHotelName(name2) : "N/A";
            var top1Score = top1 is null ? "N/A" : top1.Score.ToString("F4");
            var top2Score = top2 is null ? "N/A" : top2.Score.ToString("F4");

            _logger.LogInformation(
                $"| {row.AlgorithmName,-13} | {MetricLabels[row.Metric],-6} | {top1Name,-24} | {top1Score,6} | {top2Name,-24} | {top2Score,6} |");
        }

        _logger.LogInformation("\n====================================================================================================");
        _logger.LogInformation("Summary: Compared 2 algorithms x 3 metrics = 6 combinations");
        _logger.LogInformation("====================================================================================================");
    }

    private static string GetContainerName(VectorIndexType indexType) => indexType switch
    {
        VectorIndexType.Flat => "hotels_flat",
        VectorIndexType.QuantizedFlat => "hotels_quantizedflat",
        VectorIndexType.DiskANN => "hotels_diskann",
        _ => throw new ArgumentException($"Unknown index type: {indexType}")
    };

    private static string GetAlgorithmLabel(VectorIndexType indexType) => indexType switch
    {
        VectorIndexType.Flat => "Flat",
        VectorIndexType.QuantizedFlat => "QuantizedFlat",
        VectorIndexType.DiskANN => "DiskANN",
        _ => throw new ArgumentException($"Unknown index type: {indexType}")
    };

    private static string TruncateHotelName(string hotelName)
    {
        return hotelName.Length > 20 ? $"{hotelName[..20]}.." : hotelName;
    }

    private sealed class ComparisonRow
    {
        public required string AlgorithmName { get; init; }
        public required string Metric { get; init; }
        public required List<SearchResult> Results { get; init; }
    }
}