package main

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/Azure/azure-sdk-for-go/sdk/azcore/runtime"
	"github.com/Azure/azure-sdk-for-go/sdk/azidentity"
	"github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/cosmos/armcosmos/v3"
)

// ptr is a helper to return a pointer to a value
func ptr[T any](v T) *T { return &v }

// getSubscriptionID resolves the subscription at runtime via the Azure CLI
func getSubscriptionID() (string, error) {
	out, err := exec.Command("az", "account", "show", "--query", "id", "-o", "tsv").Output()
	if err != nil {
		return "", fmt.Errorf("az account show failed: %w", err)
	}
	return strings.TrimSpace(string(out)), nil
}

// CreateContainersWithVectorIndexes creates SQL containers with vector indexes using the ARM SDK
func CreateContainersWithVectorIndexes(
	ctx context.Context,
	credential *azidentity.DefaultAzureCredential,
	config *Config,
) error {
	// Get subscription ID
	subscriptionID, err := getSubscriptionID()
	if err != nil {
		return fmt.Errorf("failed to get subscription ID: %w", err)
	}

	// Create ARM client
	client, err := armcosmos.NewSQLResourcesClient(subscriptionID, credential, nil)
	if err != nil {
		return fmt.Errorf("failed to create ARM client: %w", err)
	}

	// Ensure database exists first
	fmt.Printf("\n=== Phase 1: Create Database ===\n")
	fmt.Printf("  Database: %s\n", config.DatabaseName)

	dbPoller, err := client.BeginCreateUpdateSQLDatabase(
		ctx,
		config.ResourceGroup,
		config.AccountName,
		config.DatabaseName,
		armcosmos.SQLDatabaseCreateUpdateParameters{
			Location: ptr(config.Location),
			Properties: &armcosmos.SQLDatabaseCreateUpdateProperties{
				Resource: &armcosmos.SQLDatabaseResource{
					ID: ptr(config.DatabaseName),
				},
				Options: &armcosmos.CreateUpdateOptions{},
			},
		},
		nil,
	)
	if err != nil {
		return fmt.Errorf("failed to begin creating database: %w", err)
	}

	if _, err := dbPoller.PollUntilDone(ctx, &runtime.PollUntilDoneOptions{Frequency: 5 * time.Second}); err != nil {
		return fmt.Errorf("failed to create database: %w", err)
	}

	fmt.Printf("  ✓ Database created or already exists\n")

	// Create containers with vector indexes
	indexConfigs := []struct {
		indexType     armcosmos.VectorIndexType
		containerName string
	}{
		{armcosmos.VectorIndexTypeDiskANN, diskANNContainer},
		{armcosmos.VectorIndexTypeQuantizedFlat, quantizedFlatContainer},
	}

	embeddingPath := "/" + strings.TrimPrefix(config.EmbeddingFieldName, "/")
	partitionKeyPath := "/" + config.PartitionKeyFieldName

	for _, indexConfig := range indexConfigs {
		fmt.Printf("\n=== Creating Container: %s ===\n", indexConfig.containerName)
		fmt.Printf("  Index type:     %s\n", string(indexConfig.indexType))
		fmt.Printf("  Embedding path: %s\n", embeddingPath)
		fmt.Printf("  Dimensions:     %d\n", config.EmbeddingDimensions)
		fmt.Printf("  Distance func:  cosine (queried with all 3 metrics)\n")

		// Build container resource with vector embedding policy
		containerResource := &armcosmos.SQLContainerResource{
			ID: ptr(indexConfig.containerName),
			PartitionKey: &armcosmos.ContainerPartitionKey{
				Paths: []*string{ptr(partitionKeyPath)},
				Kind:  ptr(armcosmos.PartitionKindHash),
			},
			VectorEmbeddingPolicy: &armcosmos.VectorEmbeddingPolicy{
				VectorEmbeddings: []*armcosmos.VectorEmbedding{
					{
						Path:             ptr(embeddingPath),
						DataType:         ptr(armcosmos.VectorDataTypeFloat32),
						Dimensions:       ptr(int32(config.EmbeddingDimensions)),
						DistanceFunction: ptr(armcosmos.DistanceFunctionCosine),
					},
				},
			},
			IndexingPolicy: &armcosmos.IndexingPolicy{
				IndexingMode: ptr(armcosmos.IndexingModeConsistent),
				Automatic:    ptr(true),
				IncludedPaths: []*armcosmos.IncludedPath{
					{Path: ptr("/*")},
				},
				ExcludedPaths: []*armcosmos.ExcludedPath{
					{Path: ptr(`/"_etag"/?`)},
					{Path: ptr(embeddingPath + "/*")},
				},
				VectorIndexes: []*armcosmos.VectorIndex{
					{
						Path: ptr(embeddingPath),
						Type: ptr(indexConfig.indexType),
					},
				},
			},
		}

		// Delete existing container for idempotent re-runs
		fmt.Printf("  Cleaning up existing container...\n")
		deletePoller, err := client.BeginDeleteSQLContainer(
			ctx,
			config.ResourceGroup,
			config.AccountName,
			config.DatabaseName,
			indexConfig.containerName,
			nil,
		)
		if err == nil {
			// If delete operation started, wait for it
			if _, err = deletePoller.PollUntilDone(ctx, &runtime.PollUntilDoneOptions{Frequency: 5 * time.Second}); err == nil {
				fmt.Printf("  Deleted existing container\n")
			}
		}

		// Create the container
		fmt.Printf("  Creating container with vector index...\n")
		start := time.Now()

		containerPoller, err := client.BeginCreateUpdateSQLContainer(
			ctx,
			config.ResourceGroup,
			config.AccountName,
			config.DatabaseName,
			indexConfig.containerName,
			armcosmos.SQLContainerCreateUpdateParameters{
				Location: ptr(config.Location),
				Properties: &armcosmos.SQLContainerCreateUpdateProperties{
					Resource: containerResource,
					Options: &armcosmos.CreateUpdateOptions{
						Throughput: ptr(int32(400)), // 400 RU/s
					},
				},
			},
			nil,
		)
		if err != nil {
			return fmt.Errorf("failed to begin creating container %s: %w", indexConfig.containerName, err)
		}

		if _, err := containerPoller.PollUntilDone(ctx, &runtime.PollUntilDoneOptions{Frequency: 5 * time.Second}); err != nil {
			return fmt.Errorf("failed to create container %s: %w", indexConfig.containerName, err)
		}

		elapsed := time.Since(start)
		fmt.Printf("  ✓ Container created in %.2fs\n", elapsed.Seconds())

		// Verify the container exists and has the correct configuration
		got, err := client.GetSQLContainer(
			ctx,
			config.ResourceGroup,
			config.AccountName,
			config.DatabaseName,
			indexConfig.containerName,
			nil,
		)
		if err != nil {
			return fmt.Errorf("failed to verify container %s: %w", indexConfig.containerName, err)
		}

		res := got.Properties.Resource
		if res == nil {
			return fmt.Errorf("read-back resource for %s is nil", indexConfig.containerName)
		}

		// Log verification
		if res.VectorEmbeddingPolicy != nil && len(res.VectorEmbeddingPolicy.VectorEmbeddings) > 0 {
			emb := res.VectorEmbeddingPolicy.VectorEmbeddings[0]
			fmt.Printf("  ✓ Verified: Vector embedding policy configured\n")
			fmt.Printf("    - Path: %s\n", *emb.Path)
			fmt.Printf("    - DataType: %s\n", *emb.DataType)
			fmt.Printf("    - Dimensions: %d\n", *emb.Dimensions)
			fmt.Printf("    - DistanceFunction: %s\n", *emb.DistanceFunction)
		}

		if res.IndexingPolicy != nil && len(res.IndexingPolicy.VectorIndexes) > 0 {
			idx := res.IndexingPolicy.VectorIndexes[0]
			fmt.Printf("  ✓ Verified: Vector index configured\n")
			fmt.Printf("    - Path: %s\n", *idx.Path)
			fmt.Printf("    - Type: %s\n", *idx.Type)
		}
	}

	fmt.Printf("\n✓ All containers created successfully\n")
	return nil
}

