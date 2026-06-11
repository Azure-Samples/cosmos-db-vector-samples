using System.Collections.Concurrent;
using System.Net;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Azure;
using Azure.AI.OpenAI;
using Azure.Core;
using Microsoft.Azure.Cosmos;
using OpenAI.Embeddings;

namespace NosqlCreateIndexDotnet;

public static partial class DataPlane
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    [GeneratedRegex("^[A-Za-z_][A-Za-z0-9_]*$", RegexOptions.Compiled)]
    private static partial Regex EmbeddingFieldNamePattern();

    public static CosmosClient CreateCosmosClient(SampleConfig config, TokenCredential credential)
    {
        return new CosmosClient(
            config.CosmosEndpoint,
            credential,
            new CosmosClientOptions
            {
                AllowBulkExecution = true
            });
    }

    public static AzureOpenAIClient CreateAzureOpenAIClient(SampleConfig config, TokenCredential credential)
    {
        return new AzureOpenAIClient(
            new Uri(config.OpenAIEmbeddingEndpoint),
            credential,
            CreateAzureOpenAIClientOptions(config.OpenAIEmbeddingApiVersion));
    }

    public static async Task<IReadOnlyList<HotelDocument>> ReadDocumentsAsync(string dataFilePath, CancellationToken cancellationToken)
    {
        await using var stream = File.OpenRead(dataFilePath);
        var documents = await JsonSerializer.DeserializeAsync<List<HotelDocument>>(stream, JsonOptions, cancellationToken)
            ?? throw new InvalidOperationException("The shared hotel dataset must be a JSON array.");

        foreach (var document in documents)
        {
            if (string.IsNullOrWhiteSpace(document.HotelId))
            {
                throw new InvalidOperationException("Each hotel document must include a non-empty HotelId.");
            }

            document.Id = document.HotelId;
        }

        return documents;
    }

    public static async Task<float[]> VerifyEmbeddingDimensionsAsync(AzureOpenAIClient azureOpenAIClient, SampleConfig config, CancellationToken cancellationToken)
    {
        var embedding = await GenerateEmbeddingAsync(azureOpenAIClient, config, "dimension check", cancellationToken);

        if (embedding.Length != config.ExpectedDimensions)
        {
            throw new InvalidOperationException(
                $"Embedding dimensions do not match the container definition. Expected {config.ExpectedDimensions}, received {embedding.Length}.");
        }

        return embedding;
    }

    public static async Task<float[]> GenerateEmbeddingAsync(AzureOpenAIClient azureOpenAIClient, SampleConfig config, string text, CancellationToken cancellationToken)
    {
        EmbeddingClient embeddingClient = azureOpenAIClient.GetEmbeddingClient(config.OpenAIEmbeddingDeployment);
        var response = await embeddingClient.GenerateEmbeddingAsync(text, cancellationToken: cancellationToken);
        return response.Value.ToFloats().ToArray();
    }

    public static async Task<IngestionSummary> IngestDocumentsAsync(Container container, string containerName, IReadOnlyList<HotelDocument> documents, CancellationToken cancellationToken)
    {
        var existingCount = await GetExistingDocumentCountAsync(container, cancellationToken);
        if (existingCount > 0)
        {
            return new IngestionSummary(containerName, documents.Count, 0, existingCount, true, 0);
        }

        var requestChargeLock = new object();
        var failures = new ConcurrentBag<Exception>();
        var insertedDocuments = 0;
        var skippedDocuments = 0;
        var totalRequestCharge = 0d;

        var tasks = documents.Select(async document =>
        {
            try
            {
                var response = await container.CreateItemAsync(
                    document,
                    new PartitionKey(document.HotelId),
                    new ItemRequestOptions { EnableContentResponseOnWrite = false },
                    cancellationToken);

                Interlocked.Increment(ref insertedDocuments);
                lock (requestChargeLock)
                {
                    totalRequestCharge += response.RequestCharge;
                }
            }
            catch (CosmosException exception) when (exception.StatusCode == HttpStatusCode.Conflict)
            {
                Interlocked.Increment(ref skippedDocuments);
            }
            catch (Exception exception)
            {
                failures.Add(exception);
            }
        });

        await Task.WhenAll(tasks);

        if (!failures.IsEmpty)
        {
            throw new AggregateException($"Failed to insert {failures.Count} documents into {containerName}.", failures);
        }

        return new IngestionSummary(containerName, documents.Count, insertedDocuments, skippedDocuments, false, totalRequestCharge);
    }

    public static async Task<QuerySummary> QueryTopMatchesAsync(
        Container container,
        string containerName,
        SampleConfig config,
        IReadOnlyList<float> queryEmbedding,
        CancellationToken cancellationToken)
    {
        var embeddingFieldName = ValidateEmbeddingFieldName(config.EmbeddingFieldName);
        var queryDefinition = new QueryDefinition(
                $"SELECT TOP @topK c.HotelId, c.HotelName, c.Description, VectorDistance(c.{embeddingFieldName}, @embedding) AS SimilarityScore FROM c ORDER BY VectorDistance(c.{embeddingFieldName}, @embedding)")
            .WithParameter("@topK", config.TopCount)
            .WithParameter("@embedding", queryEmbedding);

        using var iterator = container.GetItemQueryIterator<VectorSearchRow>(queryDefinition);

        var results = new List<QueryResult>();
        var totalRequestCharge = 0d;
        string? activityId = null;

        while (iterator.HasMoreResults)
        {
            FeedResponse<VectorSearchRow> page = await iterator.ReadNextAsync(cancellationToken);
            totalRequestCharge += page.RequestCharge;
            activityId = page.ActivityId;

            foreach (var row in page)
            {
                results.Add(new QueryResult(row.HotelId, row.HotelName, row.Description, row.SimilarityScore));
            }
        }

        return new QuerySummary(containerName, totalRequestCharge, activityId, results);
    }

    public static Exception WrapRuntimeException(Exception exception)
    {
        if (exception is AggregateException aggregateException && aggregateException.InnerExceptions.Count == 1)
        {
            return WrapRuntimeException(aggregateException.InnerExceptions[0]);
        }

        if (exception is CosmosException cosmosException)
        {
            return new InvalidOperationException(
                "Cosmos DB data-plane request failed. Verify the database and containers were created by azd up, confirm the environment variables are correct, and ensure your Microsoft Entra identity has data-plane access. " + cosmosException.Message,
                cosmosException);
        }

        if (exception is RequestFailedException requestFailedException)
        {
            return new InvalidOperationException(
                "The Azure OpenAI client request failed. Verify the Azure OpenAI endpoint, embedding deployment, and your Cognitive Services OpenAI User role assignment. " + requestFailedException.Message,
                requestFailedException);
        }

        return exception;
    }

    private static string ValidateEmbeddingFieldName(string fieldName)
    {
        if (!EmbeddingFieldNamePattern().IsMatch(fieldName))
        {
            throw new InvalidOperationException($"Invalid embedding field name: {fieldName}");
        }

        return fieldName;
    }

    private static AzureOpenAIClientOptions CreateAzureOpenAIClientOptions(string apiVersion)
    {
        var serviceVersion = apiVersion switch
        {
            "2024-06-01" => AzureOpenAIClientOptions.ServiceVersion.V2024_06_01,
            _ => AzureOpenAIClientOptions.ServiceVersion.V2024_10_21
        };

        return new AzureOpenAIClientOptions(serviceVersion);
    }

    private static async Task<int> GetExistingDocumentCountAsync(Container container, CancellationToken cancellationToken)
    {
        using var iterator = container.GetItemQueryIterator<int>(new QueryDefinition("SELECT VALUE COUNT(1) FROM c"));
        if (!iterator.HasMoreResults)
        {
            return 0;
        }

        var response = await iterator.ReadNextAsync(cancellationToken);
        return response.Resource.FirstOrDefault();
    }

    public sealed record IngestionSummary(
        string ContainerName,
        int TotalDocuments,
        int InsertedDocuments,
        int SkippedDocuments,
        bool SkippedContainer,
        double RequestCharge);

    public sealed record QuerySummary(
        string ContainerName,
        double RequestCharge,
        string? ActivityId,
        IReadOnlyList<QueryResult> Results);

    public sealed record QueryResult(
        string HotelId,
        string HotelName,
        string Description,
        double SimilarityScore);

    private sealed class VectorSearchRow
    {
        [JsonPropertyName("HotelId")]
        public string HotelId { get; set; } = string.Empty;

        [JsonPropertyName("HotelName")]
        public string HotelName { get; set; } = string.Empty;

        [JsonPropertyName("Description")]
        public string Description { get; set; } = string.Empty;

        [JsonPropertyName("SimilarityScore")]
        public double SimilarityScore { get; set; }
    }
}
