package main

import (
	"context"
	"fmt"
	"log"

	"github.com/Azure-Samples/cosmos-db-vector-samples/mongo-vcore-agent-go/internal/vectorstore"
	"github.com/joho/godotenv"
)

func main() {
	// Load .env file from current directory
	if err := godotenv.Load(".env"); err != nil {
		log.Printf("Warning: .env file not found: %v", err)
	}

	ctx := context.Background()

	// Load configuration
	vsConfig := vectorstore.LoadConfigFromEnv()

	fmt.Printf("Connecting to database: %s\n", vsConfig.DatabaseName)

	// Connect to vector store
	store, err := vectorstore.NewVectorStore(ctx, vsConfig)
	if err != nil {
		log.Fatalf("Failed to connect to vector store: %v", err)
	}
	defer store.Close(ctx)

	// Delete database
	fmt.Printf("\nDeleting database: %s\n", vsConfig.DatabaseName)
	if err := store.DeleteDatabase(ctx); err != nil {
		log.Fatalf("Failed to delete database: %v", err)
	}

	fmt.Println("Database deleted successfully!")
}
