package tests

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func sampleDir(t *testing.T) string {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("get working directory: %v", err)
	}
	return filepath.Clean(filepath.Join(wd, ".."))
}

func baseEnv() []string {
	blockedPrefixes := []string{
		"AZURE_COSMOSDB_ENDPOINT=",
		"AZURE_COSMOSDB_DATABASENAME=",
		"AZURE_COSMOSDB_CONTAINER_NAME=",
		"AZURE_COSMOSDB_CREATE_INDEX_DISKANN_CONTAINER_NAME=",
		"AZURE_COSMOSDB_CREATE_INDEX_QUANTIZEDFLAT_CONTAINER_NAME=",
		"AZURE_COSMOSDB_CREATE_INDEX_ALLOW_DESTRUCTIVE_OPERATIONS=",
		"AZURE_OPENAI_EMBEDDING_ENDPOINT=",
		"AZURE_OPENAI_EMBEDDING_DEPLOYMENT=",
		"AZURE_SUBSCRIPTION_ID=",
		"AZURE_RESOURCE_GROUP=",
		"AZURE_COSMOSDB_ACCOUNT_NAME=",
		"AZURE_LOCATION=",
		"VECTOR_ALGORITHM=",
		"DATA_FILE_WITH_VECTORS=",
		"DATA_FILE_WITH_VECTORS_AND_REGIONS=",
	}

	filtered := make([]string, 0, len(os.Environ()))
	for _, entry := range os.Environ() {
		skip := false
		for _, prefix := range blockedPrefixes {
			if strings.HasPrefix(entry, prefix) {
				skip = true
				break
			}
		}
		if !skip {
			filtered = append(filtered, entry)
		}
	}
	return filtered
}

func TestMissingRequiredEnvironmentVariables(t *testing.T) {
	cmd := exec.Command("go", "run", ".")
	cmd.Dir = sampleDir(t)
	cmd.Env = append(baseEnv(),
		"AZURE_COSMOSDB_DATABASENAME=Hotels",
		"AZURE_SUBSCRIPTION_ID=sub-id",
		"AZURE_RESOURCE_GROUP=rg",
		"AZURE_COSMOSDB_ACCOUNT_NAME=account",
		"AZURE_LOCATION=eastus2",
		"DATA_FILE_WITH_VECTORS_AND_REGIONS=data/HotelsData_toCosmosDB_Vector_byRegion.json",
	)

	output, err := cmd.CombinedOutput()
	if err == nil {
		t.Fatalf("expected go run to fail, output: %s", string(output))
	}

	text := string(output)
	for _, expected := range []string{
		"AZURE_COSMOSDB_ENDPOINT",
		"AZURE_OPENAI_EMBEDDING_ENDPOINT",
		"AZURE_OPENAI_EMBEDDING_DEPLOYMENT",
	} {
		if !strings.Contains(text, expected) {
			t.Fatalf("expected output to mention %s, got: %s", expected, text)
		}
	}
}

func TestContainerAlgorithmMismatchFailsFast(t *testing.T) {
	cmd := exec.Command("go", "run", ".")
	cmd.Dir = sampleDir(t)
	cmd.Env = append(baseEnv(),
		"AZURE_COSMOSDB_ENDPOINT=https://example.documents.azure.com:443/",
		"AZURE_COSMOSDB_DATABASENAME=Hotels",
		"AZURE_COSMOSDB_CONTAINER_NAME=hotels_quantizedflat",
		"AZURE_OPENAI_EMBEDDING_ENDPOINT=https://example.openai.azure.com/",
		"AZURE_OPENAI_EMBEDDING_DEPLOYMENT=text-embedding-3-small",
		"AZURE_SUBSCRIPTION_ID=sub-id",
		"AZURE_RESOURCE_GROUP=rg",
		"AZURE_COSMOSDB_ACCOUNT_NAME=account",
		"AZURE_LOCATION=eastus2",
		"VECTOR_ALGORITHM=diskann",
		"DATA_FILE_WITH_VECTORS_AND_REGIONS=data/HotelsData_toCosmosDB_Vector_byRegion.json",
	)

	output, err := cmd.CombinedOutput()
	if err == nil {
		t.Fatalf("expected go run to fail, output: %s", string(output))
	}

	if !strings.Contains(string(output), `VECTOR_ALGORITHM="diskann" must use AZURE_COSMOSDB_CONTAINER_NAME="hotels_diskann"`) {
		t.Fatalf("unexpected output: %s", string(output))
	}
}
