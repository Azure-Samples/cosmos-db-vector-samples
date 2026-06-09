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
			"AZURE_COSMOSDB_ENDPOINT":           "https://example.documents.azure.com:443/",
			"AZURE_COSMOSDB_DATABASENAME":       "Hotels",
			"AZURE_OPENAI_EMBEDDING_ENDPOINT":   "https://example.openai.azure.com/",
			"AZURE_OPENAI_EMBEDDING_DEPLOYMENT": "text-embedding-3-small",
			"DATA_FILE_WITH_VECTORS":            filepath.Join(wd, "..", "data", "HotelsData_toCosmosDB_Vector.json"),
		}
		return values[key]
	})
	if err != nil {
		t.Fatalf("LoadConfigFromEnv returned error: %v", err)
	}

	expected := []string{diskANNContainer, quantizedFlatContainer}
	if strings.Join(cfg.ContainerNames, ",") != strings.Join(expected, ",") {
		t.Fatalf("expected containers %v, got %v", expected, cfg.ContainerNames)
	}
}
