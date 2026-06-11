package com.example.cosmos.vectorsearch;

import com.azure.ai.openai.OpenAIClient;
import com.azure.ai.openai.models.EmbeddingItem;
import com.azure.ai.openai.models.EmbeddingsOptions;
import com.azure.cosmos.CosmosClient;
import com.azure.cosmos.CosmosContainer;
import com.azure.cosmos.models.CosmosQueryRequestOptions;
import com.azure.cosmos.models.SqlParameter;
import com.azure.cosmos.models.SqlQuerySpec;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Azure Cosmos DB NoSQL vector search sample — Java port of nosql-vector-search-typescript.
 *
 * Demonstrates:
 * - Passwordless authentication with DefaultAzureCredential
 * - Bulk insert of hotel data with pre-computed embeddings
 * - Vector similarity search using VectorDistance() SQL function
 * - Distance metric comparison (Cosine, Euclidean, DotProduct)
 * - DiskANN and QuantizedFlat algorithm selection via environment variable
 */
public final class VectorSearch {

    private static final String SAMPLE_QUERY =
            "quintessential lodging near running trails, eateries, retail";

    private static final Set<String> VALID_ALGORITHMS = Set.of("diskann", "quantizedflat");
    private static final List<String> VALID_DISTANCE_FUNCTIONS = List.of("cosine", "euclidean", "dotproduct");
    private static final List<String> COMPARISON_ALGORITHMS = List.of("diskann", "quantizedflat");
    private static final Map<String, String> METRIC_LABELS = Map.of(
            "cosine", "COS",
            "euclidean", "L2",
            "dotproduct", "IP"
    );

    private static final Map<String, String> ALGORITHM_CONTAINERS = Map.of(
            "diskann", "hotels_diskann",
            "quantizedflat", "hotels_quantizedflat"
    );

    private static final Map<String, String> ALGORITHM_DISPLAY = Map.of(
            "diskann", "DiskANN",
            "quantizedflat", "QuantizedFlat"
    );

    public static void main(String[] args) {
        try {
            new VectorSearch().run();
        } catch (Exception e) {
            System.err.println("App failed: " + e.getMessage());
            e.printStackTrace();
            System.exit(1);
        }
        System.exit(0);
    }

    private void run() throws Exception {
        // ── Configuration ───────────────────────────────────────────────
        var algorithm = Utils.envOrDefault("VECTOR_ALGORITHM", "diskann").trim().toLowerCase();
        var dbName = Utils.envOrDefault("AZURE_COSMOSDB_DATABASENAME", "Hotels");
        var dataFile = Utils.requireEnv("DATA_FILE_WITH_VECTORS");
        var embeddedField = Utils.requireEnv("EMBEDDED_FIELD");
        var deployment = Utils.requireEnv("AZURE_OPENAI_EMBEDDING_MODEL");
        var distanceFunction = Utils.envOrDefault("VECTOR_DISTANCE_FUNCTION", "cosine").toLowerCase();
        var compareMetrics = "true".equalsIgnoreCase(Utils.envOrDefault("COMPARE_DISTANCE_METRICS", "false"));

        if (!VALID_ALGORITHMS.contains(algorithm)) {
            throw new IllegalArgumentException(
                    "Invalid algorithm '" + algorithm + "'. Must be one of: " +
                    String.join(", ", VALID_ALGORITHMS));
        }

        if (!VALID_DISTANCE_FUNCTIONS.contains(distanceFunction)) {
            throw new IllegalArgumentException(
                    "Invalid distance function '" + distanceFunction + "'. Must be one of: " +
                    String.join(", ", VALID_DISTANCE_FUNCTIONS));
        }

        var containerName = ALGORITHM_CONTAINERS.get(algorithm);
        var algorithmDisplay = ALGORITHM_DISPLAY.get(algorithm);
        var safeField = Utils.validateFieldName(embeddedField);
        var dataPath = Path.of(dataFile);
        var data = Utils.readJsonFile(dataPath);

        // ── Clients ─────────────────────────────────────────────────────
        OpenAIClient aiClient = Utils.createOpenAIClient();
        CosmosClient dbClient = Utils.createCosmosClient();

        try {
            var database = dbClient.getDatabase(dbName);
            System.out.println("Connected to database: " + dbName);
            System.out.println("\nVector Search Algorithm: " + algorithmDisplay);
            System.out.println("Distance Function: " + distanceFunction);
            if (compareMetrics) {
                System.out.println("Comparison Mode: metrics across DiskANN and QuantizedFlat");
            }

            // ── Generate Query Embedding ────────────────────────────────
            var embeddingOptions = new EmbeddingsOptions(List.of(SAMPLE_QUERY));
            var embeddingResult = aiClient.getEmbeddings(deployment, embeddingOptions);

            List<Float> embedding = embeddingResult.getData().get(0).getEmbedding();

            // Convert Float list to List<Double> for Cosmos DB parameter binding
            var embeddingDoubles = new ArrayList<Double>(embedding.size());
            for (var f : embedding) {
                embeddingDoubles.add(f.doubleValue());
            }

            if (compareMetrics) {
                runMetricComparison(database, data, embeddingDoubles, safeField);
            } else {
                CosmosContainer container = database.getContainer(containerName);
                System.out.println("Connected to container: " + containerName);
                container.read();
                Utils.insertData(container, data);
                runSingleMetricQuery(container, embeddingDoubles, safeField, distanceFunction);
            }

            System.out.println("\nVector search completed successfully!");
        } finally {
            dbClient.close();
        }
    }

    private void runSingleMetricQuery(
            CosmosContainer container,
            List<Double> embedding,
            String safeField,
            String distanceFunction) throws Exception {
        var queryText = "SELECT TOP 5 c.HotelName, c.Description, c.Rating, " +
                "VectorDistance(c." + safeField + ", @embedding, false, {\"distanceFunction\": \"" + distanceFunction + "\"}) AS SimilarityScore " +
                "FROM c " +
                "ORDER BY VectorDistance(c." + safeField + ", @embedding, false, {\"distanceFunction\": \"" + distanceFunction + "\"})";

        System.out.println("\n--- Executing Vector Search Query ---");
        System.out.println("Query: " + queryText);
        System.out.println("Parameters: @embedding (vector with " + embedding.size() + " dimensions)");
        System.out.println("--------------------------------------\n");

        var sqlQuery = new SqlQuerySpec(
                queryText,
                List.of(new SqlParameter("@embedding", embedding))
        );

        var queryOptions = new CosmosQueryRequestOptions();

        @SuppressWarnings("unchecked")
        var resultPages = container.queryItems(sqlQuery, queryOptions, Map.class);

        var results = new ArrayList<Map<String, Object>>();
        var requestCharge = 0.0;

        for (var page : resultPages.iterableByPage()) {
            requestCharge += page.getRequestCharge();
            for (var item : page.getResults()) {
                @SuppressWarnings("unchecked")
                var typedItem = (Map<String, Object>) item;
                results.add(typedItem);
            }
        }

        Utils.printSearchResults(results, requestCharge);
    }

    private void runMetricComparison(
            com.azure.cosmos.CosmosDatabase database,
            List<Map<String, Object>> data,
            List<Double> embedding,
            String safeField) throws Exception {

        var allResults = new LinkedHashMap<String, Map<String, List<Map<String, Object>>>>();

        System.out.println("\nComparing distance metrics across DiskANN and QuantizedFlat");

        for (var algorithm : COMPARISON_ALGORITHMS) {
            var containerName = ALGORITHM_CONTAINERS.get(algorithm);
            var container = database.getContainer(containerName);
            container.read();
            Utils.insertData(container, data);

            var metricResults = new LinkedHashMap<String, List<Map<String, Object>>>();
            for (var metric : VALID_DISTANCE_FUNCTIONS) {
                var queryText = "SELECT TOP 2 c.HotelName, c.Description, c.Rating, " +
                        "VectorDistance(c." + safeField + ", @embedding, false, {\"distanceFunction\": \"" + metric + "\"}) AS SimilarityScore " +
                        "FROM c " +
                        "ORDER BY VectorDistance(c." + safeField + ", @embedding, false, {\"distanceFunction\": \"" + metric + "\"})";

                var sqlQuery = new SqlQuerySpec(
                        queryText,
                        List.of(new SqlParameter("@embedding", embedding))
                );

                var queryOptions = new CosmosQueryRequestOptions();

                @SuppressWarnings("unchecked")
                var resultPages = container.queryItems(sqlQuery, queryOptions, Map.class);
                var results = new ArrayList<Map<String, Object>>();

                for (var page : resultPages.iterableByPage()) {
                    for (var item : page.getResults()) {
                        @SuppressWarnings("unchecked")
                        var typedItem = (Map<String, Object>) item;
                        results.add(typedItem);
                    }
                }

                metricResults.put(metric, results);
            }

            allResults.put(algorithm, metricResults);
        }

        printComparisonTable(allResults);
    }

    private void printComparisonTable(Map<String, Map<String, List<Map<String, Object>>>> allResults) {
        System.out.println("\n| Algorithm     | Metric | Top 1 Result            | Score  | Top 2 Result            | Score  |");
        System.out.println("|---------------|--------|-------------------------|--------|-------------------------|--------|");

        for (var algorithm : COMPARISON_ALGORITHMS) {
            var algorithmName = ALGORITHM_DISPLAY.get(algorithm);
            var metricResults = allResults.getOrDefault(algorithm, Map.of());

            for (var metric : VALID_DISTANCE_FUNCTIONS) {
                var results = metricResults.getOrDefault(metric, List.of());

                var top1Name = results.size() > 0 ? truncateHotelName(String.valueOf(results.get(0).get("HotelName"))) : "N/A";
                var top1Score = results.size() > 0 ? formatScore(results.get(0).get("SimilarityScore")) : "N/A";
                var top2Name = results.size() > 1 ? truncateHotelName(String.valueOf(results.get(1).get("HotelName"))) : "N/A";
                var top2Score = results.size() > 1 ? formatScore(results.get(1).get("SimilarityScore")) : "N/A";

                System.out.printf("| %-13s | %-6s | %-24s | %6s | %-24s | %6s |%n",
                        algorithmName,
                        METRIC_LABELS.get(metric),
                        top1Name,
                        top1Score,
                        top2Name,
                        top2Score);
            }
        }

        System.out.println("\n====================================================================================================");
        System.out.println("Summary: Compared 2 algorithms x 3 metrics = 6 combinations");
        System.out.println("====================================================================================================");
    }

    private String truncateHotelName(String hotelName) {
        return hotelName.length() > 20 ? hotelName.substring(0, 20) + ".." : hotelName;
    }

    private String formatScore(Object value) {
        if (value instanceof Number number) {
            return String.format("%.4f", number.doubleValue());
        }
        return "N/A";
    }
}
