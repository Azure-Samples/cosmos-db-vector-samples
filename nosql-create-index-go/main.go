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
	embedding, err := GenerateEmbedding(ctx, httpClient, credential, cfg, cfg.QueryText)
	if err != nil {
		log.Fatalf("failed to generate Azure OpenAI embedding: %v", err)
	}

	fmt.Printf("Azure Cosmos DB vector index sample (Go)\n")
	fmt.Printf("database=%s primaryContainer=%s vectorAlgorithm=%s dataFile=%s\n", cfg.DatabaseName, cfg.PrimaryContainerName, cfg.VectorAlgorithm, cfg.DataFileWithVectors)
	fmt.Printf("embeddingDeployment=%s dimensions=%d partitionKey=%s\n", cfg.OpenAIEmbeddingDeployment, len(embedding), cfg.PartitionKeyFieldValue)

	for _, containerName := range cfg.ContainerNames {
		containerClient, err := databaseClient.NewContainer(containerName)
		if err != nil {
			log.Fatalf("failed to access container %q: %v", containerName, err)
		}

		result, err := RunContainerScenario(ctx, containerClient, containerName, documents, embedding, cfg.EmbeddingFieldName)
		if err != nil {
			log.Fatalf("container %q failed: %v. Verify that the database and containers were provisioned already and that your identity has Azure Cosmos DB data-plane access.", containerName, err)
		}
		PrintContainerRunResult(result)
	}
}
