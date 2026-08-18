package com.azure.cosmos.createindex;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

public final class Config {
    // Default container names (non-language-specific)
    private static final String DEFAULT_DISKANN_CONTAINER = "hotels_diskann";
    private static final String DEFAULT_QUANTIZEDFLAT_CONTAINER = "hotels_quantizedflat";

    private static final String DEFAULT_API_VERSION = "2024-08-01-preview";

    private Config() {
    }

    public static SampleConfig load() {
        String databaseName = read("AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME", "HotelsCreateIndex");
        String diskannContainerName = read("AZURE_COSMOSDB_CREATE_INDEX_DISKANN_CONTAINER_NAME", DEFAULT_DISKANN_CONTAINER);
        String quantizedflatContainerName = read("AZURE_COSMOSDB_CREATE_INDEX_QUANTIZEDFLAT_CONTAINER_NAME", DEFAULT_QUANTIZEDFLAT_CONTAINER);
        String containerName = read("AZURE_COSMOSDB_CONTAINER_NAME", null);
        String location = read("AZURE_LOCATION", "West US 3");
        String vectorAlgorithm = read("VECTOR_ALGORITHM", null);
        if (vectorAlgorithm != null) {
            vectorAlgorithm = vectorAlgorithm.toLowerCase();
        }

        Path sampleRoot = Path.of("").toAbsolutePath().normalize();
        String dataFileSetting = read("DATA_FILE_WITH_VECTORS_AND_REGIONS", "./data/HotelsData_toCosmosDB_Vector_byRegion.json");
        Path dataFile = sampleRoot.resolve(dataFileSetting).normalize();

        return new SampleConfig(
                read("AZURE_SUBSCRIPTION_ID", null),
                read("AZURE_RESOURCE_GROUP", null),
                read("AZURE_COSMOSDB_ACCOUNT_NAME", null),
                read("AZURE_COSMOSDB_ENDPOINT", null),
                databaseName,
                containerName,
                diskannContainerName,
                quantizedflatContainerName,
                location,
                read("AZURE_OPENAI_EMBEDDING_ENDPOINT", null),
                read("AZURE_OPENAI_EMBEDDING_DEPLOYMENT", null),
                read("AZURE_OPENAI_EMBEDDING_API_VERSION", "2024-08-01-preview"),
                vectorAlgorithm,
                dataFile,
                "hotel near the ocean",
                read("AZURE_COSMOSDB_CREATE_INDEX_EMBEDDED_FIELD", "embedding"),
                5,
                1536,
                read("PARTITION_KEY_VALUE", "Northeast")
        );
    }

    public static void validate(SampleConfig config) {
        StringBuilder missing = new StringBuilder();
        appendMissing(missing, "AZURE_SUBSCRIPTION_ID", config.subscriptionId());
        appendMissing(missing, "AZURE_RESOURCE_GROUP", config.resourceGroup());
        appendMissing(missing, "AZURE_COSMOSDB_ACCOUNT_NAME", config.accountName());
        appendMissing(missing, "AZURE_COSMOSDB_ENDPOINT", config.cosmosEndpoint());
        appendMissing(missing, "AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME", config.databaseName());
        appendMissing(missing, "AZURE_LOCATION", config.location());
        appendMissing(missing, "AZURE_OPENAI_EMBEDDING_ENDPOINT", config.openAiEmbeddingEndpoint());
        appendMissing(missing, "AZURE_OPENAI_EMBEDDING_DEPLOYMENT", config.openAiEmbeddingDeployment());

        if (missing.length() > 0) {
            throw new IllegalArgumentException("Missing required environment variables: " + missing);
        }

        Map<String, String> knownContainers = Map.of(
                "diskann", config.diskannContainerName(),
                "quantizedflat", config.quantizedflatContainerName()
        );

        if (config.vectorAlgorithm() != null && !knownContainers.containsKey(config.vectorAlgorithm())) {
            throw new IllegalArgumentException("VECTOR_ALGORITHM must be one of: diskann, quantizedflat.");
        }

        List<String> targetContainers = List.of(config.diskannContainerName(), config.quantizedflatContainerName());
        if (config.containerName() != null && !targetContainers.contains(config.containerName())) {
            throw new IllegalArgumentException("AZURE_COSMOSDB_CONTAINER_NAME must match AZURE_COSMOSDB_CREATE_INDEX_DISKANN_CONTAINER_NAME or AZURE_COSMOSDB_CREATE_INDEX_QUANTIZEDFLAT_CONTAINER_NAME.");
        }

        if (config.containerName() != null && config.vectorAlgorithm() != null) {
            String expectedContainer = knownContainers.get(config.vectorAlgorithm());
            if (!config.containerName().equals(expectedContainer)) {
                throw new IllegalArgumentException(
                        "AZURE_COSMOSDB_CONTAINER_NAME and VECTOR_ALGORITHM refer to different containers.");
            }
        }

        if (!config.dataFileWithVectors().toFile().exists()) {
            throw new IllegalArgumentException("DATA_FILE_WITH_VECTORS_AND_REGIONS does not exist: " + config.dataFileWithVectors());
        }
    }

    public static List<String> targetContainers(SampleConfig config) {
        if (config.containerName() != null) {
            return List.of(config.containerName());
        }
        if (config.vectorAlgorithm() != null) {
            String containerName = config.vectorAlgorithm().equals("diskann") 
                    ? config.diskannContainerName() 
                    : config.quantizedflatContainerName();
            return List.of(containerName);
        }
        return List.of(config.diskannContainerName(), config.quantizedflatContainerName());
    }

    public static String algorithmLabel(String containerName, SampleConfig config) {
        if (containerName.equals(config.diskannContainerName())) {
            return "DiskANN";
        }
        if (containerName.equals(config.quantizedflatContainerName())) {
            return "QuantizedFlat";
        }
        return containerName;
    }

    private static String read(String name, String defaultValue) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            return defaultValue;
        }
        return trimQuotes(value.trim());
    }

    /**
     * Strips surrounding quotes from environment variable values.
     * Handles .env files that use quoted values like: KEY="value" or KEY='value'
     */
    private static String trimQuotes(String value) {
        if (value.length() >= 2) {
            char first = value.charAt(0);
            char last = value.charAt(value.length() - 1);
            if ((first == '"' && last == '"') || (first == '\'' && last == '\'')) {
                return value.substring(1, value.length() - 1);
            }
        }
        return value;
    }

    private static void appendMissing(StringBuilder missing, String name, String value) {
        if (value == null || value.isBlank()) {
            if (!missing.isEmpty()) {
                missing.append(", ");
            }
            missing.append(name);
        }
    }
}

record SampleConfig(
        String subscriptionId,
        String resourceGroup,
        String accountName,
        String cosmosEndpoint,
        String databaseName,
        String containerName,
        String diskannContainerName,
        String quantizedflatContainerName,
        String location,
        String openAiEmbeddingEndpoint,
        String openAiEmbeddingDeployment,
        String openAiEmbeddingApiVersion,
        String vectorAlgorithm,
        Path dataFileWithVectors,
        String queryText,
        String embeddingFieldName,
        int topCount,
        int expectedDimensions,
        String partitionKeyValue) {
}
