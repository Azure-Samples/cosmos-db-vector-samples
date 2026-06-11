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

        // ── Clients ─────────────────────────────────────────────────────
        OpenAIClient aiClient = Utils.createOpenAIClient();
        CosmosClient dbClient = Utils.createCosmosClient();

        try {
            var database = dbClient.getDatabase(dbName);
            System.out.println("Connected to database: " + dbName);

            CosmosContainer container = database.getContainer(containerName);
            System.out.println("Connected to container: " + containerName);
            System.out.println("\n[Algorithm] Vector Search Algorithm: " + algorithmDisplay);
            System.out.println("[Distance]  Distance Function: " + distanceFunction);
            if (compareMetrics) {
                System.out.println("[Comparison] Mode: All 3 metrics");
            }

            // Verify container exists
            container.read();

            // ── Load & Insert Data ──────────────────────────────────────
            var dataPath = Path.of(dataFile);
            var data = Utils.readJsonFile(dataPath);
            Utils.insertData(container, data);

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
                runMetricComparison(container, embeddingDoubles, embeddedField);
            } else {
                runSingleMetricQuery(container, embeddingDoubles, embeddedField, distanceFunction);
            }

            System.out.println("\nVector search completed successfully!");
        } finally {
            dbClient.close();
        }
    }

    private void runSingleMetricQuery(
            CosmosContainer container,
            List<Double> embedding,
            String embeddedField,
            String distanceFunction) throws Exception {

        var safeField = Utils.validateFieldName(embeddedField);
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
            CosmosContainer container,
            List<Double> embedding,
            String embeddedField) throws Exception {

        var safeField = Utils.validateFieldName(embeddedField);
        var resultMap = new HashMap<String, Map<String, Object>>();
        var charges = new HashMap<String, Double>();

        System.out.println("\n--- Comparing All Distance Metrics ---");

        // Execute query for each distance function
        for (var metric : VALID_DISTANCE_FUNCTIONS) {
            var queryText = "SELECT TOP 5 c.HotelName, c.Description, c.Rating, " +
                    "VectorDistance(c." + safeField + ", @embedding, false, {\"distanceFunction\": \"" + metric + "\"}) AS Score " +
                    "FROM c " +
                    "ORDER BY VectorDistance(c." + safeField + ", @embedding, false, {\"distanceFunction\": \"" + metric + "\"})";

            var sqlQuery = new SqlQuerySpec(
                    queryText,
                    List.of(new SqlParameter("@embedding", embedding))
            );

            var queryOptions = new CosmosQueryRequestOptions();

            @SuppressWarnings("unchecked")
            var resultPages = container.queryItems(sqlQuery, queryOptions, Map.class);

            var totalCharge = 0.0;

            for (var page : resultPages.iterableByPage()) {
                totalCharge += page.getRequestCharge();
                for (var item : page.getResults()) {
                    @SuppressWarnings("unchecked")
                    var typedItem = (Map<String, Object>) item;

                    var hotelName = (String) typedItem.get("HotelName");
                    var score = ((Number) typedItem.get("Score")).doubleValue();

                    if (!resultMap.containsKey(hotelName)) {
                        var result = new HashMap<String, Object>();
                        result.put("HotelName", hotelName);
                        result.put("Description", typedItem.get("Description"));
                        result.put("Rating", typedItem.get("Rating"));
                        result.put("Scores", new HashMap<String, Double>());
                        resultMap.put(hotelName, result);
                    }

                    @SuppressWarnings("unchecked")
                    var scores = (Map<String, Double>) resultMap.get(hotelName).get("Scores");
                    scores.put(metric, score);
                }
            }

            charges.put(metric, totalCharge);
        }

        // Print comparison results
        System.out.println("\nHotels ranked by each distance metric:");
        int idx = 1;
        for (var entry : resultMap.entrySet()) {
            var result = entry.getValue();
            System.out.println("\n" + idx + ". " + result.get("HotelName"));
            @SuppressWarnings("unchecked")
            var scores = (Map<String, Double>) result.get("Scores");
            for (var metric : VALID_DISTANCE_FUNCTIONS) {
                if (scores.containsKey(metric)) {
                    System.out.printf("   %s: %.4f%n", metric, scores.get(metric));
                }
            }
            idx++;
        }

        System.out.println("\n--- Request Charges per Metric ---");
        for (var metric : VALID_DISTANCE_FUNCTIONS) {
            System.out.printf("%s: %.2f RUs%n", metric, charges.getOrDefault(metric, 0.0));
        }
        System.out.println();
    }
}
