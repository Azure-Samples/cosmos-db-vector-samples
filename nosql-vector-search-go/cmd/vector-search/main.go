// Package main is the entry point for the Cosmos DB NoSQL vector search sample.
// It loads configuration, initializes Azure clients, inserts hotel data, generates
// an embedding for a search query, and performs a vector-similarity search.
package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/Azure/cosmos-db-vector-samples/nosql-vector-search-go/internal/client"
	"github.com/Azure/cosmos-db-vector-samples/nosql-vector-search-go/internal/config"
	"github.com/Azure/cosmos-db-vector-samples/nosql-vector-search-go/internal/data"
	"github.com/Azure/cosmos-db-vector-samples/nosql-vector-search-go/internal/query"
)

func main() {
	ctx := context.Background()

	// --- Load configuration ---
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("Configuration error: %v", err)
	}

	fmt.Println("\n📊 Vector Search Algorithm:", cfg.AlgorithmDisplay)
	fmt.Println("📏 Distance Function:", cfg.DistanceFunction)
	fmt.Println("📦 Container:", cfg.ContainerName)

	// --- Initialize Azure clients (passwordless) ---
	fmt.Println("\nInitializing Azure clients...")

	var clients *client.Clients
	openAIKey := os.Getenv("AZURE_OPENAI_EMBEDDING_KEY")
	if openAIKey != "" {
		clients, err = client.NewClientsWithKey(cfg.CosmosEndpoint, cfg.OpenAIEndpoint, openAIKey)
	} else {
		clients, err = client.NewClientsPasswordless(cfg.CosmosEndpoint, cfg.OpenAIEndpoint)
	}
	if err != nil {
		log.Fatalf("Failed to initialize clients: %v", err)
	}

	// --- Get database and container references ---
	database, err := clients.Cosmos.NewDatabase(cfg.DbName)
	if err != nil {
		log.Fatalf("Failed to get database %q: %v", cfg.DbName, err)
	}
	fmt.Printf("Connected to database: %s\n", cfg.DbName)

	container, err := database.NewContainer(cfg.ContainerName)
	if err != nil {
		log.Fatalf("Failed to get container %q: %v", cfg.ContainerName, err)
	}
	fmt.Printf("Connected to container: %s\n", cfg.ContainerName)

	// --- Load and insert hotel data ---
	hotels, err := data.LoadHotelsJSON(cfg.DataFile)
	if err != nil {
		log.Fatalf("Failed to load hotel data: %v", err)
	}

	_, err = data.InsertData(ctx, container, hotels)
	if err != nil {
		log.Fatalf("Failed to insert data: %v", err)
	}

	// --- Generate embedding for the search query ---
	fmt.Printf("Generating embedding for query: %q\n", cfg.Query)
	embedding, err := query.GenerateEmbedding(ctx, clients.OpenAI, cfg.Query, cfg.OpenAIDeployment)
	if err != nil {
		log.Fatalf("Failed to generate query embedding: %v", err)
	}
	fmt.Printf("Embedding generated (%d dimensions)\n", len(embedding))

	// --- Execute vector search ---
	results, requestCharge, err := query.ExecuteVectorSearch(ctx, container, embedding, cfg.EmbeddedField)
	if err != nil {
		log.Fatalf("Vector search failed: %v", err)
	}

	query.PrintSearchResults(results, requestCharge)
	fmt.Println("Vector search completed successfully!")
}
