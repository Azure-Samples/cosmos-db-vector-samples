package main

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"

	"github.com/openai/openai-go/v3"
)

// CreateDiskANNVectorIndex creates a DiskANN vector index on the specified field
func CreateDiskANNVectorIndex(ctx context.Context, collection *mongo.Collection, vectorField string, dimensions int) error {
	fmt.Printf("Creating DiskANN vector index on field '%s'...\n", vectorField)

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
				{"name", fmt.Sprintf("diskann_index_%s", vectorField)},
				{"key", bson.D{
					{vectorField, "cosmosSearch"}, // DocumentDB vector search index type
				}},
				{"cosmosSearchOptions", bson.D{
					// DiskANN algorithm configuration
					{"kind", "vector-diskann"},

					// Vector dimensions must match the embedding model
					{"dimensions", dimensions},

					// Vector similarity metric - cosine is good for text embeddings
					{"similarity", "COS"},

					// Maximum degree: number of edges per node in the graph
					// Higher values improve accuracy but increase memory usage
					{"maxDegree", 20},

					// Build parameter: candidates evaluated during index construction
					// Higher values improve index quality but increase build time
					{"lBuild", 10},
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
			fmt.Println("\nDiskANN indexes require a higher cluster tier.")
			fmt.Println("Try one of these alternatives:")
			fmt.Println("  • Upgrade your DocumentDB cluster to a higher tier")
			fmt.Println("  • Use HNSW instead: go run src/hnsw.go")
			fmt.Println("  • Use IVF instead: go run src/ivf.go")
		}
		return fmt.Errorf("error creating DiskANN vector index: %v", err)
	}

	fmt.Println("DiskANN vector index created successfully")
	return nil
}

// PerformDiskANNVectorSearch performs a vector search using DiskANN algorithm
func PerformDiskANNVectorSearch(ctx context.Context, collection *mongo.Collection, openAIClient openai.Client, queryText, vectorField, modelName string, topK int) ([]SearchResult, error) {
	fmt.Printf("Performing DiskANN vector search for: '%s'\n", queryText)

	// Generate embedding for the query text
	queryEmbedding, err := GenerateEmbedding(ctx, openAIClient, queryText, modelName)
	if err != nil {
		return nil, fmt.Errorf("error generating embedding: %v", err)
	}

	// Construct the aggregation pipeline for vector search
	// DocumentDB uses $search with cosmosSearch
	pipeline := []bson.M{
		{
			"$search": bson.M{
				// Use cosmosSearch for vector operations in DocumentDB
				"cosmosSearch": bson.M{
					// The query vector to search for
					"vector": queryEmbedding,

					// Field containing the document vectors to compare against
					"path": vectorField,

					// Number of final results to return
					"k": topK,
				},
			},
		},
		{
			// Add similarity score to the results
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
		return nil, fmt.Errorf("error performing DiskANN vector search: %v", err)
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

// main function demonstrates DiskANN vector search functionality
func main() {
	ctx := context.Background()

	// Load configuration from environment variables
	config := LoadConfig()

	fmt.Println("\nInitializing MongoDB and Azure OpenAI clients...")
	mongoClient, azureOpenAIClient, err := GetClientsPasswordless()
	if err != nil {
		log.Fatalf("Failed to initialize clients: %v", err)
	}
	defer mongoClient.Disconnect(ctx)

	// Get database and collection
	database := mongoClient.Database(config.DatabaseName)
	collection := database.Collection(config.CollectionName)

	// Load data with embeddings
	fmt.Printf("\nLoading data from %s...\n", config.DataFile)
	data, err := ReadFileReturnJSON(config.DataFile)
	if err != nil {
		log.Fatalf("Failed to load data: %v", err)
	}
	fmt.Printf("Loaded %d documents\n", len(data))

	// Verify embeddings are present
	var documentsWithEmbeddings []map[string]interface{}
	for _, doc := range data {
		if _, exists := doc[config.VectorField]; exists {
			documentsWithEmbeddings = append(documentsWithEmbeddings, doc)
		}
	}

	if len(documentsWithEmbeddings) == 0 {
		log.Fatalf("No documents found with embeddings in field '%s'. Please run create_embeddings.go first.", config.VectorField)
	}

	// Insert data into collection
	fmt.Printf("\nInserting data into collection '%s'...\n", config.CollectionName)

	// Clear existing data to ensure clean state
	deleteResult, err := collection.DeleteMany(ctx, bson.M{})
	if err != nil {
		log.Fatalf("Failed to clear existing data: %v", err)
	}
	if deleteResult.DeletedCount > 0 {
		fmt.Printf("Cleared %d existing documents from collection\n", deleteResult.DeletedCount)
	}

	// Insert the hotel data
	stats, err := InsertData(ctx, collection, documentsWithEmbeddings, config.BatchSize, nil)
	if err != nil {
		log.Fatalf("Failed to insert data: %v", err)
	}

	if stats.Inserted == 0 {
		log.Fatalf("No documents were inserted successfully")
	}

	fmt.Printf("Insertion completed: %d inserted, %d failed\n", stats.Inserted, stats.Failed)

	// Create DiskANN vector index
	err = CreateDiskANNVectorIndex(ctx, collection, config.VectorField, config.Dimensions)
	if err != nil {
		log.Fatalf("Failed to create DiskANN vector index: %v", err)
	}

	// Wait briefly for index to be ready
	fmt.Println("Waiting for index to be ready...")
	time.Sleep(2 * time.Second)

	// Perform sample vector search
	query := "quintessential lodging near running trails, eateries, retail"

	results, err := PerformDiskANNVectorSearch(
		ctx,
		collection,
		azureOpenAIClient,
		query,
		config.VectorField,
		config.ModelName,
		5,
	)
	if err != nil {
		log.Fatalf("Failed to perform vector search: %v", err)
	}

	// Display results
	PrintSearchResults(results, 5, true)

	fmt.Println("\nDiskANN demonstration completed successfully!")
}
