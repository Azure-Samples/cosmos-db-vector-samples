using Azure.Identity;
using CosmosDbVectorSamples.Models;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using MongoDB.Bson;
using MongoDB.Driver;
using Newtonsoft.Json;

namespace CosmosDbVectorSamples.Services;

/// <summary>
/// Service for MongoDB operations including data insertion, index management, and vector index creation.
/// Supports Azure Cosmos DB for MongoDB with passwordless authentication.
/// </summary>
public class MongoDbService
{
    private readonly ILogger<MongoDbService> _logger;
    private readonly AppConfiguration _config;
    private readonly MongoClient _client;

    public MongoDbService(ILogger<MongoDbService> logger, IConfiguration configuration)
    {
        _logger = logger;
        _config = new AppConfiguration();
        configuration.Bind(_config);
        
        // Validate configuration
        if (string.IsNullOrEmpty(_config.MongoDB.ClusterName))
            throw new InvalidOperationException("MongoDB connection not configured. Please provide ConnectionString or ClusterName.");
            
        // Configure MongoDB connection for Azure Cosmos DB with OIDC authentication
        var connectionString = $"mongodb+srv://{_config.MongoDB.ClusterName}.global.mongocluster.cosmos.azure.com/?tls=true&authMechanism=MONGODB-OIDC&retrywrites=false&maxIdleTimeMS=120000";
        var settings = MongoClientSettings.FromUrl(MongoUrl.Create(connectionString));
        settings.UseTls = true;
        settings.RetryWrites = false;
        settings.MaxConnectionIdleTime = TimeSpan.FromMinutes(2);
        settings.Credential = MongoCredential.CreateOidcCredential(new AzureIdentityTokenHandler(new DefaultAzureCredential(), _config.MongoDB.TenantId));
        settings.Freeze();
        
        _client = new MongoClient(settings);
        _logger.LogInformation("MongoDB client initialized with passwordless authentication");
    }

    /// <summary>Gets a database instance by name</summary>
    public IMongoDatabase GetDatabase(string databaseName) => _client.GetDatabase(databaseName);
    
    /// <summary>Gets a collection instance from the specified database</summary>
    public IMongoCollection<T> GetCollection<T>(string databaseName, string collectionName) => 
        _client.GetDatabase(databaseName).GetCollection<T>(collectionName);

    /// <summary>
    /// Creates a vector search index for Cosmos DB MongoDB, with support for IVF, HNSW, and DiskANN algorithms
    /// </summary>
    public async Task<BsonDocument> CreateVectorIndexAsync(string databaseName, string collectionName, string indexName, string embeddedField, BsonDocument cosmosSearchOptions)
    {
        var database = _client.GetDatabase(databaseName);
        var collection = database.GetCollection<BsonDocument>(collectionName);
        
        // Check if index already exists to avoid duplication
        var indexList = await (await collection.Indexes.ListAsync()).ToListAsync();
        if (indexList.Any(index => index.TryGetValue("name", out var nameValue) && nameValue.AsString == indexName))
        {
            _logger.LogInformation($"Vector index '{indexName}' already exists, skipping creation");
            return new BsonDocument { ["ok"] = 1 };
        }
        
        // Create the specified vector index type
        _logger.LogInformation($"Creating vector index '{indexName}' on field '{embeddedField}'");
        return await database.RunCommandAsync<BsonDocument>(new BsonDocument
        {
            ["createIndexes"] = collectionName,
            ["indexes"] = new BsonArray 
            { 
                new BsonDocument 
                { 
                    ["name"] = indexName, 
                    ["key"] = new BsonDocument { [embeddedField] = "cosmosSearch" }, 
                    ["cosmosSearchOptions"] = cosmosSearchOptions 
                } 
            }
        });
    }

    /// <summary>
    /// Displays all indexes across all user databases, excluding system databases
    /// </summary>
    public async Task ShowAllIndexesAsync()
    {
        try
        {
            // Get user databases (exclude system databases)
            var databases = (await (await _client.ListDatabaseNamesAsync()).ToListAsync())
                .Where(name => !new[] { "admin", "config", "local" }.Contains(name)).ToList();
                
            if (!databases.Any()) 
            { 
                _logger.LogInformation("No user databases found or access denied"); 
                return; 
            }

            foreach (var dbName in databases)
            {
                var database = _client.GetDatabase(dbName);
                var collections = await (await database.ListCollectionNamesAsync()).ToListAsync();
                
                if (!collections.Any()) 
                { 
                    _logger.LogInformation($"Database '{dbName}': No collections found"); 
                    continue; 
                }
                
                _logger.LogInformation($"\n📂 DATABASE: {dbName} ({collections.Count} collections)");
                
                // Display indexes for each collection
                foreach (var collName in collections)
                {
                    try
                    {
                        var indexList = await (await database.GetCollection<BsonDocument>(collName).Indexes.ListAsync()).ToListAsync();
                        _logger.LogInformation($"\n  🗃️ COLLECTION: {collName} ({indexList.Count} indexes)");
                        indexList.ForEach(index => _logger.LogInformation($"    Index: {index.ToJson()}"));
                    }
                    catch (Exception ex) 
                    { 
                        _logger.LogError(ex, $"Failed to list indexes for collection '{collName}'"); 
                    }
                }
            }
        }
        catch (Exception ex) 
        { 
            _logger.LogError(ex, "Failed to retrieve database indexes"); 
            throw; 
        }
    }

    /// <summary>
    /// Loads data from file into collection if the collection is empty
    /// </summary>
    /// <param name="collection">Target collection to load data into</param>
    /// <param name="dataFilePath">Path to the JSON data file containing vector embeddings</param>
    /// <returns>Number of documents loaded, or 0 if collection already had data</returns>
    public async Task<int> LoadDataIfNeededAsync<T>(IMongoCollection<T> collection, string dataFilePath) where T : class
    {
        var existingDocCount = await collection.CountDocumentsAsync(Builders<T>.Filter.Empty);

        // Skip loading if collection already has data
        if (existingDocCount > 0)
        {
            _logger.LogInformation("Collection already contains data, skipping load operation");
            return 0;
        }

        // Load and validate data file
        _logger.LogInformation("Collection is empty, loading data from file");
        if (!File.Exists(dataFilePath))
            throw new FileNotFoundException($"Vector data file not found: {dataFilePath}");

        var jsonContent = await File.ReadAllTextAsync(dataFilePath);
        var data = JsonConvert.DeserializeObject<List<T>>(jsonContent) ?? new List<T>();
        
        if (data.Count == 0)
            throw new InvalidOperationException("No data found in the vector data file");

        // Insert data using existing method
        var summary = await InsertDataAsync(collection, data);
        _logger.LogInformation($"Successfully loaded {summary.Inserted} documents into collection");
        
        return summary.Inserted;
    }

    /// <summary>
    /// Inserts data into MongoDB collection, converts JSON embeddings to float arrays, and creates standard indexes
    /// </summary>
    public async Task<InsertSummary> InsertDataAsync<T>(IMongoCollection<T> collection, IEnumerable<T> data)
    {
        var dataList = data.ToList();
        _logger.LogInformation($"Processing {dataList.Count} items for insertion");

        // Convert JSON array embeddings to float arrays for vector search compatibility
        foreach (var hotel in dataList.OfType<HotelData>().Where(h => h.ExtraElements != null))
            foreach (var kvp in hotel.ExtraElements.ToList().Where(k => k.Value is Newtonsoft.Json.Linq.JArray))
                hotel.ExtraElements[kvp.Key] = ((Newtonsoft.Json.Linq.JArray)kvp.Value).Select(token => (float)token).ToArray();

        int inserted = 0, failed = 0;
        try
        {
            // Use unordered insert for better performance
            await collection.InsertManyAsync(dataList, new InsertManyOptions { IsOrdered = false });
            inserted = dataList.Count;
            _logger.LogInformation($"Successfully inserted {inserted} items");
        }
        catch (Exception ex)
        {
            failed = dataList.Count;
            _logger.LogError(ex, $"Batch insert failed for {dataList.Count} items");
        }

        // Create standard indexes for common query fields
        var indexFields = new[] { "HotelId", "Category", "Description", "Description_fr" };
        foreach (var field in indexFields)
            await collection.Indexes.CreateOneAsync(new CreateIndexModel<T>(Builders<T>.IndexKeys.Ascending(field)));

        return new InsertSummary { Total = dataList.Count, Inserted = inserted, Failed = failed };
    }

    /// <summary>Disposes the MongoDB client and its resources</summary>
    public void Dispose() => _client?.Cluster?.Dispose();
}