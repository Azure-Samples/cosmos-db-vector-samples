package main

import (
	"context"
	"fmt"
	"log"

	"github.com/Azure/azure-sdk-for-go/sdk/azidentity"
	"github.com/Azure/azure-sdk-for-go/sdk/data/azcosmos"
)

func main() {
	ctx := context.Background()

	cfg, err := LoadConfig()
	if err != nil {
		log.Fatalf("configuration error: %v", err)
	}

	credential, err := azidentity.NewDefaultAzureCredential(nil)
	if err != nil {
		log.Fatalf("failed to create DefaultAzureCredential: %v", err)
	}

	cosmosClient, err := azcosmos.NewClient(cfg.CosmosEndpoint, credential, nil)
	if err != nil {
		log.Fatalf("failed to create Azure Cosmos DB client: %v", err)
	}

	databaseClient, err := cosmosClient.NewDatabase(cfg.DatabaseName)
	if err != nil {
		log.Fatalf("failed to access database %q: %v", cfg.DatabaseName, err)
	}

	documents, err := LoadDocuments(cfg.DataFileWithVectors)
	if err != nil {
		log.Fatalf("failed to load documents: %v", err)
	}

	httpClient := newHTTPClient()

	// --- Output: Setup ---
	fmt.Printf("Using Azure OpenAI Embedding Deployment/Model: %s\n", cfg.OpenAIEmbeddingDeployment)
	fmt.Printf("Reading JSON file from %s\n", cfg.DataFileWithVectors)
	fmt.Printf("Loaded %d documents\n", len(documents))

	// --- Ingest ---
	fmt.Printf("Processing in batches of %d...\n", len(documents))
	for _, containerName := range cfg.ContainerNames {
		containerClient, err := databaseClient.NewContainer(containerName)
		if err != nil {
			log.Fatalf("failed to access container %q: %v", containerName, err)
		}

		insertStats, err := InsertDocuments(ctx, containerClient, documents)
		if err != nil {
			log.Fatalf("container %q failed: %v. Verify that the database and containers were provisioned already and that your identity has Azure Cosmos DB data-plane access.", containerName, err)
		}
		if insertStats.Skipped > 0 && insertStats.Inserted == 0 {
			fmt.Printf("  ✓ %s: %d documents already exist (skipped)\n", containerName, insertStats.Skipped)
		} else {
			fmt.Printf("  ✓ %s: %d inserted (%.2f RUs)\n", containerName, insertStats.Inserted, insertStats.RequestCharge)
		}
	}

	// --- Query ---
	embedding, err := GenerateEmbedding(ctx, httpClient, credential, cfg, cfg.QueryText)
	if err != nil {
		log.Fatalf("failed to generate Azure OpenAI embedding: %v", err)
	}

	fmt.Printf("\nQuery: %q\n", cfg.QueryText)
	fmt.Printf("Embedding generated (%d dimensions)\n", len(embedding))
	fmt.Println("\nRunning searches (top 5 results)...")

	type containerResult struct {
		name    string
		label   string
		results []VectorSearchResult
		ru      float64
	}
	var allResults []containerResult

	for _, containerName := range cfg.ContainerNames {
		containerClient, err := databaseClient.NewContainer(containerName)
		if err != nil {
			log.Fatalf("failed to access container %q: %v", containerName, err)
		}

		results, ru, err := QueryTopHotels(ctx, containerClient, embedding, cfg.EmbeddingFieldName)
		if err != nil {
			log.Fatalf("container %q query failed: %v", containerName, err)
		}
		label := algorithmLabel(containerName)
		fmt.Printf("  ✓ %s queried (%.2f RUs)\n", containerName, ru)
		allResults = append(allResults, containerResult{name: containerName, label: label, results: results, ru: ru})
	}

	// --- Comparison table ---
	fmt.Println()
	fmt.Printf("| %-14s | %-26s | %-6s | %-26s | %-6s | %-6s |\n", "Algorithm", "Top 1 Result", "Score", "Top 2 Result", "Score", "Diff")
	fmt.Printf("|%s|%s|%s|%s|%s|%s|\n", dashes(16), dashes(28), dashes(8), dashes(28), dashes(8), dashes(8))
	for _, cr := range allResults {
		top1Name := ""
		top1Score := 0.0
		top2Name := ""
		top2Score := 0.0
		if len(cr.results) > 0 {
			top1Name = cr.results[0].HotelName
			top1Score = cr.results[0].Score
		}
		if len(cr.results) > 1 {
			top2Name = cr.results[1].HotelName
			top2Score = cr.results[1].Score
		}
		diff := top1Score - top2Score
		fmt.Printf("| %-14s | %-26s | %.4f | %-26s | %.4f | %.4f |\n", cr.label, truncate(top1Name, 26), top1Score, truncate(top2Name, 26), top2Score, diff)
	}

	fmt.Println("\nComplete")
}
