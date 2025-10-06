using Azure.AI.OpenAI;
using Azure.Identity;
using CosmosDbVectorSamples.Models;
using Microsoft.Extensions.Logging;
using MongoDB.Bson;
using MongoDB.Driver;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System.Reflection;

namespace CosmosDbVectorSamples.Services.VectorSearch;

/// <summary>
/// Service for performing vector similarity searches using different algorithms (IVF, HNSW, DiskANN).
/// Handles data loading, vector index creation, query embedding generation, and search execution.
/// </summary>
public class VectorSearchService
{
    private readonly ILogger<VectorSearchService> _logger;
    private readonly AzureOpenAIClient _openAIClient;
    private readonly MongoDbService _mongoService;
    private readonly AppConfiguration _config;

    public VectorSearchService(ILogger<VectorSearchService> logger, MongoDbService mongoService, AppConfiguration config)
    {
        _logger = logger;
        _mongoService = mongoService;
        _config = config;
        
        // Initialize Azure OpenAI client with passwordless authentication
        _openAIClient = new AzureOpenAIClient(new Uri(_config.AzureOpenAI.Endpoint), new DefaultAzureCredential());
    }

    /// <summary>
    /// Executes a complete vector search workflow: data setup, index creation, query embedding, and search
    /// </summary>
    /// <param name="indexType">The vector search algorithm to use (IVF, HNSW, or DiskANN)</param>
    public async Task RunSearchAsync(VectorIndexType indexType)
    {
        try
        {
            _logger.LogInformation($"Starting {indexType} vector search workflow");
            
            // Setup collection
            var collectionSuffix = indexType switch 
            { 
                VectorIndexType.IVF => "ivf", 
                VectorIndexType.HNSW => "hnsw", 
                VectorIndexType.DiskANN => "diskann", 
                _ => throw new ArgumentException($"Unknown index type: {indexType}") 
            };
            var collectionName = $"hotels_{collectionSuffix}_fixed";
            var indexName = $"vectorIndex_{collectionSuffix}";
            
            var collection = _mongoService.GetCollection<HotelData>(_config.VectorSearch.DatabaseName, collectionName);
            
            // Load data from file if collection is empty
            var assemblyLocation = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location) ?? string.Empty;
            var dataFilePath = Path.Combine(assemblyLocation, _config.DataFiles.WithVectors);
            await _mongoService.LoadDataIfNeededAsync(collection, dataFilePath);

            // Create the vector index with algorithm-specific search options
            var searchOptions = indexType switch
            {
                VectorIndexType.IVF => CreateIVFSearchOptions(_config.Embedding.Dimensions),
                VectorIndexType.HNSW => CreateHNSWSearchOptions(_config.Embedding.Dimensions),
                VectorIndexType.DiskANN => CreateDiskANNSearchOptions(_config.Embedding.Dimensions),
                _ => throw new ArgumentException($"Unknown index type: {indexType}")
            };
            
            await _mongoService.CreateVectorIndexAsync(
                _config.VectorSearch.DatabaseName, collectionName, indexName,
                _config.Embedding.EmbeddedField, searchOptions);
            
            _logger.LogInformation($"Vector index '{indexName}' is ready for {indexType} search");
            await Task.Delay(5000); // Allow index to be fully initialized

            // Create embedding for the query
            var embeddingClient = _openAIClient.GetEmbeddingClient(_config.AzureOpenAI.EmbeddingModel);
            var queryEmbedding = (await embeddingClient.GenerateEmbeddingAsync(_config.VectorSearch.Query)).Value.ToFloats().ToArray();
            _logger.LogInformation($"Generated query embedding with {queryEmbedding.Length} dimensions");

            // Build MongoDB aggregation pipeline for vector search
            var searchPipeline = new BsonDocument[]
            {
                // Vector similarity search using cosmosSearch
                new BsonDocument("$search", new BsonDocument
                {
                    ["cosmosSearch"] = new BsonDocument
                    {
                        ["vector"] = new BsonArray(queryEmbedding.Select(f => new BsonDouble(f))),
                        ["path"] = _config.Embedding.EmbeddedField,  // Field containing embeddings
                        ["k"] = _config.VectorSearch.TopK           // Number of results to return
                    }
                }),
                // Project results with similarity scores
                new BsonDocument("$project", new BsonDocument
                {
                    ["score"] = new BsonDocument("$meta", "searchScore"),
                    ["document"] = "$$ROOT"
                })
            };

            // Execute and process the search
            _logger.LogInformation($"Executing {indexType} vector search for top {_config.VectorSearch.TopK} results");
            var searchResults = (await collection.AggregateAsync<BsonDocument>(searchPipeline)).ToList()
                .Select(result => new SearchResult 
                { 
                    Document = MongoDB.Bson.Serialization.BsonSerializer.Deserialize<HotelData>(result["document"].AsBsonDocument), 
                    Score = result["score"].AsDouble 
                }).ToList();

            // Print the results
            if (searchResults?.Count == 0) 
            { 
                _logger.LogInformation("❌ No search results found. Check query terms and data availability."); 
            }
            else
            {
                _logger.LogInformation($"\n✅ Search Results ({searchResults!.Count} found using {indexType}):");
                for (int i = 0; i < searchResults.Count; i++)
                {
                    var result = searchResults[i];
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

    /// <summary>
    /// Creates IVF (Inverted File) search options - good for large datasets with fast approximate search
    /// </summary>
    private BsonDocument CreateIVFSearchOptions(int dimensions) => new BsonDocument
    {
        ["kind"] = "vector-ivf",
        ["similarity"] = "COS",
        ["dimensions"] = dimensions,
        ["numLists"] = 1
    };

    /// <summary>
    /// Creates HNSW (Hierarchical Navigable Small World) search options - best accuracy/speed balance
    /// </summary>
    private BsonDocument CreateHNSWSearchOptions(int dimensions) => new BsonDocument
    {
        ["kind"] = "vector-hnsw",
        ["similarity"] = "COS",
        ["dimensions"] = dimensions,
        ["m"] = 16,
        ["efConstruction"] = 64
    };

    /// <summary>
    /// Creates DiskANN search options - optimized for very large datasets stored on disk
    /// </summary>
    private BsonDocument CreateDiskANNSearchOptions(int dimensions) => new BsonDocument
    {
        ["kind"] = "vector-diskann",
        ["similarity"] = "COS",
        ["dimensions"] = dimensions
    };
}