package main

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Azure/azure-sdk-for-go/sdk/azcore"
	"github.com/Azure/azure-sdk-for-go/sdk/azcore/runtime"
	"github.com/Azure/azure-sdk-for-go/sdk/azidentity"
	"github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/cosmos/armcosmos/v3"
)

const (
	armPollFrequency = 5 * time.Second
	armDeleteTimeout = 2 * time.Minute
	armCreateTimeout = 10 * time.Minute
	armReadTimeout   = 1 * time.Minute
)

// ptr is a helper to return a pointer to a value
func ptr[T any](v T) *T { return &v }

// CreateContainersWithVectorIndexes creates SQL containers with vector indexes using the ARM SDK
func CreateContainersWithVectorIndexes(
	ctx context.Context,
	credential *azidentity.DefaultAzureCredential,
	config *Config,
) error {
	if err := validateContainerDeletionSafety(config); err != nil {
		return fmt.Errorf("unsafe container deletion configuration: %w", err)
	}

	// Create ARM client
	client, err := armcosmos.NewSQLResourcesClient(config.SubscriptionID, credential, nil)
	if err != nil {
		return fmt.Errorf("failed to create ARM client: %w", err)
	}

	// Create containers with vector indexes
	indexConfigs := []struct {
		indexType     armcosmos.VectorIndexType
		containerName string
	}{
		{armcosmos.VectorIndexTypeDiskANN, config.DiskANNContainerName},
		{armcosmos.VectorIndexTypeQuantizedFlat, config.QuantizedFlatContainerName},
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
		fmt.Printf("  Pre-creation delete target: %s/%s/%s/%s\n", config.ResourceGroup, config.AccountName, config.DatabaseName, indexConfig.containerName)
		deleteStart := time.Now()
		deleteCtx, deleteCancel := context.WithTimeout(ctx, armDeleteTimeout)
		deletePoller, err := client.BeginDeleteSQLContainer(
			deleteCtx,
			config.ResourceGroup,
			config.AccountName,
			config.DatabaseName,
			indexConfig.containerName,
			nil,
		)
		if err != nil {
			deleteCancel()
			if isNotFound(err) {
				fmt.Printf("  ✓ Pre-creation deletion completed in %.1fs; container did not exist\n", time.Since(deleteStart).Seconds())
			} else {
				return fmt.Errorf("failed to begin pre-creation deletion for container %q: %w", indexConfig.containerName, err)
			}
		} else {
			fmt.Printf("  Waiting for pre-creation deletion to complete (polling every %s)...\n", armPollFrequency)
			_, err = deletePoller.PollUntilDone(
				deleteCtx,
				&runtime.PollUntilDoneOptions{Frequency: armPollFrequency},
			)
			deleteCancel()
			if err != nil {
				if isNotFound(err) {
					fmt.Printf("  ✓ Pre-creation deletion completed in %.1fs; container no longer exists\n", time.Since(deleteStart).Seconds())
				} else {
					return fmt.Errorf("failed to wait for pre-creation deletion of container %q: %w", indexConfig.containerName, err)
				}
			} else {
				fmt.Printf("  ✓ Pre-creation deletion completed in %.1fs\n", time.Since(deleteStart).Seconds())
			}
		}

		// Create the container
		fmt.Printf("  Creating container with vector index...\n")
		start := time.Now()
		createCtx, createCancel := context.WithTimeout(ctx, armCreateTimeout)

		// Note: Options is nil to support serverless accounts (which don't allow explicit throughput).
		// For provisioned accounts, you could set Options.Throughput or Options.AutoscaleSettings.
		containerPoller, err := client.BeginCreateUpdateSQLContainer(
			createCtx,
			config.ResourceGroup,
			config.AccountName,
			config.DatabaseName,
			indexConfig.containerName,
			armcosmos.SQLContainerCreateUpdateParameters{
				Location: ptr(config.Location),
				Properties: &armcosmos.SQLContainerCreateUpdateProperties{
					Resource: containerResource,
					Options:  nil, // nil = serverless compatible (no throughput setting)
				},
			},
			nil,
		)
		if err != nil {
			createCancel()
			return fmt.Errorf("failed to begin creating container %s: %w", indexConfig.containerName, err)
		}

		fmt.Printf("  Waiting for container creation to complete (polling every %s)...\n", armPollFrequency)
		if _, err := containerPoller.PollUntilDone(createCtx, &runtime.PollUntilDoneOptions{Frequency: armPollFrequency}); err != nil {
			createCancel()
			return fmt.Errorf("failed to create container %s: %w", indexConfig.containerName, err)
		}
		createCancel()

		elapsed := time.Since(start)
		fmt.Printf("  ✓ Container created in %.2fs\n", elapsed.Seconds())

		// Verify the container exists and has the correct configuration
		readCtx, readCancel := context.WithTimeout(ctx, armReadTimeout)
		got, err := client.GetSQLContainer(
			readCtx,
			config.ResourceGroup,
			config.AccountName,
			config.DatabaseName,
			indexConfig.containerName,
			nil,
		)
		readCancel()
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

func DeleteContainers(ctx context.Context, credential *azidentity.DefaultAzureCredential, cfg *Config) error {
	if err := validateContainerDeletionSafety(cfg); err != nil {
		return fmt.Errorf("unsafe container deletion configuration: %w", err)
	}

	client, err := armcosmos.NewSQLResourcesClient(cfg.SubscriptionID, credential, nil)
	if err != nil {
		return fmt.Errorf("failed to create SQL resources client: %w", err)
	}

	for _, containerName := range []string{cfg.DiskANNContainerName, cfg.QuantizedFlatContainerName} {
		fmt.Printf("  Delete target: %s/%s/%s/%s\n", cfg.ResourceGroup, cfg.AccountName, cfg.DatabaseName, containerName)
		start := time.Now()
		deleteCtx, cancel := context.WithTimeout(ctx, armDeleteTimeout)

		poller, err := client.BeginDeleteSQLContainer(
			deleteCtx,
			cfg.ResourceGroup,
			cfg.AccountName,
			cfg.DatabaseName,
			containerName,
			nil,
		)
		if err != nil {
			cancel()
			if isNotFound(err) {
				fmt.Printf("  ✓ Deletion completed in %.1fs; container does not exist: %s\n", time.Since(start).Seconds(), containerName)
				continue
			}
			return fmt.Errorf("failed to delete container %q: %w", containerName, err)
		}

		fmt.Printf("  Waiting for deletion to complete (polling every %s)...\n", armPollFrequency)
		_, err = poller.PollUntilDone(
			deleteCtx,
			&runtime.PollUntilDoneOptions{Frequency: armPollFrequency},
		)
		cancel()
		if err != nil {
			if isNotFound(err) {
				fmt.Printf("  ✓ Deletion completed in %.1fs; container does not exist: %s\n", time.Since(start).Seconds(), containerName)
				continue
			}
			return fmt.Errorf("failed to wait for container deletion %q: %w", containerName, err)
		}

		fmt.Printf("  ✓ Deleted %s in %.1fs\n", containerName, time.Since(start).Seconds())
	}

	return nil
}

func isNotFound(err error) bool {
	var responseError *azcore.ResponseError
	return errors.As(err, &responseError) && responseError.StatusCode == 404
}
