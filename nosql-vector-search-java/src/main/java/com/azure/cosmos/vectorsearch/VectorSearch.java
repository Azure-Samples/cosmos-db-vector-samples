package com.azure.cosmos.vectorsearch;

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
 * - DiskANN and QuantizedFlat algorithm selection via environment variable
 */
public final class VectorSearch {

    private static final String SAMPLE_QUERY =
            "quintessential lodging near running trails, eateries, retail";

    private static final Set<String> VALID_ALGORITHMS = Set.of("diskann", "quantizedflat");

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
    }

    private void run() throws Exception {
        // ── Configuration ───────────────────────────────────────────────
        var algorithm = Utils.envOrDefault("VECTOR_ALGORITHM", "diskann").trim().toLowerCase();
        var dbName = Utils.envOrDefault("AZURE_COSMOSDB_DATABASENAME", "Hotels");
        var dataFile = Utils.requireEnv("DATA_FILE_WITH_VECTORS");
        var embeddedField = Utils.requireEnv("EMBEDDED_FIELD");
        var deployment = Utils.requireEnv("AZURE_OPENAI_EMBEDDING_MODEL");
        var distanceFunction = Utils.envOrDefault("VECTOR_DISTANCE_FUNCTION", "cosine");

        if (!VALID_ALGORITHMS.contains(algorithm)) {
            throw new IllegalArgumentException(
                    "Invalid algorithm '" + algorithm + "'. Must be one of: " +
                    String.join(", ", VALID_ALGORITHMS));
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
            System.out.println("\n\uD83D\uDCCA Vector Search Algorithm: " + algorithmDisplay);
            System.out.println("\uD83D\uDCCF Distance Function: " + distanceFunction);

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

            // ── Build & Execute Vector Search Query ─────────────────────
            var safeField = Utils.validateFieldName(embeddedField);
            var queryText = "SELECT TOP 5 c.HotelName, c.Description, c.Rating, " +
                    "VectorDistance(c." + safeField + ", @embedding) AS SimilarityScore " +
                    "FROM c " +
                    "ORDER BY VectorDistance(c." + safeField + ", @embedding)";

            System.out.println("\n--- Executing Vector Search Query ---");
            System.out.println("Query: " + queryText);
            System.out.println("Parameters: @embedding (vector with " + embeddingDoubles.size() + " dimensions)");
            System.out.println("--------------------------------------\n");

            var sqlQuery = new SqlQuerySpec(
                    queryText,
                    List.of(new SqlParameter("@embedding", embeddingDoubles))
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

        } finally {
            dbClient.close();
        }
    }
}
