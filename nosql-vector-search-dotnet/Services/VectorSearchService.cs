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
                VectorIndexType.IVF => "ivf", 
                VectorIndexType.HNSW => "hnsw", 
                VectorIndexType.DiskANN => "diskann", 
                _ => throw new ArgumentException($"Unknown index type: {indexType}") 
            };
            var containerName = $"hotels_{collectionSuffix}_nosql";
            
            // Get Container (creates database/container if needed)
            var container = await _cosmosService.GetContainerAsync(_config.CosmosDb.DatabaseName, containerName);
            
            // Load data from file if collection is empty
            var assemblyLocation = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location) ?? string.Empty;
            var dataFilePath = Path.Combine(assemblyLocation, _config.DataFiles.WithVectors);
            await _cosmosService.LoadDataIfNeededAsync(container, dataFilePath);

            // Create/Update Vector Index
            await _cosmosService.CreateVectorIndexAsync(
                _config.CosmosDb.DatabaseName, containerName, 
                _config.Embedding.EmbeddedField, indexType, _config.Embedding.Dimensions);
            
            _logger.LogInformation($"Vector index ready. Waiting for indexing to catch up...");
            await Task.Delay(5000); 

            // Create embedding for the query
            var embeddingClient = _openAIClient.GetEmbeddingClient(_config.AzureOpenAI.EmbeddingModel);
            var queryEmbedding = (await embeddingClient.GenerateEmbeddingAsync(_config.VectorSearch.Query)).Value.ToFloats().ToArray();
            _logger.LogInformation($"Generated query embedding with {queryEmbedding.Length} dimensions");

            // Execute Cosmos NoSQL Vector Search
            var queryText = $@"
                SELECT TOP @topK 
                    c AS Document, 
                    VectorDistance(c.{_config.Embedding.EmbeddedField}, @embedding) AS Score 
                FROM c 
                ORDER BY VectorDistance(c.{_config.Embedding.EmbeddedField}, @embedding)";

            var queryDef = new QueryDefinition(queryText)
                .WithParameter("@topK", _config.VectorSearch.TopK)
                .WithParameter("@embedding", queryEmbedding);

            using var iterator = container.GetItemQueryIterator<SearchResult>(queryDef);
            var results = new List<SearchResult>();

            _logger.LogInformation($"Executing {indexType} vector search for top {_config.VectorSearch.TopK} results");
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
                _logger.LogInformation($"\n✅ Search Results ({results.Count} found using {indexType}):");
                for (int i = 0; i < results.Count; i++)
                {
                    var result = results[i];
                    var hotelName = result.Document?.HotelName ?? "Unknown Hotel";
                    _logger.LogInformation($"  {i + 1}. {hotelName} (Similarity: {result.Score:F4})");
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, $"{indexType} vector search failed");
            throw;
        }
    }
}