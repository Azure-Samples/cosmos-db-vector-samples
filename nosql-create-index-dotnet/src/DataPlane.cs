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
    public static readonly string[] ValidRegions = ["Northeast", "Midwest", "South", "West"];
    public static readonly string[] SupportedDistanceFunctions = ["Cosine", "DotProduct", "Euclidean"];

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

        var validRegions = new HashSet<string>(ValidRegions, StringComparer.Ordinal);
        var regionsFound = new HashSet<string>();

        for (int idx = 0; idx < documents.Count; idx++)
        {
            var document = documents[idx];
            if (string.IsNullOrWhiteSpace(document.HotelId))
            {
                throw new InvalidOperationException("Each hotel document must include a non-empty HotelId.");
            }

            // Validate Region property
            if (string.IsNullOrWhiteSpace(document.Region))
            {
                throw new InvalidOperationException(
                    $"Document at index {idx} (HotelId={document.HotelId}) missing Region property");
            }
            if (!validRegions.Contains(document.Region))
            {
                throw new InvalidOperationException(
                    $"Document at index {idx} (HotelId={document.HotelId}) has unexpected Region '{document.Region}'");
            }
            regionsFound.Add(document.Region);

            document.Id = document.HotelId;
            // Do NOT overwrite Region — keep it as-is for partition key
        }

        // Log region distribution
        var regions = regionsFound.OrderBy(r => r).ToList();
        Console.WriteLine($"✓ Region validation passed. Found regions: {string.Join(", ", regions)}");

        // Count documents per region
        var regionCounts = new Dictionary<string, int>();
        foreach (var document in documents)
        {
            var region = document.Region;
            if (regionCounts.ContainsKey(region))
                regionCounts[region]++;
            else
                regionCounts[region] = 1;
        }
        // Print per-region counts in order
        foreach (var region in new[] { "Northeast", "Midwest", "South", "West" })
        {
            if (regionCounts.ContainsKey(region))
                Console.WriteLine($"  Region '{region}': {regionCounts[region]} documents");
        }

        return documents;
    }

    public static IReadOnlyDictionary<string, List<HotelDocument>> GroupDocumentsByRegion(IEnumerable<HotelDocument> documents)
    {
        return documents
            .GroupBy(document => document.Region, StringComparer.Ordinal)
            .OrderBy(group => group.Key, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.ToList(), StringComparer.Ordinal);
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

        var documentsByRegion = GroupDocumentsByRegion(documents);
        var failures = new ConcurrentBag<string>();
        var insertedDocuments = 0;
        var skippedDocuments = 0;
        var totalRequestCharge = 0d;

        foreach (var regionGroup in documentsByRegion)
        {
            var transactionalBatch = container.CreateTransactionalBatch(new PartitionKey(regionGroup.Key));
            foreach (var document in regionGroup.Value)
            {
                if (string.IsNullOrWhiteSpace(document.Region))
                {
                    throw new InvalidOperationException($"Document {document.HotelId} missing Region property");
                }

                transactionalBatch.UpsertItem(document);
            }

            using TransactionalBatchResponse response = await transactionalBatch.ExecuteAsync(cancellationToken);
            totalRequestCharge += response.RequestCharge;

            if (response.IsSuccessStatusCode)
            {
                insertedDocuments += regionGroup.Value.Count;
                Console.WriteLine($"  Region '{regionGroup.Key}': {regionGroup.Value.Count} documents");
                continue;
            }

            for (var operationIndex = 0; operationIndex < response.Count; operationIndex++)
            {
                var operationResult = response[operationIndex];
                if ((int)operationResult.StatusCode is >= 200 and < 300)
                {
                    continue;
                }

                failures.Add(
                    $"Region '{regionGroup.Key}', document '{regionGroup.Value[operationIndex].HotelId}': {operationResult.StatusCode}");
            }
        }

        if (!failures.IsEmpty)
        {
            throw new InvalidOperationException(
                $"Failed to ingest one or more region batches into {containerName}: {string.Join("; ", failures.Take(5))}");
        }

        return new IngestionSummary(containerName, documents.Count, insertedDocuments, skippedDocuments, false, totalRequestCharge);
    }

    public static async Task<QuerySummary> QueryTopMatchesAsync(
        Container container,
        string containerName,
        SampleConfig config,
        IReadOnlyList<float> queryEmbedding,
        string distanceFunction,
        CancellationToken cancellationToken)
    {
        var queryDefinition = new QueryDefinition(BuildVectorDistanceQueryText(config.EmbeddingFieldName, distanceFunction))
            .WithParameter("@topK", config.TopCount)
            .WithParameter("@embedding", queryEmbedding)
            .WithParameter("@partitionKey", config.PartitionKeyValue);

        var queryRequestOptions = new QueryRequestOptions
        {
            PartitionKey = new PartitionKey(config.PartitionKeyValue)
        };
        using var iterator = container.GetItemQueryIterator<VectorSearchRow>(
            queryDefinition,
            requestOptions: queryRequestOptions);

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

    public static string ValidateEmbeddingFieldName(string fieldName)
    {
        if (!EmbeddingFieldNamePattern().IsMatch(fieldName))
        {
            throw new InvalidOperationException($"Invalid embedding field name: {fieldName}");
        }

        return fieldName;
    }

    public static string BuildVectorDistanceQueryText(string embeddingFieldName, string distanceFunction)
    {
        var validatedFieldName = ValidateEmbeddingFieldName(embeddingFieldName);
        if (!SupportedDistanceFunctions.Contains(distanceFunction, StringComparer.Ordinal))
        {
            throw new InvalidOperationException(
                $"Unsupported distance function: {distanceFunction}. Expected one of: {string.Join(", ", SupportedDistanceFunctions)}.");
        }

        return
            $"SELECT TOP @topK c.HotelId, c.HotelName, c.Description, " +
            $"VectorDistance(c.{validatedFieldName}, @embedding, false, {{'distanceFunction': '{distanceFunction}'}}) AS SimilarityScore " +
            "FROM c WHERE c.Region = @partitionKey";
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

    public static async Task ClearContainerDataAsync(Container container, CancellationToken cancellationToken = default)
    {
        try
        {
            using var iterator = container.GetItemQueryIterator<ContainerItemIdentityRow>(new QueryDefinition("SELECT c.id, c.Region FROM c"));
            
            while (iterator.HasMoreResults)
            {
                var response = await iterator.ReadNextAsync(cancellationToken);
                foreach (var item in response)
                {
                    await container.DeleteItemAsync<ContainerItemIdentityRow>(
                        item.Id,
                        new PartitionKey(item.Region),
                        cancellationToken: cancellationToken);
                }
            }
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException("Failed to clear container data", ex);
        }
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

    private sealed class ContainerItemIdentityRow
    {
        [JsonPropertyName("id")]
        public string Id { get; set; } = string.Empty;

        [JsonPropertyName("Region")]
        public string Region { get; set; } = string.Empty;
    }
}
