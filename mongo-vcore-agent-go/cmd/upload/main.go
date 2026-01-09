package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/Azure-Samples/cosmos-db-vector-samples/mongo-vcore-agent-go/internal/clients"
	"github.com/Azure-Samples/cosmos-db-vector-samples/mongo-vcore-agent-go/internal/models"
	"github.com/Azure-Samples/cosmos-db-vector-samples/mongo-vcore-agent-go/internal/vectorstore"
	"github.com/joho/godotenv"
)

func main() {
	// Load .env file from current directory
	if err := godotenv.Load(".env"); err != nil {
		log.Printf("Warning: .env file not found: %v", err)
	}

	ctx := context.Background()

	// Load configurations
	openaiConfig := clients.LoadConfigFromEnv()
	vsConfig := vectorstore.LoadConfigFromEnv()

	debug := openaiConfig.Debug

	if debug {
		fmt.Printf("DEBUG mode is ON\n")
	}

	// Get data file path
	dataFile := os.Getenv("DATA_FILE_WITHOUT_VECTORS")
	if dataFile == "" {
		dataFile = "./data/HotelsData_toCosmosDB.JSON"
	}

	fmt.Printf("Loading hotels from: %s\n", dataFile)

	// Load hotels from JSON
	hotels, err := vectorstore.LoadHotelsFromJSON(dataFile)
	if err != nil {
		log.Fatalf("Failed to load hotels: %v", err)
	}

	fmt.Printf("Loaded %d hotels\n", len(hotels))

	// Create Azure OpenAI clients
	openaiClients, err := clients.NewOpenAIClients(openaiConfig)
	if err != nil {
		log.Fatalf("Failed to create OpenAI clients: %v", err)
	}

	// Connect to vector store
	store, err := vectorstore.NewVectorStore(ctx, vsConfig)
	if err != nil {
		log.Fatalf("Failed to connect to vector store: %v", err)
	}
	defer store.Close(ctx)

	// Convert hotels and generate embeddings
	fmt.Println("\nGenerating embeddings and preparing documents...")
	hotelsWithVectors := make([]models.HotelForVectorStore, 0, len(hotels))

	for i, hotel := range hotels {
		// Convert to vector store format
		hotelVS := hotel.ToVectorStore()

		// Generate embedding
		pageContent := hotel.PageContent()
		embedding, err := openaiClients.GenerateEmbedding(ctx, pageContent)
		if err != nil {
			log.Printf("Warning: Failed to generate embedding for hotel %s: %v", hotel.HotelName, err)
			continue
		}

		hotelVS.ContentVector = embedding
		hotelsWithVectors = append(hotelsWithVectors, hotelVS)

		if debug && (i+1)%10 == 0 {
			fmt.Printf("Processed %d/%d hotels\n", i+1, len(hotels))
		}
	}

	fmt.Printf("Generated embeddings for %d hotels\n", len(hotelsWithVectors))

	// Insert documents into vector store
	fmt.Println("\nInserting documents into vector store...")
	if err := store.InsertHotelsWithEmbeddings(ctx, hotelsWithVectors); err != nil {
		log.Fatalf("Failed to insert hotels: %v", err)
	}

	fmt.Printf("Successfully inserted %d documents\n", len(hotelsWithVectors))

	// Create vector index
	fmt.Println("\nCreating vector index...")
	if err := store.CreateVectorIndex(ctx); err != nil {
		log.Fatalf("Failed to create vector index: %v", err)
	}

	fmt.Println("Vector index created successfully")
	fmt.Println("\nData upload complete!")
}
