package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/Azure/azure-sdk-for-go/sdk/azcore/policy"
	"github.com/Azure/azure-sdk-for-go/sdk/azidentity"
	"github.com/joho/godotenv"
	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/azure"
	"github.com/openai/openai-go/v3/option"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// Config holds the application configuration
type Config struct {
	ClusterName    string
	DatabaseName   string
	CollectionName string
	DataFile       string
	VectorField    string
	ModelName      string
	Dimensions     int
	BatchSize      int
}

// SearchResult represents a search result document
type SearchResult struct {
	Document interface{} `bson:"document"`
	Score    float64     `bson:"score"`
}

// HotelData represents a hotel document structure
type HotelData struct {
	HotelName         string    `bson:"HotelName" json:"HotelName"`
	Description       string    `bson:"Description" json:"Description"`
	DescriptionVector []float64 `bson:"DescriptionVector,omitempty" json:"DescriptionVector,omitempty"`
	// Add other fields as needed
}

// InsertStats holds statistics about data insertion
type InsertStats struct {
	Total    int `json:"total"`
	Inserted int `json:"inserted"`
	Failed   int `json:"failed"`
}

// LoadConfig loads configuration from environment variables
func LoadConfig() *Config {
	// Load environment variables from .env file
	// For production use, prefer Azure Key Vault or similar secret management
	// services instead of .env files. For development/demo purposes only.
	err := godotenv.Load()
	if err != nil {
		log.Printf("Warning: Error loading .env file: %v", err)
	}

	dimensions, _ := strconv.Atoi(getEnvOrDefault("EMBEDDING_DIMENSIONS", "1536"))
	batchSize, _ := strconv.Atoi(getEnvOrDefault("LOAD_SIZE_BATCH", "100"))

	return &Config{
		ClusterName:    getEnvOrDefault("MONGO_CLUSTER_NAME", "vectorSearch"),
		DatabaseName:   "vectorSearchDB",
		CollectionName: "vectorSearchCollection",
		DataFile:       getEnvOrDefault("DATA_FILE_WITH_VECTORS", "data/HotelsData_with_vectors.json"),
		VectorField:    getEnvOrDefault("EMBEDDED_FIELD", "DescriptionVector"),
		ModelName:      getEnvOrDefault("AZURE_OPENAI_EMBEDDING_MODEL", "text-embedding-ada-002"),
		Dimensions:     dimensions,
		BatchSize:      batchSize,
	}
}

// getEnvOrDefault returns environment variable value or default if not set
func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// GetClients creates MongoDB and Azure OpenAI clients with connection string authentication
func GetClients() (*mongo.Client, openai.Client, error) {
	ctx := context.Background()

	// Get MongoDB connection string
	mongoConnectionString := os.Getenv("MONGO_CONNECTION_STRING")
	if mongoConnectionString == "" {
		return nil, openai.Client{}, fmt.Errorf("MONGO_CONNECTION_STRING environment variable is required. " +
			"Set it to your DocumentDB connection string or use GetClientsPasswordless() for OIDC auth")
	}

	// Create MongoDB client with optimized settings for DocumentDB
	clientOptions := options.Client().
		ApplyURI(mongoConnectionString).
		SetMaxPoolSize(50).
		SetMinPoolSize(5).
		SetMaxConnIdleTime(30 * time.Second).
		SetServerSelectionTimeout(5 * time.Second).
		SetSocketTimeout(20 * time.Second)

	mongoClient, err := mongo.Connect(ctx, clientOptions)
	if err != nil {
		return nil, openai.Client{}, fmt.Errorf("failed to connect to MongoDB: %v", err)
	}

	// Test the connection
	err = mongoClient.Ping(ctx, nil)
	if err != nil {
		return nil, openai.Client{}, fmt.Errorf("failed to ping MongoDB: %v", err)
	}

	// Get Azure OpenAI configuration
	azureOpenAIEndpoint := os.Getenv("AZURE_OPENAI_EMBEDDING_ENDPOINT")
	azureOpenAIKey := os.Getenv("AZURE_OPENAI_EMBEDDING_KEY")

	if azureOpenAIEndpoint == "" || azureOpenAIKey == "" {
		return nil, openai.Client{}, fmt.Errorf("Azure OpenAI endpoint and key are required")
	}

	// Create Azure OpenAI client
	openAIClient := openai.NewClient(
		option.WithBaseURL(fmt.Sprintf("%s/openai/v1", azureOpenAIEndpoint)),
		option.WithAPIKey(azureOpenAIKey))

	return mongoClient, openAIClient, nil
}

// GetClientsPasswordless creates MongoDB and Azure OpenAI clients with passwordless authentication
func GetClientsPasswordless() (*mongo.Client, openai.Client, error) {
	ctx := context.Background()

	// Get MongoDB cluster name
	clusterName := os.Getenv("MONGO_CLUSTER_NAME")
	if clusterName == "" {
		return nil, openai.Client{}, fmt.Errorf("MONGO_CLUSTER_NAME environment variable is required")
	}

	// Create Azure credential
	credential, err := azidentity.NewDefaultAzureCredential(nil)
	if err != nil {
		return nil, openai.Client{}, fmt.Errorf("failed to create Azure credential: %v", err)
	}

	// Attempt OIDC authentication
	mongoURI := fmt.Sprintf("mongodb+srv://%s.global.mongocluster.cosmos.azure.com/", clusterName)

	fmt.Println("Attempting OIDC authentication...")
	mongoClient, err := connectWithOIDC(ctx, mongoURI, credential)
	if err != nil {
		return nil, openai.Client{}, fmt.Errorf("OIDC authentication failed: %v", err)
	}
	fmt.Println("OIDC authentication successful!")

	// Get Azure OpenAI endpoint
	azureOpenAIEndpoint := os.Getenv("AZURE_OPENAI_EMBEDDING_ENDPOINT")
	if azureOpenAIEndpoint == "" {
		return nil, openai.Client{}, fmt.Errorf("AZURE_OPENAI_EMBEDDING_ENDPOINT environment variable is required")
	}

	// Create Azure OpenAI client with credential-based authentication
	openAIClient := openai.NewClient(
		option.WithBaseURL(fmt.Sprintf("%s/openai/v1", azureOpenAIEndpoint)),
		azure.WithTokenCredential(credential))

	return mongoClient, openAIClient, nil
}

// connectWithOIDC attempts to connect using OIDC authentication
func connectWithOIDC(ctx context.Context, mongoURI string, credential *azidentity.DefaultAzureCredential) (*mongo.Client, error) {
	// Create OIDC machine callback using Azure credential
	oidcCallback := func(ctx context.Context, args *options.OIDCArgs) (*options.OIDCCredential, error) {
		scope := "https://ossrdbms-aad.database.windows.net/.default"
		fmt.Printf("Getting token with scope: %s\n", scope)
		token, err := credential.GetToken(ctx, policy.TokenRequestOptions{
			Scopes: []string{scope},
		})
		if err != nil {
			return nil, fmt.Errorf("failed to get token with scope %s: %v", scope, err)
		}

		fmt.Printf("Successfully obtained token")

		return &options.OIDCCredential{
			AccessToken: token.Token,
		}, nil
	}
	// Set up MongoDB client options with OIDC authentication
	clientOptions := options.Client().
		ApplyURI(mongoURI).
		SetConnectTimeout(30 * time.Second).
		SetServerSelectionTimeout(30 * time.Second).
		SetRetryWrites(true).
		SetAuth(options.Credential{
			AuthMechanism: "MONGODB-OIDC",
			// For local development, don't set ENVIRONMENT=azure to allow custom callbacks
			AuthMechanismProperties: map[string]string{
				"TOKEN_RESOURCE": "https://ossrdbms-aad.database.windows.net",
			},
			OIDCMachineCallback: oidcCallback,
		})

	mongoClient, err := mongo.Connect(ctx, clientOptions)
	if err != nil {
		return nil, err
	}

	return mongoClient, nil
}

// connectWithConnectionString attempts to connect using a connection string
func connectWithConnectionString(ctx context.Context, connectionString string) (*mongo.Client, error) {
	clientOptions := options.Client().
		ApplyURI(connectionString).
		SetMaxPoolSize(50).
		SetMinPoolSize(5).
		SetMaxConnIdleTime(30 * time.Second).
		SetServerSelectionTimeout(5 * time.Second).
		SetSocketTimeout(20 * time.Second)

	mongoClient, err := mongo.Connect(ctx, clientOptions)
	if err != nil {
		return nil, err
	}

	return mongoClient, nil
}

// ReadFileReturnJSON reads a JSON file and returns the data as a slice of maps
func ReadFileReturnJSON(filePath string) ([]map[string]interface{}, error) {
	file, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("error reading file '%s': %v", filePath, err)
	}

	var data []map[string]interface{}
	err = json.Unmarshal(file, &data)
	if err != nil {
		return nil, fmt.Errorf("error parsing JSON in file '%s': %v", filePath, err)
	}

	return data, nil
}

// WriteFileJSON writes data to a JSON file
func WriteFileJSON(data []map[string]interface{}, filePath string) error {
	jsonData, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return fmt.Errorf("error marshalling data to JSON: %v", err)
	}

	err = os.WriteFile(filePath, jsonData, 0644)
	if err != nil {
		return fmt.Errorf("error writing to file '%s': %v", filePath, err)
	}

	fmt.Printf("Data successfully written to '%s'\n", filePath)
	return nil
}

// InsertData inserts data into a MongoDB collection in batches
func InsertData(ctx context.Context, collection *mongo.Collection, data []map[string]interface{}, batchSize int, indexFields []string) (*InsertStats, error) {
	totalDocuments := len(data)
	insertedCount := 0
	failedCount := 0

	fmt.Printf("Starting batch insertion of %d documents...\n", totalDocuments)

	// Create indexes if specified
	if len(indexFields) > 0 {
		for _, field := range indexFields {
			indexModel := mongo.IndexModel{
				Keys: bson.D{{Key: field, Value: 1}},
			}
			_, err := collection.Indexes().CreateOne(ctx, indexModel)
			if err != nil {
				fmt.Printf("Warning: Could not create index on %s: %v\n", field, err)
			} else {
				fmt.Printf("Created index on field: %s\n", field)
			}
		}
	}

	// Process data in batches
	for i := 0; i < totalDocuments; i += batchSize {
		end := i + batchSize
		if end > totalDocuments {
			end = totalDocuments
		}

		batch := data[i:end]
		batchNum := (i / batchSize) + 1

		// Convert to []interface{} for MongoDB driver
		documents := make([]interface{}, len(batch))
		for j, doc := range batch {
			documents[j] = doc
		}

		// Insert batch
		result, err := collection.InsertMany(ctx, documents, options.InsertMany().SetOrdered(false))
		if err != nil {
			// Handle bulk write errors
			if bulkErr, ok := err.(mongo.BulkWriteException); ok {
				inserted := len(bulkErr.WriteErrors)
				insertedCount += len(batch) - inserted
				failedCount += inserted

				fmt.Printf("Batch %d had errors: %d inserted, %d failed\n", batchNum, len(batch)-inserted, inserted)

				// Print specific error details
				for _, writeErr := range bulkErr.WriteErrors {
					fmt.Printf("  Error: %s\n", writeErr.Message)
				}
			} else {
				// Handle unexpected errors
				failedCount += len(batch)
				fmt.Printf("Batch %d failed completely: %v\n", batchNum, err)
			}
		} else {
			insertedCount += len(result.InsertedIDs)
			fmt.Printf("Batch %d completed: %d documents inserted\n", batchNum, len(result.InsertedIDs))
		}

		// Small delay between batches
		time.Sleep(100 * time.Millisecond)
	}

	return &InsertStats{
		Total:    totalDocuments,
		Inserted: insertedCount,
		Failed:   failedCount,
	}, nil
}

// DropVectorIndexes drops existing vector indexes on the specified field
func DropVectorIndexes(ctx context.Context, collection *mongo.Collection, vectorField string) error {
	// Get all indexes for the collection
	cursor, err := collection.Indexes().List(ctx)
	if err != nil {
		return fmt.Errorf("could not list indexes: %v", err)
	}
	defer cursor.Close(ctx)

	var vectorIndexes []string
	for cursor.Next(ctx) {
		var index bson.M
		if err := cursor.Decode(&index); err != nil {
			continue
		}

		// Check if this is a vector index on the specified field
		if key, ok := index["key"].(bson.M); ok {
			if indexType, exists := key[vectorField]; exists && indexType == "cosmosSearch" {
				if name, ok := index["name"].(string); ok {
					vectorIndexes = append(vectorIndexes, name)
				}
			}
		}
	}

	// Drop each vector index found
	for _, indexName := range vectorIndexes {
		fmt.Printf("Dropping existing vector index: %s\n", indexName)
		_, err := collection.Indexes().DropOne(ctx, indexName)
		if err != nil {
			fmt.Printf("Warning: Could not drop index %s: %v\n", indexName, err)
		}
	}

	if len(vectorIndexes) > 0 {
		fmt.Printf("Dropped %d existing vector index(es)\n", len(vectorIndexes))
	} else {
		fmt.Println("No existing vector indexes found to drop")
	}

	return nil
}

// PrintSearchResults prints search results in a formatted way
func PrintSearchResults(results []SearchResult, maxResults int, showScore bool) {
	if len(results) == 0 {
		fmt.Println("No search results found.")
		return
	}

	if maxResults > len(results) {
		maxResults = len(results)
	}

	fmt.Printf("\nSearch Results (showing top %d):\n", maxResults)
	fmt.Println(strings.Repeat("=", 80))

	for i := 0; i < maxResults; i++ {
		result := results[i]

		// Extract HotelName from document (assuming bson.D structure)
		doc := result.Document.(bson.D)
		var hotelName string
		for _, elem := range doc {
			if elem.Key == "HotelName" {
				hotelName = fmt.Sprintf("%v", elem.Value)
				break
			}
		}

		// Display results
		fmt.Printf("%d. HotelName: %s", i+1, hotelName)

		if showScore {
			fmt.Printf(", Score: %.4f", result.Score)
		}

		fmt.Println()
	}
}

// GenerateEmbedding generates an embedding for the given text using Azure OpenAI
func GenerateEmbedding(ctx context.Context, client openai.Client, text, modelName string) ([]float64, error) {
	resp, err := client.Embeddings.New(ctx, openai.EmbeddingNewParams{
		Input: openai.EmbeddingNewParamsInputUnion{
			OfString: openai.String(text),
		},
		Model: modelName,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to generate embedding: %v", err)
	}

	if len(resp.Data) == 0 {
		return nil, fmt.Errorf("no embedding data received")
	}

	// Convert []float32 to []float64
	embedding := make([]float64, len(resp.Data[0].Embedding))
	for i, v := range resp.Data[0].Embedding {
		embedding[i] = float64(v)
	}

	return embedding, nil
}
