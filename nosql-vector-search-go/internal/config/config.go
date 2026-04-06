package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

// AlgorithmConfig holds the container name and display name for a vector algorithm.
type AlgorithmConfig struct {
	ContainerName string
	AlgorithmName string
}

// AlgorithmConfigs maps algorithm identifiers to their configuration.
var AlgorithmConfigs = map[string]AlgorithmConfig{
	"diskann": {
		ContainerName: "hotels_diskann",
		AlgorithmName: "DiskANN",
	},
	"quantizedflat": {
		ContainerName: "hotels_quantizedflat",
		AlgorithmName: "QuantizedFlat",
	},
}

// Config holds all application configuration parsed from environment variables.
type Config struct {
	// Azure Cosmos DB
	CosmosEndpoint string
	DbName         string
	ContainerName  string

	// Azure OpenAI
	OpenAIEndpoint   string
	OpenAIDeployment string
	OpenAIAPIVersion string

	// Vector search
	Algorithm        string
	AlgorithmDisplay string
	DistanceFunction string
	EmbeddedField    string
	EmbeddingDims    int

	// Data
	DataFile string
	Query    string
}

// LoadConfig reads environment variables (with optional .env file) and returns
// a validated Config. It fails fast on missing required values.
func LoadConfig() (*Config, error) {
	// Load .env file if present; ignore error (file may not exist in production)
	_ = godotenv.Load()

	algorithm := strings.TrimSpace(strings.ToLower(getEnvOrDefault("VECTOR_ALGORITHM", "diskann")))
	algCfg, ok := AlgorithmConfigs[algorithm]
	if !ok {
		keys := make([]string, 0, len(AlgorithmConfigs))
		for k := range AlgorithmConfigs {
			keys = append(keys, k)
		}
		return nil, fmt.Errorf("invalid VECTOR_ALGORITHM %q; must be one of: %s", algorithm, strings.Join(keys, ", "))
	}

	dims, err := strconv.Atoi(getEnvOrDefault("EMBEDDING_DIMENSIONS", "1536"))
	if err != nil {
		return nil, fmt.Errorf("EMBEDDING_DIMENSIONS must be an integer: %w", err)
	}

	cfg := &Config{
		CosmosEndpoint:   os.Getenv("AZURE_COSMOSDB_ENDPOINT"),
		DbName:           getEnvOrDefault("AZURE_COSMOSDB_DATABASENAME", "Hotels"),
		ContainerName:    algCfg.ContainerName,
		OpenAIEndpoint:   os.Getenv("AZURE_OPENAI_EMBEDDING_ENDPOINT"),
		OpenAIDeployment: getEnvOrDefault("AZURE_OPENAI_EMBEDDING_DEPLOYMENT", os.Getenv("AZURE_OPENAI_EMBEDDING_MODEL")),
		OpenAIAPIVersion: getEnvOrDefault("AZURE_OPENAI_EMBEDDING_API_VERSION", "2024-08-01-preview"),
		Algorithm:        algorithm,
		AlgorithmDisplay: algCfg.AlgorithmName,
		DistanceFunction: getEnvOrDefault("VECTOR_DISTANCE_FUNCTION", "cosine"),
		EmbeddedField:    getEnvOrDefault("EMBEDDED_FIELD", "DescriptionVector"),
		EmbeddingDims:    dims,
		DataFile:         getEnvOrDefault("DATA_FILE_WITH_VECTORS", "../data/HotelsData_toCosmosDB_Vector.json"),
		Query:            "quintessential lodging near running trails, eateries, retail",
	}

	if err := validate(cfg); err != nil {
		return nil, err
	}
	return cfg, nil
}

func validate(cfg *Config) error {
	required := map[string]string{
		"AZURE_COSMOSDB_ENDPOINT":            cfg.CosmosEndpoint,
		"AZURE_OPENAI_EMBEDDING_ENDPOINT":    cfg.OpenAIEndpoint,
		"AZURE_OPENAI_EMBEDDING_DEPLOYMENT":  cfg.OpenAIDeployment,
		"AZURE_OPENAI_EMBEDDING_API_VERSION": cfg.OpenAIAPIVersion,
	}
	var missing []string
	for name, val := range required {
		if val == "" {
			missing = append(missing, name)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("missing required environment variables: %s", strings.Join(missing, ", "))
	}
	return nil
}

func getEnvOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
