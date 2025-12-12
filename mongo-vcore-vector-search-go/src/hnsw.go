package main

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/openai/openai-go/v3"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
)

// CreateHNSWVectorIndex creates an HNSW (Hierarchical Navigable Small World) vector index on the specified field
func CreateHNSWVectorIndex(ctx context.Context, collection *mongo.Collection, vectorField string, dimensions int) error {
	fmt.Printf("Creating HNSW vector index on field '%s'...\n", vectorField)

	// Drop any existing vector indexes on this field first
	err := DropVectorIndexes(ctx, collection, vectorField)
	if err != nil {
		fmt.Printf("Warning: Could not drop existing indexes: %v\n", err)
	}

	// Use the native MongoDB command for DocumentDB vector indexes
	// Note: Must use bson.D for commands to preserve order and avoid "multi-key map" errors
	indexCommand := bson.D{
		{"createIndexes", collection.Name()},
		{"indexes", []bson.D{
			{
				{"name", fmt.Sprintf("hnsw_index_%s", vectorField)},
				{"key", bson.D{
					{vectorField, "cosmosSearch"}, // DocumentDB vector search index type
				}},
				{"cosmosSearchOptions", bson.D{
					// HNSW algorithm configuration
					{"kind", "vector-hnsw"},

					// Vector dimensions must match the embedding model
					{"dimensions", dimensions},

					// Cosine similarity works well with text embeddings
					{"similarity", "COS"},

					// Maximum connections per node in the graph (parameter 'm')
					// Higher values improve recall but increase memory usage and build time
					{"m", 16},

					// Size of the candidate list during construction
					// Higher values improve index quality but slow down building
					{"efConstruction", 64},
				}},
			},
		}},
	}

	// Execute the createIndexes command directly
	var result bson.M
	err = collection.Database().RunCommand(ctx, indexCommand).Decode(&result)
	if err != nil {
		// Check if it's a tier limitation and suggest alternatives
		if strings.Contains(err.Error(), "not enabled for this cluster tier") {
			fmt.Println("\nHNSW indexes require a higher cluster tier.")
			fmt.Println("Try one of these alternatives:")
			fmt.Println("  • Upgrade your DocumentDB cluster to a higher tier")
			fmt.Println("  • Use IVF instead: go run src/ivf.go")
			fmt.Println("  • Use DiskANN instead: go run src/diskann.go")
		}
		return fmt.Errorf("error creating HNSW vector index: %v", err)
	}

	fmt.Println("HNSW vector index created successfully")
	return nil
}

// PerformHNSWVectorSearch performs a vector search using HNSW algorithm
func PerformHNSWVectorSearch(ctx context.Context, collection *mongo.Collection, openAIClient openai.Client, queryText, vectorField, modelName string, topK int, efSearch int) ([]SearchResult, error) {
	fmt.Printf("Performing HNSW vector search for: '%s'\n", queryText)

	// Convert query text to embedding vector
	queryEmbedding, err := GenerateEmbedding(ctx, openAIClient, queryText, modelName)
	if err != nil {
		return nil, fmt.Errorf("error generating embedding: %v", err)
	}

	// Build aggregation pipeline for HNSW vector search
	// DocumentDB uses $search with cosmosSearch
	pipeline := []bson.M{
		{
			"$search": bson.M{
				// Use cosmosSearch for vector operations in DocumentDB
				"cosmosSearch": bson.M{
					// Query vector to find similar documents for
					"vector": queryEmbedding,

					// Field in documents containing vectors to compare against
					"path": vectorField,

					// Maximum number of results to return
					"k": topK,
				},
			},
		},
		{
			// Select only the fields needed for display and add similarity score
			"$project": bson.M{
				"document": "$$ROOT",
				// Add search score from metadata
				"score": bson.M{"$meta": "searchScore"},
			},
		},
	}

	// Execute the search pipeline
	cursor, err := collection.Aggregate(ctx, pipeline)
	if err != nil {
		return nil, fmt.Errorf("error performing HNSW vector search: %v", err)
	}
	defer cursor.Close(ctx)

	var results []SearchResult
	for cursor.Next(ctx) {
		var result SearchResult
		if err := cursor.Decode(&result); err != nil {
			fmt.Printf("Warning: Could not decode result: %v\n", err)
			continue
		}
		results = append(results, result)
	}

	if err := cursor.Err(); err != nil {
		return nil, fmt.Errorf("cursor error: %v", err)
	}

	return results, nil
}

// main function demonstrates HNSW vector search functionality
func main() {
	fmt.Println("Starting HNSW vector search demonstration...")

	ctx := context.Background()

	// Load configuration from environment variables
	config := LoadConfig()

	fmt.Println("\nInitializing MongoDB and Azure OpenAI clients...")
	mongoClient, azureOpenAIClient, err := GetClientsPasswordless()
	if err != nil {
		log.Fatalf("Failed to initialize clients: %v", err)
	}
	defer mongoClient.Disconnect(ctx)

	// Access database and collection
	database := mongoClient.Database(config.DatabaseName)
	collection := database.Collection(config.CollectionName)

	// Load hotel data with embeddings
	fmt.Printf("\nLoading data from %s...\n", config.DataFile)
	data, err := ReadFileReturnJSON(config.DataFile)
	if err != nil {
		log.Fatalf("Failed to load data: %v", err)
	}
	fmt.Printf("Loaded %d documents\n", len(data))

	// Verify that embeddings are present in the data
	var documentsWithEmbeddings []map[string]interface{}
	for _, doc := range data {
		if _, exists := doc[config.VectorField]; exists {
			documentsWithEmbeddings = append(documentsWithEmbeddings, doc)
		}
	}

	if len(documentsWithEmbeddings) == 0 {
		log.Fatalf("No documents found with embeddings in field '%s'. Please run create_embeddings.go first.", config.VectorField)
	}

	// Insert data into MongoDB collection
	fmt.Printf("\nPreparing collection '%s'...\n", config.CollectionName)

	// Clear any existing data to start fresh
	deleteResult, err := collection.DeleteMany(ctx, bson.M{})
	if err != nil {
		log.Fatalf("Failed to clear existing data: %v", err)
	}
	if deleteResult.DeletedCount > 0 {
		fmt.Printf("Cleared %d existing documents from collection\n", deleteResult.DeletedCount)
	}

	// Insert hotel data with embeddings
	stats, err := InsertData(ctx, collection, documentsWithEmbeddings, config.BatchSize, nil)
	if err != nil {
		log.Fatalf("Failed to insert data: %v", err)
	}

	if stats.Inserted == 0 {
		log.Fatalf("No documents were inserted successfully")
	}

	fmt.Printf("Insertion completed: %d inserted, %d failed\n", stats.Inserted, stats.Failed)

	// Create HNSW vector index for efficient similarity search
	fmt.Println("\nCreating HNSW vector index...")
	err = CreateHNSWVectorIndex(ctx, collection, config.VectorField, config.Dimensions)
	if err != nil {
		log.Fatalf("Failed to create HNSW vector index: %v", err)
	}

	// Allow time for index to become ready
	fmt.Println("Waiting for index to be ready...")
	time.Sleep(2 * time.Second)

	// Demonstrate HNSW search with various queries
	query := "quintessential lodging near running trails, eateries, retail"

	results, err := PerformHNSWVectorSearch(
		ctx,
		collection,
		azureOpenAIClient,
		query,
		config.VectorField,
		config.ModelName,
		5,  // topK
		16, // efSearch (not used directly in DocumentDB but kept for API consistency)
	)
	if err != nil {
		log.Fatalf("Failed to perform HNSW vector search: %v", err)
	}

	// Display the search results
	PrintSearchResults(results, 5, true)

	fmt.Println("\nHNSW demonstration completed successfully!")
}
