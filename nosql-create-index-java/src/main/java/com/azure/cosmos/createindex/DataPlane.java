package com.azure.cosmos.createindex;

import com.azure.ai.openai.OpenAIClient;
import com.azure.ai.openai.OpenAIClientBuilder;
import com.azure.ai.openai.models.EmbeddingsOptions;
import com.azure.core.credential.TokenCredential;
import com.azure.cosmos.CosmosClient;
import com.azure.cosmos.CosmosClientBuilder;
import com.azure.cosmos.CosmosContainer;
import com.azure.cosmos.models.CosmosBulkOperations;
import com.azure.cosmos.models.CosmosItemOperation;
import com.azure.cosmos.models.CosmosQueryRequestOptions;
import com.azure.cosmos.models.PartitionKeyBuilder;
import com.azure.cosmos.models.SqlParameter;
import com.azure.cosmos.models.SqlQuerySpec;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

public final class DataPlane {
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();
    private static final Pattern FIELD_NAME_PATTERN = Pattern.compile("^[A-Za-z_][A-Za-z0-9_]*$");

    private DataPlane() {
    }

    public static CosmosClient createCosmosClient(TokenCredential credential, SampleConfig config) {
        return new CosmosClientBuilder()
                .endpoint(config.cosmosEndpoint())
                .credential(credential)
                .contentResponseOnWriteEnabled(false)
                .buildClient();
    }

    public static OpenAIClient createAzureOpenAIClient(TokenCredential credential, SampleConfig config) {
        return new OpenAIClientBuilder()
                .endpoint(config.openAiEmbeddingEndpoint())
                .credential(credential)
                .buildClient();
    }

    public static List<Float> generateEmbedding(OpenAIClient client, SampleConfig config, String text) {
        EmbeddingsOptions options = new EmbeddingsOptions(List.of(text));
        return client.getEmbeddings(config.openAiEmbeddingDeployment(), options)
                .getData()
                .get(0)
                .getEmbedding();
    }

    public static void verifyEmbeddingDimensions(OpenAIClient client, SampleConfig config) {
        List<Float> embedding = generateEmbedding(client, config, "dimension check");
        int actualDimensions = embedding.size();

        if (actualDimensions != config.expectedDimensions()) {
            throw new IllegalStateException(
                    "Embedding dimensions do not match the container definition. Expected "
                            + config.expectedDimensions() + ", received " + actualDimensions + ".");
        }
    }

    public static List<Map<String, Object>> readDocuments(SampleConfig config) throws IOException {
        byte[] payload = Files.readAllBytes(config.dataFileWithVectors());
        List<Map<String, Object>> items = OBJECT_MAPPER.readValue(
                payload,
                new TypeReference<List<Map<String, Object>>>() {
                });

        java.util.Set<String> regionsFound = new java.util.LinkedHashSet<>();
        java.util.Set<String> validRegions = java.util.Set.of("Northeast", "Midwest", "South", "West");

        List<Map<String, Object>> documents = new ArrayList<>(items.size());
        for (int idx = 0; idx < items.size(); idx++) {
            Map<String, Object> item = items.get(idx);
            LinkedHashMap<String, Object> document = new LinkedHashMap<>(item);

            // Validate HotelId
            Object hotelId = document.get("HotelId");
            if (hotelId == null) {
                throw new IllegalStateException("Each document must contain HotelId.");
            }

            // Validate Region property
            Object region = document.get("Region");
            if (region == null) {
                throw new IllegalStateException(
                        "Document at index " + idx + " (HotelId=" + hotelId + ") missing Region property");
            }
            String regionStr = String.valueOf(region);
            if (!validRegions.contains(regionStr)) {
                throw new IllegalStateException(
                        "Document at index " + idx + " (HotelId=" + hotelId + ") has unexpected Region '" + regionStr + "'");
            }
            regionsFound.add(regionStr);

            document.put("id", String.valueOf(hotelId));
            // Do NOT overwrite Region — keep it as-is for partition key
            documents.add(document);
        }

        // Log region distribution
        System.out.println("✓ Region validation passed. Found regions: " + String.join(", ", regionsFound));

        return documents;
    }

    public static IngestionSummary ingestDocuments(
            CosmosContainer container,
            String containerName,
            List<Map<String, Object>> documents) {

        List<CosmosItemOperation> operations = new ArrayList<>(documents.size());
        for (Map<String, Object> document : documents) {
            // Extract Region from document for partition key
            Object region = document.get("Region");
            if (region == null) {
                throw new IllegalStateException("Document missing Region property");
            }
            operations.add(CosmosBulkOperations.getUpsertItemOperation(
                    document,
                    new PartitionKeyBuilder().add(String.valueOf(region)).build()));
        }

        int upsertedDocuments = 0;
        int failedDocuments = 0;
        double requestCharge = 0.0;

        for (var response : container.executeBulkOperations(operations)) {
            var itemResponse = response.getResponse();
            if (itemResponse == null) {
                failedDocuments++;
                continue;
            }

            requestCharge += itemResponse.getRequestCharge();
            int statusCode = itemResponse.getStatusCode();
            if (statusCode >= 200 && statusCode < 300) {
                upsertedDocuments++;
            } else {
                failedDocuments++;
            }
        }

        return new IngestionSummary(containerName, documents.size(), upsertedDocuments, failedDocuments, requestCharge);
    }

    public static QuerySummary queryTopMatches(
            CosmosContainer container,
            String containerName,
            SampleConfig config,
            List<Float> queryEmbedding,
            String distanceFunction) {
        String embeddingField = validateFieldName(config.embeddingFieldName());
        String queryText = "SELECT TOP @topK c.HotelId, c.HotelName, c.Description, "
                + "VectorDistance(c." + embeddingField + ", @embedding, false, {distanceFunction: '" + distanceFunction + "'}) AS SimilarityScore "
                + "FROM c ORDER BY VectorDistance(c." + embeddingField + ", @embedding, false, {distanceFunction: '" + distanceFunction + "'})";

        SqlQuerySpec querySpec = new SqlQuerySpec(
                queryText,
                List.of(
                        new SqlParameter("@topK", config.topCount()),
                        new SqlParameter("@embedding", toDoubleList(queryEmbedding))));

        CosmosQueryRequestOptions options = new CosmosQueryRequestOptions();
        List<QueryResult> results = new ArrayList<>();
        double requestCharge = 0.0;

        for (var page : container.queryItems(querySpec, options, Map.class).iterableByPage()) {
            requestCharge += page.getRequestCharge();
            for (Object item : page.getResults()) {
                @SuppressWarnings("unchecked")
                Map<String, Object> result = (Map<String, Object>) item;
                results.add(new QueryResult(
                        String.valueOf(result.get("HotelId")),
                        String.valueOf(result.get("HotelName")),
                        String.valueOf(result.get("Description")),
                        ((Number) result.get("SimilarityScore")).doubleValue()));
            }
        }

        return new QuerySummary(containerName, requestCharge, results);
    }

    public static void printQuerySummary(QuerySummary summary) {
        System.out.println("\n=== Query results: " + summary.containerName() + " ("
                + Config.algorithmLabel(summary.containerName()) + ") ===");
        System.out.printf("Request charge: %.2f RUs%n", summary.requestCharge());

        int rank = 1;
        for (QueryResult result : summary.results()) {
            System.out.printf("%d. HotelId=%s | HotelName=%s | score=%.4f | Description=%s%n",
                    rank++,
                    result.hotelId(),
                    result.hotelName(),
                    result.score(),
                    shorten(result.description()));
        }
    }

    private static String validateFieldName(String fieldName) {
        if (!FIELD_NAME_PATTERN.matcher(fieldName).matches()) {
            throw new IllegalArgumentException("Invalid embedding field name: " + fieldName);
        }
        return fieldName;
    }

    private static List<Double> toDoubleList(List<Float> embedding) {
        List<Double> values = new ArrayList<>(embedding.size());
        for (Float value : embedding) {
            values.add(value.doubleValue());
        }
        return values;
    }

    private static String shorten(String value) {
        if (value == null || value.length() <= 110) {
            return value;
        }
        return value.substring(0, 107).trim() + "...";
    }

    public static void clearContainerData(CosmosContainer container) {
        try {
            SqlQuerySpec querySpec = new SqlQuerySpec("SELECT c.id FROM c");
            container.queryItems(querySpec, new CosmosQueryRequestOptions(), Map.class)
                    .stream()
                    .forEach(item -> {
                        String id = String.valueOf(item.get("id"));
                        container.deleteItem(id, new PartitionKeyBuilder()
                                .add("hotels")
                                .build(),
                                null);
                    });
        } catch (Exception e) {
            throw new RuntimeException("Failed to clear container data: " + e.getMessage(), e);
        }
    }
}

record IngestionSummary(
        String containerName,
        int totalDocuments,
        int upsertedDocuments,
        int failedDocuments,
        double requestCharge) {
}

record QueryResult(
        String hotelId,
        String hotelName,
        String description,
        double score) {
}

record QuerySummary(
        String containerName,
        double requestCharge,
        List<QueryResult> results) {
}
