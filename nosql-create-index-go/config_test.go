package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadConfigFromEnv_AllowsEmptyPrimaryContainer(t *testing.T) {
	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("get working directory: %v", err)
	}

	cfg, err := LoadConfigFromEnv(func(key string) string {
		values := map[string]string{
			"AZURE_COSMOSDB_ENDPOINT":            "https://example.documents.azure.com:443/",
			"AZURE_COSMOSDB_DATABASENAME":        "Hotels",
			"AZURE_OPENAI_EMBEDDING_ENDPOINT":    "https://example.openai.azure.com/",
			"AZURE_OPENAI_EMBEDDING_DEPLOYMENT":  "text-embedding-3-small",
			"AZURE_SUBSCRIPTION_ID":              "sub-id",
			"AZURE_RESOURCE_GROUP":               "rg",
			"AZURE_COSMOSDB_ACCOUNT_NAME":        "account",
			"AZURE_LOCATION":                     "eastus2",
			"DATA_FILE_WITH_VECTORS_AND_REGIONS": filepath.Join(wd, "..", "data", "HotelsData_toCosmosDB_Vector_byRegion.json"),
		}
		return values[key]
	})
	if err != nil {
		t.Fatalf("LoadConfigFromEnv returned error: %v", err)
	}

	expected := []string{defaultDiskANNContainer, defaultQuantizedFlatContainer}
	if strings.Join(cfg.ContainerNames, ",") != strings.Join(expected, ",") {
		t.Fatalf("expected containers %v, got %v", expected, cfg.ContainerNames)
	}
}

func TestLoadConfigFromEnv_UsesCustomNamesForAlgorithmMapping(t *testing.T) {
	cfg, err := loadTestConfig(t, map[string]string{
		"AZURE_COSMOSDB_CREATE_INDEX_DISKANN_CONTAINER_NAME":       "custom_diskann",
		"AZURE_COSMOSDB_CREATE_INDEX_QUANTIZEDFLAT_CONTAINER_NAME": "custom_quantizedflat",
		"AZURE_COSMOSDB_CREATE_INDEX_ALLOW_DESTRUCTIVE_OPERATIONS": "true",
		"VECTOR_ALGORITHM":              "diskann",
		"AZURE_COSMOSDB_CONTAINER_NAME": "custom_diskann",
	})
	if err != nil {
		t.Fatalf("LoadConfigFromEnv returned error: %v", err)
	}
	if cfg.PrimaryContainerName != "custom_diskann" || cfg.ContainerNames[0] != "custom_diskann" {
		t.Fatalf("custom names were not used consistently: %+v", cfg.ContainerNames)
	}
}

func TestLoadConfigFromEnv_RejectsIdenticalContainerNames(t *testing.T) {
	_, err := loadTestConfig(t, map[string]string{
		"AZURE_COSMOSDB_CREATE_INDEX_DISKANN_CONTAINER_NAME":       "same",
		"AZURE_COSMOSDB_CREATE_INDEX_QUANTIZEDFLAT_CONTAINER_NAME": "same",
	})
	if err == nil || !strings.Contains(err.Error(), "must be different") {
		t.Fatalf("expected identical-name validation error, got %v", err)
	}
}

func TestLoadConfigFromEnv_CustomNamesRequireDestructiveOptIn(t *testing.T) {
	_, err := loadTestConfig(t, map[string]string{
		"AZURE_COSMOSDB_CREATE_INDEX_DISKANN_CONTAINER_NAME": "custom_diskann",
	})
	if err == nil || !strings.Contains(err.Error(), "ALLOW_DESTRUCTIVE_OPERATIONS=true") {
		t.Fatalf("expected destructive opt-in validation error, got %v", err)
	}
}

func TestLoadConfigFromEnv_DoesNotRetainNamesAcrossLoads(t *testing.T) {
	if _, err := loadTestConfig(t, map[string]string{
		"AZURE_COSMOSDB_CREATE_INDEX_DISKANN_CONTAINER_NAME":       "custom_diskann",
		"AZURE_COSMOSDB_CREATE_INDEX_QUANTIZEDFLAT_CONTAINER_NAME": "custom_quantizedflat",
		"AZURE_COSMOSDB_CREATE_INDEX_ALLOW_DESTRUCTIVE_OPERATIONS": "true",
	}); err != nil {
		t.Fatalf("custom LoadConfigFromEnv returned error: %v", err)
	}

	cfg, err := loadTestConfig(t, nil)
	if err != nil {
		t.Fatalf("default LoadConfigFromEnv returned error: %v", err)
	}
	if cfg.DiskANNContainerName != defaultDiskANNContainer ||
		cfg.QuantizedFlatContainerName != defaultQuantizedFlatContainer {
		t.Fatalf("expected defaults after custom load, got %q and %q", cfg.DiskANNContainerName, cfg.QuantizedFlatContainerName)
	}
}

func TestValidateContainerDeletionSafetyRejectsManuallyConstructedCustomConfig(t *testing.T) {
	err := validateContainerDeletionSafety(&Config{
		DiskANNContainerName:       "existing_production_container",
		QuantizedFlatContainerName: defaultQuantizedFlatContainer,
	})
	if err == nil || !strings.Contains(err.Error(), "ALLOW_DESTRUCTIVE_OPERATIONS=true") {
		t.Fatalf("expected deletion safety error, got %v", err)
	}
}

func loadTestConfig(t *testing.T, overrides map[string]string) (*Config, error) {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("get working directory: %v", err)
	}
	values := map[string]string{
		"AZURE_COSMOSDB_ENDPOINT":                  "https://example.documents.azure.com:443/",
		"AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME": "HotelsCreateIndex",
		"AZURE_OPENAI_EMBEDDING_ENDPOINT":          "https://example.openai.azure.com/",
		"AZURE_OPENAI_EMBEDDING_DEPLOYMENT":        "text-embedding-3-small",
		"AZURE_SUBSCRIPTION_ID":                    "sub-id",
		"AZURE_RESOURCE_GROUP":                     "rg",
		"AZURE_COSMOSDB_ACCOUNT_NAME":              "account",
		"AZURE_LOCATION":                           "eastus2",
		"DATA_FILE_WITH_VECTORS_AND_REGIONS":       filepath.Join(wd, "..", "data", "HotelsData_toCosmosDB_Vector_byRegion.json"),
	}
	for key, value := range overrides {
		values[key] = value
	}
	return LoadConfigFromEnv(func(key string) string { return values[key] })
}

func TestLoadConfigFromEnv_IgnoresLegacyDataFileVariable(t *testing.T) {
	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("get working directory: %v", err)
	}

	cfg, err := LoadConfigFromEnv(func(key string) string {
		values := map[string]string{
			"AZURE_COSMOSDB_ENDPOINT":           "https://example.documents.azure.com:443/",
			"AZURE_COSMOSDB_DATABASENAME":       "Hotels",
			"AZURE_OPENAI_EMBEDDING_ENDPOINT":   "https://example.openai.azure.com/",
			"AZURE_OPENAI_EMBEDDING_DEPLOYMENT": "text-embedding-3-small",
			"AZURE_SUBSCRIPTION_ID":             "sub-id",
			"AZURE_RESOURCE_GROUP":              "rg",
			"AZURE_COSMOSDB_ACCOUNT_NAME":       "account",
			"AZURE_LOCATION":                    "eastus2",
			"DATA_FILE_WITH_VECTORS":            filepath.Join(wd, "..", "data", "HotelsData_toCosmosDB_Vector.json"),
		}
		return values[key]
	})
	if err != nil {
		t.Fatalf("LoadConfigFromEnv returned error: %v", err)
	}

	expectedDataFile, err := filepath.Abs(filepath.Join(wd, "..", "data", "HotelsData_toCosmosDB_Vector_byRegion.json"))
	if err != nil {
		t.Fatalf("resolve expected path: %v", err)
	}
	if cfg.DataFileWithVectors != expectedDataFile {
		t.Fatalf("expected default region data file %q, got %q", expectedDataFile, cfg.DataFileWithVectors)
	}
}
