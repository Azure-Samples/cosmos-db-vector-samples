using Azure.Identity;
using CosmosDbVectorSamples.Models;
using Microsoft.Azure.Cosmos;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using System.Net;
using System.Collections.ObjectModel;

namespace CosmosDbVectorSamples.Services;

public class CosmosDbService
{
    private readonly ILogger<CosmosDbService> _logger;
    private readonly AppConfiguration _config;
    private readonly CosmosClient _client;

    public CosmosDbService(ILogger<CosmosDbService> logger, IConfiguration configuration)
    {
        _logger = logger;
        _config = new AppConfiguration();
        configuration.Bind(_config);
        
        var options = new CosmosClientOptions
        {
            SerializerOptions = new CosmosSerializationOptions
            {
                PropertyNamingPolicy = CosmosPropertyNamingPolicy.Default,
                IgnoreNullValues = true
            },
            // Allow bulk execution for data loading
            AllowBulkExecution = true
        };

        _client = new CosmosClient(_config.CosmosDb.Endpoint, new DefaultAzureCredential(), options);
    }

    public Task<Container> GetContainerAsync(string databaseName, string containerName)
    {
        return Task.FromResult(_client.GetContainer(databaseName, containerName));
    }

    public async Task CreateVectorIndexAsync(string databaseName, string containerName, string vectorField, VectorIndexType indexType, int dimensions)
    {
        var database = _client.GetDatabase(databaseName);
        
        _logger.LogInformation($"Ensuring container '{containerName}' exists with vector index '{indexType}'...");

        var properties = new ContainerProperties(containerName, "/HotelId");

        // Define Vector Embedding Policy
        var embeddings = new Collection<Embedding>
        {
            new Embedding
            {
                Path = "/" + vectorField,
                DataType = VectorDataType.Float32,
                DistanceFunction = DistanceFunction.Cosine,
                Dimensions = dimensions
            }
        };

        properties.VectorEmbeddingPolicy = new VectorEmbeddingPolicy(embeddings);

        // Define Indexing Policy
        properties.IndexingPolicy.VectorIndexes.Clear();
        
        var cosmosIndexType = indexType switch
        {
            VectorIndexType.Flat => Microsoft.Azure.Cosmos.VectorIndexType.Flat,
            VectorIndexType.QuantizedFlat => Microsoft.Azure.Cosmos.VectorIndexType.QuantizedFlat,
            VectorIndexType.DiskANN => Microsoft.Azure.Cosmos.VectorIndexType.DiskANN,
            _ => Microsoft.Azure.Cosmos.VectorIndexType.Flat
        };

        properties.IndexingPolicy.VectorIndexes.Add(new VectorIndexPath
        {
            Path = "/" + vectorField,
            Type = cosmosIndexType
        });
        
        // Use CreateContainerIfNotExistsAsync to behave like TS app (matches on GET if exists)
        await database.CreateContainerIfNotExistsAsync(properties);
        _logger.LogInformation($"Container '{containerName}' checked/created.");
    }

    public async Task<int> LoadDataIfNeededAsync(Container container, string dataFilePath)
    {
        try
        {
            // TypeScript app does NOT check 'SELECT COUNT(1)' first.
            // It simply tries to load data and relies on 409 Conflict for existing items.
            // Removed the pre-check to match TypeScript behavior.

            _logger.LogInformation($"Loading data from {dataFilePath}...");
            var jsonContent = await File.ReadAllTextAsync(dataFilePath);
            var items = JsonConvert.DeserializeObject<List<HotelData>>(jsonContent);

            if (items == null || items.Count == 0)
            {
                _logger.LogWarning("No data found in file.");
                return 0;
            }

            var tasks = new List<Task>();
            foreach (var item in items)
            {
                // Ensure ID is set
                if (string.IsNullOrEmpty(item.Id)) item.Id = Guid.NewGuid().ToString();
                
                // Matches TypeScript behavior: Try Create, assume failure on conflict (409) means "already exists"
                tasks.Add(container.CreateItemAsync(item, new PartitionKey(item.HotelId))
                    .ContinueWith(t => 
                    {
                        if (t.IsFaulted)
                        {
                            var cosmosEx = t.Exception?.InnerException as CosmosException;
                            if (cosmosEx?.StatusCode == HttpStatusCode.Conflict)
                            {
                                // Item already exists (409 Conflict), which is fine.
                                // We swallow this error to match TypeScript "try/catch -> continue" behavior
                            }
                            else
                            {
                                _logger.LogError($"Failed to insert item {item.HotelId}: {t.Exception?.InnerException?.Message}");
                            }
                        }
                    }));
            }

            await Task.WhenAll(tasks);
            _logger.LogInformation($"Loaded {items.Count} items (skipping existing).");
            return items.Count;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to load data");
            throw;
        }
    }

    public async Task ShowAllIndexesAsync()
    {
        // Simple implementation to list databases and containers
        // Not implemented fully for brevity but good to have signature match
        try {
            var iterator = _client.GetDatabaseQueryIterator<DatabaseProperties>();
            while (iterator.HasMoreResults)
            {
                foreach (var db in await iterator.ReadNextAsync())
                {
                    _logger.LogInformation($"Database: {db.Id}");
                    var containerIterator = _client.GetDatabase(db.Id).GetContainerQueryIterator<ContainerProperties>();
                    while (containerIterator.HasMoreResults)
                    {
                        foreach (var container in await containerIterator.ReadNextAsync())
                        {
                            _logger.LogInformation($"\tContainer: {container.Id}");
                            if (container.VectorEmbeddingPolicy != null)
                            {
                                foreach(var embed in container.VectorEmbeddingPolicy.Embeddings)
                                {
                                    _logger.LogInformation($"\t\tVector Embedding: {embed.Path} ({embed.Dimensions}, {embed.DistanceFunction})");
                                }
                            }
                            if (container.IndexingPolicy.VectorIndexes != null)
                            {
                                foreach(var idx in container.IndexingPolicy.VectorIndexes)
                                {
                                    _logger.LogInformation($"\t\tVector Index: {idx.Path} ({idx.Type})");
                                }
                            }
                        }
                    }
                }
            }
        }
        catch(Exception ex)
        {
             _logger.LogError(ex, "Error listing indexes");
        }
    }
}
