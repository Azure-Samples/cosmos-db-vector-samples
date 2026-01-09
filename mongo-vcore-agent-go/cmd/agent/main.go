package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strconv"

	"github.com/Azure-Samples/cosmos-db-vector-samples/mongo-vcore-agent-go/internal/agents"
	"github.com/Azure-Samples/cosmos-db-vector-samples/mongo-vcore-agent-go/internal/clients"
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

	// Create vector search tool
	searchTool := agents.NewVectorSearchTool(openaiClients, store, debug)

	// Create agents
	plannerAgent := agents.NewPlannerAgent(openaiClients, searchTool, debug)
	synthesizerAgent := agents.NewSynthesizerAgent(openaiClients, debug)

	// Get query from environment or use default
	query := os.Getenv("QUERY")
	if query == "" {
		query = "quintessential lodging near running trails, eateries, retail"
	}

	// Get nearest neighbors from environment or use default
	nearestNeighbors := 5
	if nnStr := os.Getenv("NEAREST_NEIGHBORS"); nnStr != "" {
		if nn, err := strconv.Atoi(nnStr); err == nil {
			nearestNeighbors = nn
		}
	}

	fmt.Printf("\nQuery: %s\n", query)
	fmt.Printf("Nearest Neighbors: %d\n", nearestNeighbors)

	// Run planner agent
	hotelContext, err := plannerAgent.Run(ctx, query, nearestNeighbors)
	if err != nil {
		log.Fatalf("Planner agent failed: %v", err)
	}

	if debug {
		fmt.Printf("\n--- HOTEL CONTEXT ---\n%s\n", hotelContext)
	}

	// Run synthesizer agent
	finalAnswer, err := synthesizerAgent.Run(ctx, query, hotelContext)
	if err != nil {
		log.Fatalf("Synthesizer agent failed: %v", err)
	}

	// Display final answer
	fmt.Println("\n--- FINAL ANSWER ---")
	fmt.Println(finalAnswer)
}
