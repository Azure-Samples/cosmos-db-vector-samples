using Azure.AI.OpenAI;
using Azure.Identity;
using CosmosDbVectorSamples.Services;
using CosmosDbVectorSamples.Services.VectorSearch;
using CosmosDbVectorSamples.Models;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace CosmosDbVectorSamples;

class Program
{
    static async Task Main(string[] args)
    {
        var configuration = new ConfigurationBuilder()
            .SetBasePath(Directory.GetCurrentDirectory())
            .AddJsonFile("appsettings.json", optional: false, reloadOnChange: true)
            .AddEnvironmentVariables()
            .Build();

        var appConfig = new AppConfiguration();
        configuration.Bind(appConfig);
        
        var services = new ServiceCollection()
            .AddLogging(builder => builder.AddConsole())
            .AddSingleton<IConfiguration>(configuration)
            .AddSingleton(appConfig)
            .AddSingleton<MongoDbService>()
            .AddSingleton<EmbeddingService>()
            .AddSingleton<VectorSearchService>();

        var serviceProvider = services.BuildServiceProvider();
        var logger = serviceProvider.GetRequiredService<ILogger<Program>>();

        try
        {
            string? command;
            while (true)
            {
                Console.WriteLine("\n=== Cosmos DB Vector Samples Menu ===\nPlease enter your choice (0-5):\n1. Create embeddings for data\n2. Show all database indexes\n3. Run IVF vector search\n4. Run HNSW vector search\n5. Run DiskANN vector search\n0. Exit\n");
                
                var input = Console.ReadLine();
                command = input switch
                {
                    "1" => "embed",
                    "2" => "show-indexes",
                    "3" => "ivf",
                    "4" => "hnsw",
                    "5" => "diskann",
                    "0" => null,
                    _ => "invalid"
                };
                
                if (command != "invalid") break;
                Console.WriteLine("Invalid selection. Please try again.");
            }

            if (command == null)
            {
                logger.LogInformation("Exiting application.");
                return;
            }
            
            switch (command)
            {
                case "embed":
                    await serviceProvider.GetRequiredService<EmbeddingService>().CreateEmbeddingsAsync();
                    break;
                case "show-indexes":
                    await serviceProvider.GetRequiredService<MongoDbService>().ShowAllIndexesAsync();
                    break;
                case "ivf":
                case "hnsw":
                case "diskann":
                    var indexType = command switch { "ivf" => VectorIndexType.IVF, "hnsw" => VectorIndexType.HNSW, _ => VectorIndexType.DiskANN };
                    await serviceProvider.GetRequiredService<VectorSearchService>().RunSearchAsync(indexType);
                    break;
                default:
                    logger.LogError($"Unknown command: {command}");
                    break;
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Application failed");
        }
    }
}

public enum VectorIndexType
{
    IVF,
    HNSW,
    DiskANN
}