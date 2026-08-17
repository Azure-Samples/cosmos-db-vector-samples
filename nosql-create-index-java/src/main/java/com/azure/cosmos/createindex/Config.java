package com.azure.cosmos.createindex;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

public final class Config {
    // Default container names (non-language-specific)
    private static final String DEFAULT_DISKANN_CONTAINER = "hotels_diskann";
    private static final String DEFAULT_QUANTIZEDFLAT_CONTAINER = "hotels_quantizedflat";
    private static final String ALLOW_CUSTOM_CONTAINER_DELETION =
            "AZURE_COSMOSDB_CREATE_INDEX_ALLOW_CUSTOM_CONTAINER_DELETION";

    private static final String DEFAULT_API_VERSION = "2024-08-01-preview";

    private Config() {
    }

    public static SampleConfig load() {
        String databaseName = read("AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME", "HotelsCreateIndex");
        String diskannContainerName = read("AZURE_COSMOSDB_CREATE_INDEX_DISKANN_CONTAINER_NAME", DEFAULT_DISKANN_CONTAINER);
        String quantizedflatContainerName = read("AZURE_COSMOSDB_CREATE_INDEX_QUANTIZEDFLAT_CONTAINER_NAME", DEFAULT_QUANTIZEDFLAT_CONTAINER);
        String containerName = read("AZURE_COSMOSDB_CONTAINER_NAME", null);
        String location = read("AZURE_LOCATION", null);
        boolean allowCustomContainerDeletion = readBoolean(ALLOW_CUSTOM_CONTAINER_DELETION, false);
        String vectorAlgorithm = read("VECTOR_ALGORITHM", null);
        if (vectorAlgorithm != null) {
            vectorAlgorithm = vectorAlgorithm.toLowerCase();
        }

        Path sampleRoot = Path.of("").toAbsolutePath().normalize();
        String dataFileSetting = read("DATA_FILE_WITH_VECTORS_AND_REGIONS", null);
        if (dataFileSetting == null) {
            dataFileSetting = read("DATA_FILE_WITH_VECTORS", "./data/HotelsData_toCosmosDB_Vector_byRegion.json");
        }
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
                read("PARTITION_KEY_VALUE", "Northeast"),
                allowCustomContainerDeletion
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

        if (config.diskannContainerName().equalsIgnoreCase(config.quantizedflatContainerName())) {
            throw new IllegalArgumentException(
                    "DiskANN and QuantizedFlat container names must be different (case-insensitive).");
        }

        boolean usesDefaultContainerNames =
                DEFAULT_DISKANN_CONTAINER.equals(config.diskannContainerName())
                        && DEFAULT_QUANTIZEDFLAT_CONTAINER.equals(config.quantizedflatContainerName());
        if (!usesDefaultContainerNames && !config.allowCustomContainerDeletion()) {
            throw new IllegalArgumentException(
                    "Custom container names require "
                            + ALLOW_CUSTOM_CONTAINER_DELETION
                            + "=true because the sample overwrites and deletes its configured containers.");
        }

        Map<String, String> knownContainers = Map.of(
                "diskann", config.diskannContainerName(),
                "quantizedflat", config.quantizedflatContainerName()
        );

        if (config.vectorAlgorithm() != null && !knownContainers.containsKey(config.vectorAlgorithm())) {
            throw new IllegalArgumentException("VECTOR_ALGORITHM must be one of: diskann, quantizedflat.");
        }

        List<String> targetContainers = List.of(config.diskannContainerName(), config.quantizedflatContainerName());
        if (config.containerName() != null
                && targetContainers.stream().noneMatch(name -> name.equalsIgnoreCase(config.containerName()))) {
            throw new IllegalArgumentException("AZURE_COSMOSDB_CONTAINER_NAME must match AZURE_COSMOSDB_CREATE_INDEX_DISKANN_CONTAINER_NAME or AZURE_COSMOSDB_CREATE_INDEX_QUANTIZEDFLAT_CONTAINER_NAME.");
        }

        if (config.containerName() != null && config.vectorAlgorithm() != null) {
            String expectedContainer = knownContainers.get(config.vectorAlgorithm());
            if (!config.containerName().equalsIgnoreCase(expectedContainer)) {
                throw new IllegalArgumentException(
                        "AZURE_COSMOSDB_CONTAINER_NAME and VECTOR_ALGORITHM refer to different containers.");
            }
        }

        if (!config.dataFileWithVectors().toFile().exists()) {
            throw new IllegalArgumentException("DATA_FILE_WITH_VECTORS_AND_REGIONS (or DATA_FILE_WITH_VECTORS) does not exist: " + config.dataFileWithVectors());
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
        if (containerName.equalsIgnoreCase(config.diskannContainerName())) {
            return "DiskANN";
        }
        if (containerName.equalsIgnoreCase(config.quantizedflatContainerName())) {
            return "QuantizedFlat";
        }
        return containerName;
    }

    private static boolean readBoolean(String name, boolean defaultValue) {
        String value = read(name, null);
        if (value == null) {
            return defaultValue;
        }
        if ("true".equalsIgnoreCase(value)) {
            return true;
        }
        if ("false".equalsIgnoreCase(value)) {
            return false;
        }
        throw new IllegalArgumentException(name + " must be true or false.");
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
        String partitionKeyValue,
        boolean allowCustomContainerDeletion) {
}
