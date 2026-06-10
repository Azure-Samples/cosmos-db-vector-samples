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
            _logger.LogInformation($"Starting {indexType} vector search workflow");

            // Setup container (simulating collection behavior)
            var collectionSuffix = indexType switch 
            { 
                VectorIndexType.Flat => "flat", 
                VectorIndexType.QuantizedFlat => "quantizedflat", 
                VectorIndexType.DiskANN => "diskann", 
                _ => throw new ArgumentException($"Unknown index type: {indexType}") 
            };
            var containerName = $"hotels_{collectionSuffix}";
            
            // Create/Update Vector Index (Ensure container exists first)
            await _cosmosService.CreateVectorIndexAsync(
                _config.CosmosDb.DatabaseName, containerName, 
                _config.Embedding.EmbeddedField, indexType, _config.Embedding.Dimensions);

            // Get Container
            var container = await _cosmosService.GetContainerAsync(_config.CosmosDb.DatabaseName, containerName);
            
            // Load data from file if collection is empty
            var assemblyLocation = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location) ?? string.Empty;
            var dataFilePath = Path.Combine(assemblyLocation, _config.DataFiles.WithVectors);
            await _cosmosService.LoadDataIfNeededAsync(container, dataFilePath);
            
            _logger.LogInformation($"Vector index ready. Waiting for indexing to catch up...");
            await Task.Delay(5000); 

            // Create embedding for the query
            var embeddingClient = _openAIClient.GetEmbeddingClient(_config.AzureOpenAI.EmbeddingModel);
            var queryEmbedding = (await embeddingClient.GenerateEmbeddingAsync(_config.VectorSearch.Query)).Value.ToFloats().ToArray();
            _logger.LogInformation($"Generated query embedding with {queryEmbedding.Length} dimensions");

            // Check for comparison mode
            var compareMetrics = "true".Equals(Environment.GetEnvironmentVariable("COMPARE_DISTANCE_METRICS"), StringComparison.OrdinalIgnoreCase);
            var distanceFunction = (Environment.GetEnvironmentVariable("VECTOR_DISTANCE_FUNCTION") ?? "cosine").ToLower();

            if (compareMetrics)
            {
                await RunMetricComparison(container, queryEmbedding, indexType);
            }
            else
            {
                await RunSingleMetricQuery(container, queryEmbedding, distanceFunction, indexType);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, $"{indexType} vector search failed");
            throw;
        }
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
                VectorDistance(c.{_config.Embedding.EmbeddedField}, @embedding, ""{distanceFunction}"") AS Score 
            FROM c 
            ORDER BY VectorDistance(c.{_config.Embedding.EmbeddedField}, @embedding, ""{distanceFunction}"")";

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
            _logger.LogInformation("❌ No search results found. Check query terms and data availability."); 
        }
        else
        {
            _logger.LogInformation($"\n✅ Search Results ({results.Count} found using {indexType} with {distanceFunction}):");
            for (int i = 0; i < results.Count; i++)
            {
                var result = results[i];
                var hotelName = result.Document?.HotelName ?? "Unknown Hotel";
                _logger.LogInformation($"  {i + 1}. {hotelName} (Similarity: {result.Score:F4})");
            }
        }
    }

    private async Task RunMetricComparison(Container container, float[] queryEmbedding, VectorIndexType indexType)
    {
        var resultMap = new Dictionary<string, Dictionary<string, object>>();
        var charges = new Dictionary<string, double>();

        _logger.LogInformation("\n--- Comparing All Distance Metrics ---");

        // Execute query for each distance function
        foreach (var metric in ValidDistanceFunctions)
        {
            var queryText = $@"
                SELECT TOP @topK 
                    c AS Document, 
                    VectorDistance(c.{_config.Embedding.EmbeddedField}, @embedding, ""{metric}"") AS Score 
                FROM c 
                ORDER BY VectorDistance(c.{_config.Embedding.EmbeddedField}, @embedding, ""{metric}"")";

            var queryDef = new QueryDefinition(queryText)
                .WithParameter("@topK", _config.VectorSearch.TopK)
                .WithParameter("@embedding", queryEmbedding);

            using var iterator = container.GetItemQueryIterator<SearchResult>(queryDef);
            var totalCharge = 0.0;

            while (iterator.HasMoreResults)
            {
                var response = await iterator.ReadNextAsync();
                totalCharge += response.RequestCharge ?? 0;

                foreach (var result in response)
                {
                    var hotelName = result.Document?.HotelName ?? "Unknown";
                    
                    if (!resultMap.ContainsKey(hotelName))
                    {
                        resultMap[hotelName] = new Dictionary<string, object>
                        {
                            { "Document", result.Document },
                            { "Scores", new Dictionary<string, double>() }
                        };
                    }

                    var scores = (Dictionary<string, double>)resultMap[hotelName]["Scores"];
                    scores[metric] = result.Score;
                }
            }

            charges[metric] = totalCharge;
        }

        // Print comparison results
        _logger.LogInformation("\nHotels ranked by each distance metric:");
        int idx = 1;
        foreach (var entry in resultMap)
        {
            var hotelName = entry.Key;
            var data = entry.Value;
            var scores = (Dictionary<string, double>)data["Scores"];

            _logger.LogInformation($"\n{idx}. {hotelName}");
            foreach (var metric in ValidDistanceFunctions)
            {
                if (scores.TryGetValue(metric, out var score))
                {
                    _logger.LogInformation($"   {metric}: {score:F4}");
                }
            }
            idx++;
        }

        _logger.LogInformation("\n--- Request Charges per Metric ---");
        foreach (var metric in ValidDistanceFunctions)
        {
            var charge = charges.TryGetValue(metric, out var c) ? c : 0.0;
            _logger.LogInformation($"{metric}: {charge:F2} RUs");
        }
        _logger.LogInformation("");
    }
}