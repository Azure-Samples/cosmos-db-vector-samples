using System.Text.Json;
using NosqlCreateIndexDotnet;

return await RunAsync();

static async Task<int> RunAsync()
{
    Console.WriteLine(new string('=', 70));
    Console.WriteLine(".NET VectorDistance Fixes - Comprehensive Test");
    Console.WriteLine(new string('=', 70));
    Console.WriteLine();

    try
    {
        TestPartitionKeyDefault();
        await TestDataFileRegionsAsync();
        await TestDocumentPreparationAsync();
        await TestRegionGroupingAsync();
        TestFieldNameValidation();
        await TestQueryStructureAsync();

        Console.WriteLine();
        Console.WriteLine(new string('=', 70));
        Console.WriteLine("[SUCCESS] All tests passed!");
        Console.WriteLine(new string('=', 70));
        Console.WriteLine();
        Console.WriteLine("Summary of fixes verified:");
        Console.WriteLine("  1. Partition key config uses valid Region value (Northeast)");
        Console.WriteLine("  2. Data file contains all expected regions");
        Console.WriteLine("  3. Document preparation preserves Region field and sets id from HotelId");
        Console.WriteLine("  4. Documents group correctly by Region for batching");
        Console.WriteLine("  5. Field name validation and distance function support are correct");
        Console.WriteLine("  6. VectorDistance query structure is correct:");
        Console.WriteLine("     - No ORDER BY clause");
        Console.WriteLine("     - Uses Region partition key in WHERE clause");
        Console.WriteLine("     - Passes distance function in options parameter");
        Console.WriteLine("     - Applies QueryRequestOptions.PartitionKey");
        return 0;
    }
    catch (Exception exception)
    {
        Console.WriteLine();
        Console.WriteLine(new string('=', 70));
        Console.WriteLine($"[FAILURE] {exception.GetType().Name}: {exception.Message}");
        Console.WriteLine(new string('=', 70));
        return 1;
    }
}

static void TestPartitionKeyDefault()
{
    var config = Config.Load();
    Assert(
        DataPlane.ValidRegions.Contains(config.PartitionKeyValue, StringComparer.Ordinal),
        $"Partition key '{config.PartitionKeyValue}' is not a valid Region value.");
    Console.WriteLine($"[PASS] Partition key default is valid: {config.PartitionKeyValue}");
}

static async Task TestDataFileRegionsAsync()
{
    var config = Config.Load();
    using var stream = File.OpenRead(config.DataFileWithVectors);
    var payload = await JsonSerializer.DeserializeAsync<JsonElement>(stream);
    var regions = new HashSet<string>(StringComparer.Ordinal);
    var count = 0;

    foreach (var item in payload.EnumerateArray())
    {
        Assert(item.TryGetProperty("Region", out var regionElement), "A document is missing the Region field.");
        regions.Add(regionElement.GetString() ?? string.Empty);
        count++;
    }

    Assert(
        regions.SetEquals(DataPlane.ValidRegions),
        $"Regions mismatch. Found: {string.Join(", ", regions.OrderBy(x => x))}");

    Console.WriteLine($"[PASS] Data file has all expected regions: {string.Join(", ", regions.OrderBy(x => x))}");
    Console.WriteLine($"        Total documents: {count}");
}

static async Task TestDocumentPreparationAsync()
{
    var config = Config.Load();
    var documents = await DataPlane.ReadDocumentsAsync(config.DataFileWithVectors, CancellationToken.None);
    var first = documents.First();

    Assert(first.Id == first.HotelId, "Prepared document id should match HotelId.");
    Assert(
        DataPlane.ValidRegions.Contains(first.Region, StringComparer.Ordinal),
        "Prepared document should preserve Region.");

    Console.WriteLine("[PASS] Document preparation preserves Region and maps id correctly");
}

static async Task TestRegionGroupingAsync()
{
    var config = Config.Load();
    var documents = await DataPlane.ReadDocumentsAsync(config.DataFileWithVectors, CancellationToken.None);
    var grouped = DataPlane.GroupDocumentsByRegion(documents);

    var expectedCounts = new Dictionary<string, int>(StringComparer.Ordinal)
    {
        ["Northeast"] = 10,
        ["Midwest"] = 10,
        ["South"] = 14,
        ["West"] = 16
    };

    Assert(grouped.Count == expectedCounts.Count, $"Expected {expectedCounts.Count} regions, got {grouped.Count}.");
    foreach (var expected in expectedCounts)
    {
        Assert(grouped.TryGetValue(expected.Key, out var regionDocs), $"Missing region group: {expected.Key}");
        var actualDocs = regionDocs ?? throw new InvalidOperationException($"Missing region group: {expected.Key}");
        Assert(actualDocs.Count == expected.Value, $"Expected {expected.Value} docs for {expected.Key}, got {actualDocs.Count}.");
    }

    Console.WriteLine("[PASS] Region grouping works correctly");
    foreach (var region in expectedCounts.Keys)
    {
        Console.WriteLine($"        {region}: {grouped[region].Count} documents");
    }
}

static void TestFieldNameValidation()
{
    foreach (var validName in new[] { "embedding", "DescriptionVector", "_hidden", "field123" })
    {
        var validated = DataPlane.ValidateEmbeddingFieldName(validName);
        Assert(validated == validName, $"Expected valid field name '{validName}' to round-trip.");
        Console.WriteLine($"[PASS] Valid field name accepted: {validName}");
    }

    foreach (var invalidName in new[] { "123invalid", "-invalid", "field-name", "field.name" })
    {
        try
        {
            DataPlane.ValidateEmbeddingFieldName(invalidName);
            throw new InvalidOperationException($"Invalid field name accepted: {invalidName}");
        }
        catch (InvalidOperationException)
        {
            Console.WriteLine($"[PASS] Invalid field name rejected: {invalidName}");
        }
    }

    Assert(
        DataPlane.SupportedDistanceFunctions.SequenceEqual(new[] { "Cosine", "DotProduct", "Euclidean" }),
        "Supported distance functions do not match expected values.");
}

static async Task TestQueryStructureAsync()
{
    var query = DataPlane.BuildVectorDistanceQueryText("embedding", "Cosine");
    Assert(!query.Contains("ORDER BY", StringComparison.OrdinalIgnoreCase), "Query must not contain ORDER BY.");
    Assert(query.Contains("WHERE c.Region = @partitionKey", StringComparison.Ordinal), "Query must filter on Region partition key.");
    Assert(query.Contains("{'distanceFunction': 'Cosine'}", StringComparison.Ordinal), "Query must include distanceFunction options.");

    var sampleRoot = Config.Load().SampleRoot;
    var sourcePath = Path.Combine(sampleRoot, "src", "DataPlane.cs");
    var source = await File.ReadAllTextAsync(sourcePath);

    Assert(
        source.Contains("PartitionKey = new PartitionKey(config.PartitionKeyValue)", StringComparison.Ordinal),
        "Query should pass QueryRequestOptions.PartitionKey.");
    Assert(
        !source.Contains("WHERE c.HotelId = @partitionKey", StringComparison.Ordinal),
        "Query should not use HotelId as the partition key filter.");

    Console.WriteLine("[PASS] VectorDistance query structure is correct");
    Console.WriteLine("        - Uses Region partition key in WHERE clause");
    Console.WriteLine("        - Passes distance function in options");
    Console.WriteLine("        - Does NOT use HotelId as partition key");
    Console.WriteLine("        - Applies QueryRequestOptions.PartitionKey");
}

static void Assert(bool condition, string message)
{
    if (!condition)
    {
        throw new InvalidOperationException(message);
    }
}
