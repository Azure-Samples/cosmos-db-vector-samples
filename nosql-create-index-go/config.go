package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

const (
	diskANNContainer                = "hotels_diskann"
	quantizedFlatContainer          = "hotels_quantizedflat"
	embeddingFieldName              = "embedding"
	embeddingDimensions             = 1536
	partitionKeyFieldName           = "Region"
	partitionKeyFieldValue          = "hotels"
	defaultQueryText                = "hotel near the ocean"
	azureOpenAIEmbeddingsAPIVersion = "2024-02-01"
)

var algorithmToContainer = map[string]string{
	"diskann":       diskANNContainer,
	"quantizedflat": quantizedFlatContainer,
}

type Config struct {
	CosmosEndpoint            string
	DatabaseName              string
	PrimaryContainerName      string
	ContainerNames            []string
	OpenAIEmbeddingEndpoint   string
	OpenAIEmbeddingDeployment string
	VectorAlgorithm           string
	DataFileWithVectors       string
	EmbeddingFieldName        string
	EmbeddingDimensions       int
	PartitionKeyFieldName     string
	PartitionKeyFieldValue    string
	QueryText                 string
	OpenAIAPIVersion          string
	SubscriptionID            string
	ResourceGroup             string
	AccountName               string
}

func LoadConfig() (*Config, error) {
	return LoadConfigFromEnv(func(key string) string {
		return os.Getenv(key)
	})
}

func LoadConfigFromEnv(getenv func(string) string) (*Config, error) {
	algorithm := strings.ToLower(strings.TrimSpace(getenv("VECTOR_ALGORITHM")))
	containerName := strings.TrimSpace(getenv("AZURE_COSMOSDB_CONTAINER_NAME"))
	dataFile := strings.TrimSpace(getenv("DATA_FILE_WITH_VECTORS"))

	cfg := &Config{
		CosmosEndpoint:            strings.TrimSpace(getenv("AZURE_COSMOSDB_ENDPOINT")),
		DatabaseName:              strings.TrimSpace(getenv("AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME")),
		PrimaryContainerName:      containerName,
		OpenAIEmbeddingEndpoint:   strings.TrimSpace(getenv("AZURE_OPENAI_EMBEDDING_ENDPOINT")),
		OpenAIEmbeddingDeployment: strings.TrimSpace(getenv("AZURE_OPENAI_EMBEDDING_DEPLOYMENT")),
		VectorAlgorithm:           algorithm,
		DataFileWithVectors:       dataFile,
		EmbeddingFieldName:        embeddingFieldName,
		EmbeddingDimensions:       embeddingDimensions,
		PartitionKeyFieldName:     partitionKeyFieldName,
		PartitionKeyFieldValue:    partitionKeyFieldValue,
		QueryText:                 defaultQueryText,
		OpenAIAPIVersion:          azureOpenAIEmbeddingsAPIVersion,
		SubscriptionID:            strings.TrimSpace(getenv("AZURE_SUBSCRIPTION_ID")),
		ResourceGroup:             strings.TrimSpace(getenv("AZURE_RESOURCE_GROUP")),
		AccountName:               strings.TrimSpace(getenv("AZURE_COSMOSDB_ACCOUNT_NAME")),
	}

	if cfg.DatabaseName == "" {
		cfg.DatabaseName = "HotelsCreateIndex"
	}
	if cfg.DataFileWithVectors == "" {
		cfg.DataFileWithVectors = filepath.Join(".", "data", "HotelsData_toCosmosDB_Vector_byRegion.json")
	}

	if err := validateConfig(cfg); err != nil {
		return nil, err
	}

	resolvedDataFile, err := resolveDataFilePath(cfg.DataFileWithVectors)
	if err != nil {
		return nil, err
	}
	cfg.DataFileWithVectors = resolvedDataFile
	cfg.ContainerNames = orderedContainers(cfg.PrimaryContainerName)

	return cfg, nil
}

func validateConfig(cfg *Config) error {
	required := map[string]string{
		"AZURE_COSMOSDB_ENDPOINT":           cfg.CosmosEndpoint,
		"AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME": cfg.DatabaseName,
		"AZURE_OPENAI_EMBEDDING_ENDPOINT":   cfg.OpenAIEmbeddingEndpoint,
		"AZURE_OPENAI_EMBEDDING_DEPLOYMENT": cfg.OpenAIEmbeddingDeployment,
		"DATA_FILE_WITH_VECTORS":            cfg.DataFileWithVectors,
	}

	missing := make([]string, 0)
	for name, value := range required {
		if strings.TrimSpace(value) == "" {
			missing = append(missing, name)
		}
	}
	if len(missing) > 0 {
		sort.Strings(missing)
		return fmt.Errorf("missing required environment variables: %s", strings.Join(missing, ", "))
	}

	if cfg.VectorAlgorithm != "" {
		expectedContainer, ok := algorithmToContainer[cfg.VectorAlgorithm]
		if !ok {
			return fmt.Errorf("invalid VECTOR_ALGORITHM %q; supported values: diskann, quantizedflat", cfg.VectorAlgorithm)
		}

		if cfg.PrimaryContainerName != "" && cfg.PrimaryContainerName != expectedContainer {
			return fmt.Errorf("VECTOR_ALGORITHM=%q must use AZURE_COSMOSDB_CONTAINER_NAME=%q", cfg.VectorAlgorithm, expectedContainer)
		}
	}

	if cfg.PrimaryContainerName != "" && cfg.PrimaryContainerName != diskANNContainer && cfg.PrimaryContainerName != quantizedFlatContainer {
		return fmt.Errorf("invalid AZURE_COSMOSDB_CONTAINER_NAME %q; supported values: %s, %s", cfg.PrimaryContainerName, diskANNContainer, quantizedFlatContainer)
	}

	return nil
}

func orderedContainers(primary string) []string {
	if primary == "" {
		return []string{diskANNContainer, quantizedFlatContainer}
	}

	containers := []string{primary}
	for _, candidate := range []string{diskANNContainer, quantizedFlatContainer} {
		if candidate != primary {
			containers = append(containers, candidate)
		}
	}
	return containers
}

func resolveDataFilePath(value string) (string, error) {
	if filepath.IsAbs(value) {
		if _, err := os.Stat(value); err != nil {
			return "", fmt.Errorf("DATA_FILE_WITH_VECTORS not found: %s", value)
		}
		return value, nil
	}

	candidates := []string{}
	if wd, err := os.Getwd(); err == nil {
		candidates = append(candidates,
			filepath.Join(wd, value),
			filepath.Join(wd, filepath.FromSlash(value)),
		)
	}
	if _, currentFile, _, ok := runtime.Caller(0); ok {
		moduleDir := filepath.Dir(currentFile)
		candidates = append(candidates,
			filepath.Join(moduleDir, value),
			filepath.Join(filepath.Dir(moduleDir), value),
			filepath.Join(filepath.Dir(moduleDir), filepath.FromSlash(value)),
		)
	}

	seen := map[string]struct{}{}
	for _, candidate := range candidates {
		clean := filepath.Clean(candidate)
		if _, ok := seen[clean]; ok {
			continue
		}
		seen[clean] = struct{}{}
		if _, err := os.Stat(clean); err == nil {
			absolute, absErr := filepath.Abs(clean)
			if absErr != nil {
				return clean, nil
			}
			return absolute, nil
		}
	}

	return "", fmt.Errorf("DATA_FILE_WITH_VECTORS not found: %s", value)
}