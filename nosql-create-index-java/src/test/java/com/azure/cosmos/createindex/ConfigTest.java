package com.azure.cosmos.createindex;

import org.junit.jupiter.api.Test;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ConfigTest {
    @Test
    void requiresLocation() {
        IllegalArgumentException exception = assertThrows(
                IllegalArgumentException.class,
                () -> Config.validate(config("hotels_diskann", "hotels_quantizedflat", null, false)));

        assertTrue(exception.getMessage().contains("AZURE_LOCATION"));
    }

    @Test
    void rejectsDuplicateContainerNamesIgnoringCase() {
        IllegalArgumentException exception = assertThrows(
                IllegalArgumentException.class,
                () -> Config.validate(config("Hotels_Index", "hotels_index", "eastus2", true)));

        assertTrue(exception.getMessage().contains("case-insensitive"));
    }

    @Test
    void permitsDefaultContainerNamesWithoutOptIn() {
        assertDoesNotThrow(
                () -> Config.validate(config("hotels_diskann", "hotels_quantizedflat", "eastus2", false)));
    }

    @Test
    void requiresOptInForCustomContainerDeletion() {
        IllegalArgumentException exception = assertThrows(
                IllegalArgumentException.class,
                () -> Config.validate(config("custom_diskann", "custom_quantizedflat", "eastus2", false)));

        assertTrue(exception.getMessage().contains(
                "AZURE_COSMOSDB_CREATE_INDEX_ALLOW_CUSTOM_CONTAINER_DELETION=true"));
        assertDoesNotThrow(
                () -> Config.validate(config("custom_diskann", "custom_quantizedflat", "eastus2", true)));
    }

    private static SampleConfig config(
            String diskannName,
            String quantizedFlatName,
            String location,
            boolean allowCustomContainerDeletion) {
        return new SampleConfig(
                "subscription",
                "resource-group",
                "account",
                "https://account.documents.azure.com:443/",
                "HotelsCreateIndex",
                null,
                diskannName,
                quantizedFlatName,
                location,
                "https://openai.openai.azure.com/",
                "embedding-deployment",
                "2024-08-01-preview",
                null,
                Path.of("pom.xml").toAbsolutePath(),
                "hotel near the ocean",
                "embedding",
                5,
                1536,
                "Northeast",
                allowCustomContainerDeletion);
    }
}
