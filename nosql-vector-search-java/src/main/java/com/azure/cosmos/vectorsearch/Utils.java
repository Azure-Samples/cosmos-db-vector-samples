package com.azure.cosmos.vectorsearch;

import com.azure.ai.openai.OpenAIClientBuilder;
import com.azure.ai.openai.OpenAIClient;
import com.azure.cosmos.CosmosClient;
import com.azure.cosmos.CosmosClientBuilder;
import com.azure.cosmos.CosmosContainer;
import com.azure.cosmos.models.CosmosBulkOperations;
import com.azure.cosmos.models.CosmosItemOperation;
import com.azure.cosmos.models.PartitionKey;
import com.azure.cosmos.models.PartitionKeyBuilder;
import com.azure.identity.DefaultAzureCredentialBuilder;

import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Shared utilities for Azure Cosmos DB NoSQL vector search sample.
 * Provides authentication, bulk insert, field validation, and result formatting.
 */
public final class Utils {

    private static final JsonMapper JSON_MAPPER = JsonMapper.builder().build();

    private Utils() {
        // utility class
    }

    // ── Authentication ──────────────────────────────────────────────────

    /**
     * Create an Azure OpenAI client using DefaultAzureCredential (passwordless).
     */
    public static OpenAIClient createOpenAIClient() {
        var endpoint = requireEnv("AZURE_OPENAI_EMBEDDING_ENDPOINT");
        var credential = new DefaultAzureCredentialBuilder().build();
        return new OpenAIClientBuilder()
                .endpoint(endpoint)
                .credential(credential)
                .buildClient();
    }

    /**
     * Create a Cosmos DB client using DefaultAzureCredential (passwordless).
     */
    public static CosmosClient createCosmosClient() {
        var endpoint = requireEnv("AZURE_COSMOSDB_ENDPOINT");
        var credential = new DefaultAzureCredentialBuilder().build();
        return new CosmosClientBuilder()
                .endpoint(endpoint)
                .credential(credential)
                .buildClient();
    }

    // ── Data Loading ────────────────────────────────────────────────────

    /**
     * Read a JSON array file and return its contents as a list of maps.
     */
    @SuppressWarnings("unchecked")
    public static List<Map<String, Object>> readJsonFile(Path filePath) throws IOException {
        System.out.println("Reading JSON file from " + filePath);
        var bytes = Files.readAllBytes(filePath);
        return JSON_MAPPER.readValue(bytes, List.class);
    }

    // ── Bulk Insert ─────────────────────────────────────────────────────

    /**
     * Insert documents into a Cosmos DB container using bulk operations.
     * Skips insert if the container already contains data.
     *
     * @return summary with counts and RU charge
     */
    public static BulkInsertResult insertData(CosmosContainer container,
                                               List<Map<String, Object>> data) {
        // Check existing document count
        var existingCount = getDocumentCount(container);
        if (existingCount > 0) {
            System.out.println("Container already has " + existingCount + " documents. Skipping insert.");
            return new BulkInsertResult(0, 0, 0, (int) existingCount, 0.0);
        }

        System.out.println("Inserting " + data.size() + " items using bulk operations...");

        // Build bulk create operations
        var operations = new ArrayList<CosmosItemOperation>();
        for (var item : data) {
            // Cosmos DB requires an "id" field — map HotelId to id
            var doc = new java.util.HashMap<>(item);
            var hotelId = String.valueOf(doc.get("HotelId"));
            doc.put("id", hotelId);
            operations.add(CosmosBulkOperations.getCreateItemOperation(doc,
                new PartitionKeyBuilder().add(hotelId).build()));
        }

        var inserted = 0;
        var failed = 0;
        var skipped = 0;
        var totalRUs = 0.0;

        var startTime = System.currentTimeMillis();
        System.out.println("Starting bulk insert (" + operations.size() + " items)...");

        var responses = container.executeBulkOperations(operations);
        for (var response : responses) {
            var statusCode = response.getResponse().getStatusCode();
            totalRUs += response.getResponse().getRequestCharge();

            if (statusCode >= 200 && statusCode < 300) {
                inserted++;
            } else if (statusCode == 409) {
                skipped++;
            } else {
                failed++;
            }
        }

        var durationSec = (System.currentTimeMillis() - startTime) / 1000.0;
        System.out.printf("Bulk insert completed in %.2fs%n", durationSec);
        System.out.printf("%nInsert Request Charge: %.2f RUs%n%n", totalRUs);

        return new BulkInsertResult(data.size(), inserted, failed, skipped, totalRUs);
    }

    private static long getDocumentCount(CosmosContainer container) {
        var result = container.queryItems(
                "SELECT VALUE COUNT(1) FROM c",
                new com.azure.cosmos.models.CosmosQueryRequestOptions(),
                Long.class
        );
        for (var count : result) {
            return count;
        }
        return 0;
    }

    // ── Field Name Validation ───────────────────────────────────────────

    /**
     * Validates a field name to prevent NoSQL injection when building queries
     * with string interpolation.
     *
     * @param fieldName the field name to validate
     * @return the validated field name
     * @throws IllegalArgumentException if the field name contains unsafe characters
     */
    public static String validateFieldName(String fieldName) {
        if (!fieldName.matches("^[A-Za-z_][A-Za-z0-9_]*$")) {
            throw new IllegalArgumentException(
                    "Invalid field name: \"" + fieldName + "\". " +
                    "Field names must start with a letter or underscore " +
                    "and contain only letters, numbers, and underscores.");
        }
        return fieldName;
    }

    // ── Output Formatting ───────────────────────────────────────────────

    /**
     * Print search results in a consistent tabular format.
     */
    public static void printSearchResults(List<Map<String, Object>> results, double requestCharge) {
        System.out.println("\n--- Search Results ---");

        if (results == null || results.isEmpty()) {
            System.out.println("No results found.");
            return;
        }

        for (var i = 0; i < results.size(); i++) {
            var r = results.get(i);
            var name = r.get("HotelName");
            var score = r.get("SimilarityScore");
            System.out.printf("%d. %s, Score: %.4f%n", i + 1, name, ((Number) score).doubleValue());
        }

        System.out.printf("%nVector Search Request Charge: %.2f RUs%n%n", requestCharge);
    }

    // ── Environment Helpers ─────────────────────────────────────────────

    public static String requireEnv(String key) {
        var value = System.getenv(key);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Required environment variable not set: " + key);
        }
        return value;
    }

    public static String envOrDefault(String key, String defaultValue) {
        var value = System.getenv(key);
        return (value != null && !value.isBlank()) ? value : defaultValue;
    }

    // ── Result Record ───────────────────────────────────────────────────

    public record BulkInsertResult(int total, int inserted, int failed, int skipped, double requestCharge) {}
}
