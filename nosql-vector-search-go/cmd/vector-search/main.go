// Package main is the entry point for the Cosmos DB NoSQL vector search sample.
// It loads configuration, initializes Azure clients, inserts hotel data, generates
// an embedding for a search query, and performs a vector-similarity search.
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/Azure/cosmos-db-vector-samples/nosql-vector-search-go/internal/client"
	"github.com/Azure/cosmos-db-vector-samples/nosql-vector-search-go/internal/config"
	"github.com/Azure/cosmos-db-vector-samples/nosql-vector-search-go/internal/data"
	"github.com/Azure/cosmos-db-vector-samples/nosql-vector-search-go/internal/query"
)

var comparisonAlgorithmOrder = []string{"diskann", "quantizedflat"}

var comparisonMetricOrder = []string{"cosine", "euclidean", "dotproduct"}

var comparisonMetricLabels = map[string]string{
	"cosine":     "COS",
	"euclidean":  "L2",
	"dotproduct": "IP",
}

func truncateHotelName(name string) string {
	if len(name) > 20 {
		return name[:20] + ".."
	}
	return name
}

func printComparisonTable(results map[string]map[string][]query.QueryResult) {
	fmt.Println("\n| Algorithm     | Metric | Top 1 Result            | Score  | Top 2 Result            | Score  |")
	fmt.Println("|---------------|--------|-------------------------|--------|-------------------------|--------|")

	for _, algorithm := range comparisonAlgorithmOrder {
		algoCfg := config.AlgorithmConfigs[algorithm]
		metricResults := results[algorithm]

		for _, metric := range comparisonMetricOrder {
			rows := metricResults[metric]

			top1Name := "N/A"
			top1Score := "N/A"
			if len(rows) > 0 {
				top1Name = truncateHotelName(rows[0].HotelName)
				top1Score = fmt.Sprintf("%.4f", rows[0].SimilarityScore)
			}

			top2Name := "N/A"
			top2Score := "N/A"
			if len(rows) > 1 {
				top2Name = truncateHotelName(rows[1].HotelName)
				top2Score = fmt.Sprintf("%.4f", rows[1].SimilarityScore)
			}

			fmt.Printf(
				"| %-13s | %-6s | %-24s | %6s | %-24s | %6s |\n",
				algoCfg.AlgorithmName,
				comparisonMetricLabels[metric],
				top1Name,
				top1Score,
				top2Name,
				top2Score,
			)
		}
	}

	fmt.Println("\n====================================================================================================")
	fmt.Println("Summary: Compared 2 algorithms x 3 metrics = 6 combinations")
	fmt.Println("====================================================================================================")
}

func main() {
	ctx := context.Background()

	// --- Load configuration ---
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("Configuration error: %v", err)
	}

	// Check for comparison mode
	compareMetrics := strings.EqualFold(os.Getenv("COMPARE_DISTANCE_METRICS"), "true")

	fmt.Println("\nVector Search Algorithm:", cfg.AlgorithmDisplay)
	fmt.Println("Distance Function:", cfg.DistanceFunction)
	if compareMetrics {
		fmt.Println("Comparison Mode: metrics across DiskANN and QuantizedFlat")
	}
	fmt.Println("Container:", cfg.ContainerName)

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

	// --- Load and insert hotel data ---
	hotels, err := data.LoadHotelsJSON(cfg.DataFile)
	if err != nil {
		log.Fatalf("Failed to load hotel data: %v", err)
	}

	// --- Generate embedding for the search query ---
	fmt.Printf("Generating embedding for query: %q\n", cfg.Query)
	embedding, err := query.GenerateEmbedding(ctx, clients.OpenAI, cfg.Query, cfg.OpenAIDeployment)
	if err != nil {
		log.Fatalf("Failed to generate query embedding: %v", err)
	}
	fmt.Printf("Embedding generated (%d dimensions)\n", len(embedding))

	// --- Execute vector search ---
	if compareMetrics {
		allResults := make(map[string]map[string][]query.QueryResult)

		for _, algorithm := range comparisonAlgorithmOrder {
			algoCfg := config.AlgorithmConfigs[algorithm]
			container, err := database.NewContainer(algoCfg.ContainerName)
			if err != nil {
				log.Fatalf("Failed to get container %q: %v", algoCfg.ContainerName, err)
			}

			fmt.Printf("Connected to container: %s\n", algoCfg.ContainerName)

			if _, err = data.InsertData(ctx, container, hotels); err != nil {
				log.Fatalf("Failed to insert data into %q: %v", algoCfg.ContainerName, err)
			}

			results, _, err := query.ExecuteMetricComparison(ctx, container, embedding, cfg.EmbeddedField)
			if err != nil {
				log.Fatalf("Metric comparison failed for %s: %v", algoCfg.AlgorithmName, err)
			}

			allResults[algorithm] = results
		}

		printComparisonTable(allResults)
	} else {
		container, err := database.NewContainer(cfg.ContainerName)
		if err != nil {
			log.Fatalf("Failed to get container %q: %v", cfg.ContainerName, err)
		}
		fmt.Printf("Connected to container: %s\n", cfg.ContainerName)

		if _, err = data.InsertData(ctx, container, hotels); err != nil {
			log.Fatalf("Failed to insert data: %v", err)
		}

		results, requestCharge, err := query.ExecuteVectorSearch(ctx, container, embedding, cfg.EmbeddedField, cfg.DistanceFunction)
		if err != nil {
			log.Fatalf("Vector search failed: %v", err)
		}
		query.PrintSearchResults(results, requestCharge)
	}

	fmt.Println("Vector search completed successfully!")
}
