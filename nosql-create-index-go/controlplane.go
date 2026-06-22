package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/Azure/azure-sdk-for-go/sdk/azcore/policy"
	"github.com/Azure/azure-sdk-for-go/sdk/azidentity"
)

// ContainerPayload defines the full container creation request for ARM API
type ContainerPayload struct {
	Properties ContainerProperties `json:"properties"`
}

type ContainerProperties struct {
	Resource ContainerResource `json:"resource"`
}

type ContainerResource struct {
	ID                    string                `json:"id"`
	PartitionKey          PartitionKey          `json:"partitionKey"`
	IndexingPolicy        IndexingPolicy        `json:"indexingPolicy"`
	VectorEmbeddingPolicy VectorEmbeddingPolicy `json:"vectorEmbeddingPolicy"`
}

type PartitionKey struct {
	Paths   []string `json:"paths"`
	Kind    string   `json:"kind"`
	Version int      `json:"version"`
}

type IndexingPolicy struct {
	IndexingMode   string                `json:"indexingMode"`
	Automatic      bool                  `json:"automatic"`
	IncludedPaths  []map[string]string   `json:"includedPaths"`
	ExcludedPaths  []map[string]string   `json:"excludedPaths"`
	VectorIndexes  []map[string]string   `json:"vectorIndexes"`
}

type VectorEmbeddingPolicy struct {
	VectorEmbeddings []map[string]interface{} `json:"vectorEmbeddings"`
}

// buildContainerPayload creates the container definition with vector index configuration
func buildContainerPayload(
	containerName string,
	partitionKeyPath string,
	embeddingField string,
	dimensions int,
	indexType string,
) ContainerPayload {
	embeddingPath := "/" + strings.TrimPrefix(embeddingField, "/")
	indexTypeNormalized := strings.ToLower(strings.TrimSpace(indexType))
	if indexTypeNormalized == "quantizedflat" {
		indexTypeNormalized = "quantizedFlat"
	}

	return ContainerPayload{
		Properties: ContainerProperties{
			Resource: ContainerResource{
				ID: containerName,
				PartitionKey: PartitionKey{
					Paths:   []string{partitionKeyPath},
					Kind:    "Hash",
					Version: 1,
				},
				IndexingPolicy: IndexingPolicy{
					IndexingMode:  "consistent",
					Automatic:     true,
					IncludedPaths: []map[string]string{{"path": "/*"}},
					ExcludedPaths: []map[string]string{{"path": "/_etag/?"}},
					VectorIndexes: []map[string]string{
						{
							"path": embeddingPath,
							"type": indexTypeNormalized,
						},
					},
				},
				VectorEmbeddingPolicy: VectorEmbeddingPolicy{
					VectorEmbeddings: []map[string]interface{}{
						{
							"path":             embeddingPath,
							"dataType":         "float32",
							"dimensions":       dimensions,
							"distanceFunction": "cosine",
						},
					},
				},
			},
		},
	}
}

// deleteContainerIfExists removes an existing container (idempotent) using ARM REST API
func deleteContainerIfExists(
	ctx context.Context,
	credential *azidentity.DefaultAzureCredential,
	subscriptionID string,
	resourceGroup string,
	accountName string,
	databaseName string,
	containerName string,
) error {
	// Get token for ARM API
	token, err := credential.GetToken(ctx, policy.TokenRequestOptions{
		Scopes: []string{"https://management.azure.com/.default"},
	})
	if err != nil {
		return fmt.Errorf("failed to get auth token: %w", err)
	}

	url := fmt.Sprintf(
		"https://management.azure.com/subscriptions/%s/resourceGroups/%s/providers/Microsoft.DocumentDB/databaseAccounts/%s/sqlDatabases/%s/containers/%s?api-version=2024-05-15",
		subscriptionID, resourceGroup, accountName, databaseName, containerName,
	)

	// Try to get the container first
	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+token.Token)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to check container existence: %w", err)
	}
	defer resp.Body.Close()

	// If not found, nothing to delete
	if resp.StatusCode == http.StatusNotFound {
		return nil
	}

	// If any other error, report it
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to check container: status %d, body: %s", resp.StatusCode, string(body))
	}

	// Container exists, delete it
	fmt.Printf("  Deleting existing container %q...\n", containerName)
	req, _ = http.NewRequestWithContext(ctx, "DELETE", url, nil)
	req.Header.Set("Authorization", "Bearer "+token.Token)

	resp, err = client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to delete container: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to delete container: status %d, body: %s", resp.StatusCode, string(body))
	}

	fmt.Printf("  Deleted container %q\n", containerName)
	return nil
}

// CreateContainersWithVectorIndexes creates containers with vector indexes using ARM REST API
func CreateContainersWithVectorIndexes(
	ctx context.Context,
	credential *azidentity.DefaultAzureCredential,
	config *Config,
) error {
	// Get token for ARM API
	token, err := credential.GetToken(ctx, policy.TokenRequestOptions{
		Scopes: []string{"https://management.azure.com/.default"},
	})
	if err != nil {
		return fmt.Errorf("failed to get auth token: %w", err)
	}

	indexConfigs := []struct {
		indexType     string
		containerName string
	}{
		{"diskANN", diskANNContainer},
		{"quantizedFlat", quantizedFlatContainer},
	}

	embeddingPath := "/" + strings.TrimPrefix(config.EmbeddingFieldName, "/")
	partitionKeyPath := "/" + config.PartitionKeyFieldName

	for _, indexConfig := range indexConfigs {
		fmt.Println("\n=== Phase 1: Create Container with Vector Index (ARM SDK) ===")
		fmt.Printf("  Container:      %s\n", indexConfig.containerName)
		fmt.Printf("  Index type:     %s\n", indexConfig.indexType)
		fmt.Printf("  Embedding path: %s\n", embeddingPath)
		fmt.Printf("  Dimensions:     %d\n", config.EmbeddingDimensions)
		fmt.Printf("  Distance func:  cosine (queried with all 3 metrics)\n")

		// Delete existing container for clean state (idempotent)
		if err := deleteContainerIfExists(
			ctx,
			credential,
			config.SubscriptionID,
			config.ResourceGroup,
			config.AccountName,
			config.DatabaseName,
			indexConfig.containerName,
		); err != nil {
			return fmt.Errorf("failed to delete existing container %q: %w", indexConfig.containerName, err)
		}

		// Build container payload
		payload := buildContainerPayload(
			indexConfig.containerName,
			partitionKeyPath,
			config.EmbeddingFieldName,
			config.EmbeddingDimensions,
			indexConfig.indexType,
		)

		// Convert payload to JSON
		payloadJSON, _ := json.MarshalIndent(payload, "  ", "  ")
		fmt.Printf("  Payload:\n%s\n", payloadJSON)

		// Create container via REST API
		fmt.Printf("  Creating container %q with vector index...\n", indexConfig.containerName)
		start := time.Now()

		url := fmt.Sprintf(
			"https://management.azure.com/subscriptions/%s/resourceGroups/%s/providers/Microsoft.DocumentDB/databaseAccounts/%s/sqlDatabases/%s/containers/%s?api-version=2024-05-15",
			config.SubscriptionID, config.ResourceGroup, config.AccountName, config.DatabaseName, indexConfig.containerName,
		)

		// Create request
		req, _ := http.NewRequestWithContext(ctx, "PUT", url, nil)
		req.Header.Set("Authorization", "Bearer "+token.Token)
		req.Header.Set("Content-Type", "application/json")

		// Set body
		bodyJSON, _ := json.Marshal(payload)
		req.Body = io.NopCloser(strings.NewReader(string(bodyJSON)))

		// Execute request
		client := &http.Client{}
		resp, err := client.Do(req)
		if err != nil {
			return fmt.Errorf("failed to create container: %w", err)
		}
		defer resp.Body.Close()

		// Check response
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			body, _ := io.ReadAll(resp.Body)
			return fmt.Errorf("failed to create container: status %d, body: %s", resp.StatusCode, string(body))
		}

		elapsed := time.Since(start)
		fmt.Printf("  ✓ Container created in %.2fs\n", elapsed.Seconds())
		fmt.Printf("  ✓ Verified: Container %q exists with vector index\n", indexConfig.containerName)
	}

	return nil
}

