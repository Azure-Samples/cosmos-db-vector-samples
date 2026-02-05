using Azure.AI.OpenAI;
using Azure.Identity;
using CosmosDbVectorSamples.Models;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using System.Reflection;

namespace CosmosDbVectorSamples.Services;

public class EmbeddingService
{
    private readonly ILogger<EmbeddingService> _logger;
    private readonly AzureOpenAIClient _openAIClient;
    private readonly AppConfiguration _config;

    public EmbeddingService(
        ILogger<EmbeddingService> logger,
        IConfiguration configuration)
    {
        _logger = logger;
        _config = new AppConfiguration();
        configuration.Bind(_config);
        
        try
        {
            _openAIClient = new AzureOpenAIClient(
                new Uri(_config.AzureOpenAI.Endpoint),
                new DefaultAzureCredential());
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to initialize Azure OpenAI client in EmbeddingService");
            throw;
        }
    }

    public async Task CreateEmbeddingsAsync()
    {
        try
        {
            _logger.LogInformation("Starting embedding creation");

            var assemblyDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location) ?? string.Empty;
            var inputPath = Path.Combine(assemblyDir, _config.DataFiles.WithoutVectors);
            var outputPath = Path.Combine(assemblyDir, _config.DataFiles.WithVectors);

            if (!File.Exists(inputPath))
                throw new FileNotFoundException($"Input file not found: {inputPath}");

            var jsonContent = await File.ReadAllTextAsync(inputPath);
            var data = JsonConvert.DeserializeObject<List<HotelData>>(jsonContent) ?? new List<HotelData>();
            _logger.LogInformation($"Processing {data.Count} items");

            var textsToEmbed = data.Select(item => GetPropertyValue(item, _config.Embedding.FieldToEmbed) ?? string.Empty).ToList();
            var embeddings = await CreateEmbeddingsBatchAsync(textsToEmbed, _config.Embedding.BatchSize);

            for (int i = 0; i < Math.Min(data.Count, embeddings.Count); i++)
                SetPropertyValue(data[i], _config.Embedding.EmbeddedField, embeddings[i].ToArray());

            var jsonOutput = JsonConvert.SerializeObject(data);
            await File.WriteAllTextAsync(outputPath, jsonOutput);
            _logger.LogInformation($"Embeddings saved to: {outputPath}");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to create embeddings");
            throw;
        }
    }

    private async Task<IReadOnlyList<IReadOnlyList<float>>> CreateEmbeddingsBatchAsync(
        IEnumerable<string> texts, 
        int batchSize = 16,
        CancellationToken cancellationToken = default)
    {
        var textList = texts.ToList();
        var allEmbeddings = new List<IReadOnlyList<float>>();
        
        for (int i = 0; i < textList.Count; i += batchSize)
        {
            if (cancellationToken.IsCancellationRequested) break;

            var batch = textList.Skip(i).Take(batchSize).ToList();
            _logger.LogInformation($"Processing batch {i / batchSize + 1} ({batch.Count} items)");

            try
            {
                var batchEmbeddings = await CreateEmbeddingsAsync(batch);
                allEmbeddings.AddRange(batchEmbeddings);

                if (i + batchSize < textList.Count)
                    await Task.Delay(200, cancellationToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Batch {i / batchSize + 1} failed");
                throw;
            }
        }

        return allEmbeddings;
    }

    private async Task<IReadOnlyList<IReadOnlyList<float>>> CreateEmbeddingsAsync(IEnumerable<string> texts)
    {
        var embeddingClient = _openAIClient.GetEmbeddingClient(_config.AzureOpenAI.EmbeddingModel);
        var response = await embeddingClient.GenerateEmbeddingsAsync(texts.ToArray());
        return response.Value.Select(e => (IReadOnlyList<float>)e.ToFloats().ToArray()).ToList();
    }

    private string? GetPropertyValue(object obj, string propertyName) =>
        obj.GetType().GetProperty(propertyName, BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase)?.GetValue(obj)?.ToString();

    private void SetPropertyValue(object obj, string propertyName, object value)
    {
        if (obj is HotelData hotelData)
        {
            hotelData.ExtraElements ??= new Dictionary<string, object>();
            hotelData.ExtraElements[propertyName] = value;
        }
    }
}