package com.azure.cosmos.createindex;

import io.github.cdimascio.dotenv.Dotenv;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

public final class Config {
    private static final Map<String, String> KNOWN_CONTAINERS = Map.of(
            "diskann", "hotels_diskann",
            "quantizedflat", "hotels_quantizedflat"
    );
    private static final List<String> TARGET_CONTAINERS = List.of("hotels_diskann", "hotels_quantizedflat");

    private static final String DEFAULT_DATABASE_NAME = "Hotels";
    private static final String DEFAULT_API_VERSION = "2024-08-01-preview";
    private static final String DEFAULT_QUERY_TEXT = "hotel near the ocean";
    private static final String DEFAULT_DATA_FILE = "..\\data\\HotelsData_toCosmosDB_Vector.json";
    private static final String DEFAULT_EMBEDDING_FIELD = "DescriptionVector";
    private static final int DEFAULT_TOP_COUNT = 5;
    private static final int EXPECTED_DIMENSIONS = 1536;

    private Config() {
    }

    public static SampleConfig load() {
        Dotenv dotenv = Dotenv.configure().ignoreIfMissing().load();

        String databaseName = read(dotenv, "AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME", DEFAULT_DATABASE_NAME);
        String containerName = read(dotenv, "AZURE_COSMOSDB_CONTAINER_NAME", null);
        String vectorAlgorithm = read(dotenv, "VECTOR_ALGORITHM", null);
        if (vectorAlgorithm != null) {
            vectorAlgorithm = vectorAlgorithm.toLowerCase();
        }

        Path sampleRoot = Path.of("").toAbsolutePath().normalize();
        Path dataFile = sampleRoot.resolve(read(dotenv, "DATA_FILE_WITH_VECTORS", DEFAULT_DATA_FILE)).normalize();

        return new SampleConfig(
                read(dotenv, "AZURE_COSMOSDB_ENDPOINT", null),
                databaseName,
                containerName,
                read(dotenv, "AZURE_OPENAI_EMBEDDING_ENDPOINT", null),
                read(dotenv, "AZURE_OPENAI_EMBEDDING_DEPLOYMENT", null),
                read(dotenv, "AZURE_OPENAI_EMBEDDING_API_VERSION", DEFAULT_API_VERSION),
                vectorAlgorithm,
                dataFile,
                DEFAULT_QUERY_TEXT,
                DEFAULT_EMBEDDING_FIELD,
                DEFAULT_TOP_COUNT,
                EXPECTED_DIMENSIONS
        );
    }

    public static void validate(SampleConfig config) {
        StringBuilder missing = new StringBuilder();
        appendMissing(missing, "AZURE_COSMOSDB_ENDPOINT", config.cosmosEndpoint());
        appendMissing(missing, "AZURE_COSMOSDB_DATABASENAME", config.databaseName());
        appendMissing(missing, "AZURE_OPENAI_EMBEDDING_ENDPOINT", config.openAiEmbeddingEndpoint());
        appendMissing(missing, "AZURE_OPENAI_EMBEDDING_DEPLOYMENT", config.openAiEmbeddingDeployment());

        if (missing.length() > 0) {
            throw new IllegalArgumentException("Missing required environment variables: " + missing);
        }

        if (config.vectorAlgorithm() != null && !KNOWN_CONTAINERS.containsKey(config.vectorAlgorithm())) {
            throw new IllegalArgumentException("VECTOR_ALGORITHM must be one of: diskann, quantizedflat.");
        }

        if (config.containerName() != null && !TARGET_CONTAINERS.contains(config.containerName())) {
            throw new IllegalArgumentException("AZURE_COSMOSDB_CONTAINER_NAME must be one of: hotels_diskann, hotels_quantizedflat.");
        }

        if (config.containerName() != null && config.vectorAlgorithm() != null) {
            String expectedContainer = KNOWN_CONTAINERS.get(config.vectorAlgorithm());
            if (!config.containerName().equals(expectedContainer)) {
                throw new IllegalArgumentException(
                        "AZURE_COSMOSDB_CONTAINER_NAME and VECTOR_ALGORITHM refer to different containers.");
            }
        }

        if (!config.dataFileWithVectors().toFile().exists()) {
            throw new IllegalArgumentException("DATA_FILE_WITH_VECTORS does not exist: " + config.dataFileWithVectors());
        }
    }

    public static List<String> targetContainers(SampleConfig config) {
        if (config.containerName() != null) {
            return List.of(config.containerName());
        }
        if (config.vectorAlgorithm() != null) {
            return List.of(KNOWN_CONTAINERS.get(config.vectorAlgorithm()));
        }
        return TARGET_CONTAINERS;
    }

    public static String algorithmLabel(String containerName) {
        return switch (containerName) {
            case "hotels_diskann" -> "DiskANN";
            case "hotels_quantizedflat" -> "QuantizedFlat";
            default -> containerName;
        };
    }

    private static String read(Dotenv dotenv, String name, String defaultValue) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            value = dotenv.get(name);
        }
        if (value == null || value.isBlank()) {
            return defaultValue;
        }
        return value.trim();
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
        String cosmosEndpoint,
        String databaseName,
        String containerName,
        String openAiEmbeddingEndpoint,
        String openAiEmbeddingDeployment,
        String openAiEmbeddingApiVersion,
        String vectorAlgorithm,
        Path dataFileWithVectors,
        String queryText,
        String embeddingFieldName,
        int topCount,
        int expectedDimensions) {
}
