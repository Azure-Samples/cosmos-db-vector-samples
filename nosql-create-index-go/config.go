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
	defaultPartitionKeyValue        = "Northeast" // Default region to query (matches .NET)
	defaultQueryText                = "hotel near the ocean"
	azureOpenAIEmbeddingsAPIVersion = "2024-02-01"
	defaultEmbeddingFieldName       = "embedding" // fallback; read from AZURE_COSMOSDB_CREATE_INDEX_EMBEDDED_FIELD if available
)

var algorithmToContainer = map[string]string{
	"diskann":       diskANNContainer,
	"quantizedflat": quantizedFlatContainer,
}

// trimEnvValue removes surrounding whitespace and quotes from environment variable values.
// This handles .env files that use quoted values like: KEY="value" or KEY='value'
func trimEnvValue(s string) string {
	s = strings.TrimSpace(s)
	if len(s) >= 2 {
		if (s[0] == '"' && s[len(s)-1] == '"') || (s[0] == '\'' && s[len(s)-1] == '\'') {
			s = s[1 : len(s)-1]
		}
	}
	return s
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
	Location                  string
}

func LoadConfig() (*Config, error) {
	return LoadConfigFromEnv(func(key string) string {
		return os.Getenv(key)
	})
}

func LoadConfigFromEnv(getenv func(string) string) (*Config, error) {
	algorithm := strings.ToLower(trimEnvValue(getenv("VECTOR_ALGORITHM")))
	containerName := trimEnvValue(getenv("AZURE_COSMOSDB_CONTAINER_NAME"))
	dataFile := trimEnvValue(getenv("DATA_FILE_WITH_VECTORS_AND_REGIONS"))
	if dataFile == "" {
		dataFile = trimEnvValue(getenv("DATA_FILE_WITH_VECTORS"))
	}
	embeddingField := trimEnvValue(getenv("AZURE_COSMOSDB_CREATE_INDEX_EMBEDDED_FIELD"))
	if embeddingField == "" {
		embeddingField = defaultEmbeddingFieldName
	}
	partitionKeyValue := trimEnvValue(getenv("PARTITION_KEY_VALUE"))
	if partitionKeyValue == "" {
		partitionKeyValue = defaultPartitionKeyValue
	}

	cfg := &Config{
		CosmosEndpoint:            trimEnvValue(getenv("AZURE_COSMOSDB_ENDPOINT")),
		DatabaseName:              trimEnvValue(getenv("AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME")),
		PrimaryContainerName:      containerName,
		OpenAIEmbeddingEndpoint:   trimEnvValue(getenv("AZURE_OPENAI_EMBEDDING_ENDPOINT")),
		OpenAIEmbeddingDeployment: trimEnvValue(getenv("AZURE_OPENAI_EMBEDDING_DEPLOYMENT")),
		VectorAlgorithm:           algorithm,
		DataFileWithVectors:       dataFile,
		EmbeddingFieldName:        embeddingField,
		EmbeddingDimensions:       embeddingDimensions,
		PartitionKeyFieldName:     partitionKeyFieldName,
		PartitionKeyFieldValue:    partitionKeyValue,
		QueryText:                 defaultQueryText,
		OpenAIAPIVersion:          azureOpenAIEmbeddingsAPIVersion,
		SubscriptionID:            trimEnvValue(getenv("AZURE_SUBSCRIPTION_ID")),
		ResourceGroup:             trimEnvValue(getenv("AZURE_RESOURCE_GROUP")),
		AccountName:               trimEnvValue(getenv("AZURE_COSMOSDB_ACCOUNT_NAME")),
		Location:                  trimEnvValue(getenv("AZURE_LOCATION")),
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
		"AZURE_COSMOSDB_ENDPOINT":                  cfg.CosmosEndpoint,
		"AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME": cfg.DatabaseName,
		"AZURE_OPENAI_EMBEDDING_ENDPOINT":          cfg.OpenAIEmbeddingEndpoint,
		"AZURE_OPENAI_EMBEDDING_DEPLOYMENT":        cfg.OpenAIEmbeddingDeployment,
		"DATA_FILE_WITH_VECTORS_AND_REGIONS":       cfg.DataFileWithVectors,
		"AZURE_SUBSCRIPTION_ID":                    cfg.SubscriptionID,
		"AZURE_RESOURCE_GROUP":                     cfg.ResourceGroup,
		"AZURE_COSMOSDB_ACCOUNT_NAME":              cfg.AccountName,
		"AZURE_LOCATION":                           cfg.Location,
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
			return "", fmt.Errorf("DATA_FILE_WITH_VECTORS_AND_REGIONS (or DATA_FILE_WITH_VECTORS) not found: %s", value)
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

	return "", fmt.Errorf("DATA_FILE_WITH_VECTORS_AND_REGIONS (or DATA_FILE_WITH_VECTORS) not found: %s", value)
}
