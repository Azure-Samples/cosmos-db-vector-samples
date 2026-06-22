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

	// --- Control Plane: Create containers with vector indexes (ARM SDK) ---
	if err := CreateContainersWithVectorIndexes(ctx, credential, cfg); err != nil {
		log.Fatalf("failed to create containers: %v", err)
	}

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
	fmt.Println("\nRunning search (top 3 results for each distance function)...")

	type metricResult struct {
		containerName string
		metric        string
		results       []VectorSearchResult
		ru            float64
	}
	var allResults []metricResult
	distanceFunctions := []string{"Cosine", "DotProduct", "Euclidean"}

	for _, containerName := range cfg.ContainerNames {
		containerClient, err := databaseClient.NewContainer(containerName)
		if err != nil {
			log.Fatalf("failed to access container %q: %v", containerName, err)
		}

		for _, distanceFunction := range distanceFunctions {
			results, ru, err := QueryTopHotels(ctx, containerClient, embedding, cfg.EmbeddingFieldName, distanceFunction)
			if err != nil {
				log.Fatalf("container %q query failed: %v", containerName, err)
			}
			fmt.Printf("  ✓ %s queried (%.2f RUs)\n", containerName, ru)
			allResults = append(allResults, metricResult{
				containerName: containerName,
				metric:        distanceFunction,
				results:       results,
				ru:            ru,
			})
		}
	}

	// --- Comparison table (before cleanup) ---
	fmt.Println()
	fmt.Printf("| %-20s | %-10s | %-26s | %-6s | %-26s | %-6s | %-6s |\n", "Container", "Metric", "Top 1 Result", "Score", "Top 2 Result", "Score", "Diff")
	fmt.Printf("|%s|%s|%s|%s|%s|%s|%s|\n", dashes(22), dashes(12), dashes(28), dashes(8), dashes(28), dashes(8), dashes(8))
	for _, mr := range allResults {
		top1Name := ""
		top1Score := 0.0
		top2Name := ""
		top2Score := 0.0
		if len(mr.results) > 0 {
			top1Name = mr.results[0].HotelName
			top1Score = mr.results[0].Score
		}
		if len(mr.results) > 1 {
			top2Name = mr.results[1].HotelName
			top2Score = mr.results[1].Score
		}
		diff := top1Score - top2Score
		fmt.Printf("| %-20s | %-10s | %-26s | %.4f | %-26s | %.4f | %.4f |\n", truncate(mr.containerName, 20), mr.metric, truncate(top1Name, 26), top1Score, truncate(top2Name, 26), top2Score, diff)
	}

	fmt.Println("\nComplete")
}
