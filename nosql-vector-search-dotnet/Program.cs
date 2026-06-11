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
            .AddSingleton<CosmosDbService>()
            .AddSingleton<EmbeddingService>()
            .AddSingleton<VectorSearchService>();

        var serviceProvider = services.BuildServiceProvider();
        var logger = serviceProvider.GetRequiredService<ILogger<Program>>();

        try
        {
            var compareMetrics = "true".Equals(Environment.GetEnvironmentVariable("COMPARE_DISTANCE_METRICS"), StringComparison.OrdinalIgnoreCase);
            
            string? command;
            
            // Check if COMPARE_DISTANCE_METRICS is set - if so, skip menu and run comparison
            if (compareMetrics)
            {
                command = "compare";
            }
            // Check if command provided as argument
            else if (args.Length > 0)
            {
                command = args[0] switch
                {
                    "1" or "embed" => "embed",
                    "2" or "show-indexes" => "show-indexes",
                    "3" or "flat" => "flat",
                    "4" or "quantized_flat" or "quantizedflat" => "quantized_flat",
                    "5" or "diskann" => "diskann",
                    "0" => null,
                    _ => "invalid"
                };
                
                if (command == "invalid")
                {
                    logger.LogError($"Invalid command: {args[0]}. Valid options: embed, show-indexes, flat, quantized_flat, diskann");
                    return;
                }
            }
            else
            {
                // Interactive menu
                while (true)
                {
                    Console.WriteLine("\n=== Cosmos DB Vector Samples Menu ===\nPlease enter your choice (0-5):\n1. Create embeddings for data\n2. Show all database indexes\n3. Run Flat vector search\n4. Run Quantized Flat vector search\n5. Run DiskANN vector search\n0. Exit\n");
                    
                    var input = Console.ReadLine();
                    command = input switch
                    {
                        "1" => "embed",
                        "2" => "show-indexes",
                        "3" => "flat",
                        "4" => "quantized_flat",
                        "5" => "diskann",
                        "0" => null,
                        _ => "invalid"
                    };
                    
                    if (command != "invalid") break;
                    Console.WriteLine("Invalid selection. Please try again.");
                }
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
                    await serviceProvider.GetRequiredService<CosmosDbService>().ShowAllIndexesAsync();
                    break;
                case "compare":
                    await serviceProvider.GetRequiredService<VectorSearchService>().RunSearchAsync(VectorIndexType.DiskANN);
                    break;
                case "flat":
                case "quantized_flat":
                case "diskann":
                    var indexType = command switch { "flat" => VectorIndexType.Flat, "quantized_flat" => VectorIndexType.QuantizedFlat, _ => VectorIndexType.DiskANN };
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
    Flat,
    QuantizedFlat,
    DiskANN
}