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

// CreateIVFVectorIndex creates an IVF (Inverted File) vector index on the specified field
func CreateIVFVectorIndex(ctx context.Context, collection *mongo.Collection, vectorField string, dimensions int) error {
	fmt.Printf("Creating IVF vector index on field '%s'...\n", vectorField)

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
				{"name", fmt.Sprintf("ivf_index_%s", vectorField)},
				{"key", bson.D{
					{vectorField, "cosmosSearch"}, // DocumentDB vector search index type
				}},
				{"cosmosSearchOptions", bson.D{
					// IVF algorithm configuration
					{"kind", "vector-ivf"},

					// Vector dimensions must match the embedding model
					{"dimensions", dimensions},

					// Cosine similarity is effective for text embeddings
					{"similarity", "COS"},

					// Number of clusters (centroids) to partition vectors into
					// More clusters = faster search but potentially lower recall
					// For small datasets like this, use fewer clusters
					{"numLists", 10},
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
			fmt.Println("\nIVF indexes require a higher cluster tier.")
			fmt.Println("Try one of these alternatives:")
			fmt.Println("  • Upgrade your DocumentDB cluster to a higher tier")
			fmt.Println("  • Use HNSW instead: go run src/hnsw.go")
			fmt.Println("  • Use DiskANN instead: go run src/diskann.go")
		}
		return fmt.Errorf("error creating IVF vector index: %v", err)
	}

	fmt.Println("IVF vector index created successfully")
	return nil
}

// PerformIVFVectorSearch performs a vector search using IVF algorithm
func PerformIVFVectorSearch(ctx context.Context, collection *mongo.Collection, openaAIClient openai.Client, queryText, vectorField, modelName string, topK int, numProbes int) ([]SearchResult, error) {
	fmt.Printf("Performing IVF vector search for: '%s'\n", queryText)

	// Generate embedding vector for the search query
	queryEmbedding, err := GenerateEmbedding(ctx, openaAIClient, queryText, modelName)
	if err != nil {
		return nil, fmt.Errorf("error generating embedding: %v", err)
	}

	// Construct aggregation pipeline for IVF vector search
	// DocumentDB uses $search with cosmosSearch
	pipeline := []bson.M{
		{
			"$search": bson.M{
				// Use cosmosSearch for vector operations in DocumentDB
				"cosmosSearch": bson.M{
					// Query vector to find similar documents
					"vector": queryEmbedding,

					// Document field containing vectors to search against
					"path": vectorField,

					// Final number of results to return
					"k": topK,
				},
			},
		},
		{
			// Project only the fields we want in the output and add similarity score
			"$project": bson.M{
				"document": "$$ROOT",
				// Add search score from metadata
				"score": bson.M{"$meta": "searchScore"},
			},
		},
	}

	// Execute the aggregation pipeline
	cursor, err := collection.Aggregate(ctx, pipeline)
	if err != nil {
		return nil, fmt.Errorf("error performing IVF vector search: %v", err)
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

// main function demonstrates IVF vector search functionality
func main() {
	fmt.Println("Starting IVF vector search demonstration...")

	ctx := context.Background()

	// Load configuration from environment variables
	config := LoadConfig()

	fmt.Println("\nInitializing MongoDB and Azure OpenAI clients...")
	mongoClient, azureOpenAIClient, err := GetClientsPasswordless()
	if err != nil {
		log.Fatalf("Failed to initialize clients: %v", err)
	}
	defer mongoClient.Disconnect(ctx)

	// Connect to database and collection
	database := mongoClient.Database(config.DatabaseName)
	collection := database.Collection(config.CollectionName)

	// Load hotel data with embeddings
	fmt.Printf("\nLoading data from %s...\n", config.DataFile)
	data, err := ReadFileReturnJSON(config.DataFile)
	if err != nil {
		log.Fatalf("Failed to load data: %v", err)
	}
	fmt.Printf("Loaded %d documents\n", len(data))

	// Verify embeddings exist in the data
	var documentsWithEmbeddings []map[string]interface{}
	for _, doc := range data {
		if _, exists := doc[config.VectorField]; exists {
			documentsWithEmbeddings = append(documentsWithEmbeddings, doc)
		}
	}

	if len(documentsWithEmbeddings) == 0 {
		log.Fatalf("No documents found with embeddings in field '%s'. Please run create_embeddings.go first.", config.VectorField)
	}

	// Prepare collection with fresh data
	fmt.Printf("\nPreparing collection '%s'...\n", config.CollectionName)

	// Remove any existing data for clean state
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

	// Create IVF vector index for clustering-based search
	fmt.Println("\nCreating IVF vector index...")
	err = CreateIVFVectorIndex(ctx, collection, config.VectorField, config.Dimensions)
	if err != nil {
		log.Fatalf("Failed to create IVF vector index: %v", err)
	}

	// Wait for index to be built and ready
	fmt.Println("Waiting for index clustering to complete...")
	time.Sleep(3 * time.Second) // IVF may need more time for clustering

	// Demonstrate IVF search
	query := "quintessential lodging near running trails, eateries, retail"

	results, err := PerformIVFVectorSearch(
		ctx,
		collection,
		azureOpenAIClient,
		query,
		config.VectorField,
		config.ModelName,
		5, // topK
		1, // numProbes (not used in DocumentDB but kept for API consistency)
	)
	if err != nil {
		log.Fatalf("Failed to perform IVF vector search: %v", err)
	}

	// Display the search results
	PrintSearchResults(results, 5, true)

	fmt.Println("\nIVF demonstration completed successfully!")
}
