package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/Azure/azure-sdk-for-go/sdk/azcore"
	"github.com/Azure/azure-sdk-for-go/sdk/azcore/policy"
	"github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/cosmos/armcosmos"
	"github.com/Azure/azure-sdk-for-go/sdk/data/azcosmos"
)

const maxInsertConcurrency = 5

var validIdentifier = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

type InsertStats struct {
	Total         int
	Inserted      int
	Skipped       int
	Failed        int
	RequestCharge float64
}

type VectorSearchResult struct {
	HotelID     string  `json:"HotelId"`
	HotelName   string  `json:"HotelName"`
	Description string  `json:"Description"`
	Score       float64 `json:"score"`
}

type ContainerRunResult struct {
	ContainerName string
	InsertStats   InsertStats
	Results       []VectorSearchResult
	RequestCharge float64
}

type embeddingsRequest struct {
	Input string `json:"input"`
}

type embeddingsResponse struct {
	Data []struct {
		Embedding []float64 `json:"embedding"`
	} `json:"data"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func LoadDocuments(path string) ([]map[string]any, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read data file: %w", err)
	}

	var documents []map[string]any
	if err := json.Unmarshal(raw, &documents); err != nil {
		return nil, fmt.Errorf("parse data file: %w", err)
	}

	// Validate Region property and prepare documents
	validRegions := map[string]bool{"Northeast": true, "Midwest": true, "South": true, "West": true}
	regionsFound := make(map[string]bool)

	prepared := make([]map[string]any, 0, len(documents))
	for idx, doc := range documents {
		hotelID, _ := doc["HotelId"].(string)
		if strings.TrimSpace(hotelID) == "" {
			return nil, errors.New("every document must include a non-empty HotelId")
		}

		// Validate Region property
		region, ok := doc["Region"].(string)
		if !ok || strings.TrimSpace(region) == "" {
			return nil, fmt.Errorf("document at index %d (HotelId=%s) missing or invalid Region property", idx, hotelID)
		}
		if !validRegions[region] {
			return nil, fmt.Errorf("document at index %d (HotelId=%s) has unexpected Region '%s'", idx, hotelID, region)
		}
		regionsFound[region] = true

		preparedDoc := cloneDocument(doc)
		preparedDoc["id"] = hotelID
		// Do NOT overwrite Region — keep it as-is for partition key
		prepared = append(prepared, preparedDoc)
	}

	// Log region distribution
	regions := make([]string, 0, len(regionsFound))
	for r := range regionsFound {
		regions = append(regions, r)
	}
	sort.Strings(regions)
	fmt.Printf("✓ Region validation passed. Found regions: %s\n", strings.Join(regions, ", "))

	// Count documents per region
	regionCounts := make(map[string]int)
	for _, doc := range prepared {
		region := doc["Region"].(string)
		regionCounts[region]++
	}
	// Print per-region counts in order
	for _, region := range []string{"Northeast", "Midwest", "South", "West"} {
		if count, exists := regionCounts[region]; exists {
			fmt.Printf("  Region '%s': %d documents\n", region, count)
		}
	}

	return prepared, nil
}

func cloneDocument(source map[string]any) map[string]any {
	clone := make(map[string]any, len(source)+2)
	for key, value := range source {
		clone[key] = value
	}
	return clone
}

func GenerateEmbedding(ctx context.Context, httpClient *http.Client, credential azcore.TokenCredential, cfg *Config, text string) ([]float32, error) {
	token, err := credential.GetToken(ctx, policy.TokenRequestOptions{Scopes: []string{"https://cognitiveservices.azure.com/.default"}})
	if err != nil {
		return nil, fmt.Errorf("get Azure OpenAI bearer token: %w", err)
	}

	requestBody, err := json.Marshal(embeddingsRequest{Input: text})
	if err != nil {
		return nil, fmt.Errorf("marshal embeddings request: %w", err)
	}

	endpoint, err := url.Parse(strings.TrimRight(cfg.OpenAIEmbeddingEndpoint, "/"))
	if err != nil {
		return nil, fmt.Errorf("parse AZURE_OPENAI_EMBEDDING_ENDPOINT: %w", err)
	}
	endpoint.Path = fmt.Sprintf("/openai/deployments/%s/embeddings", cfg.OpenAIEmbeddingDeployment)
	query := endpoint.Query()
	query.Set("api-version", cfg.OpenAIAPIVersion)
	endpoint.RawQuery = query.Encode()

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(requestBody))
	if err != nil {
		return nil, fmt.Errorf("create embeddings request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+token.Token)
	request.Header.Set("Content-Type", "application/json")

	response, err := httpClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("call Azure OpenAI embeddings API: %w", err)
	}
	defer response.Body.Close()

	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, fmt.Errorf("read embeddings response: %w", err)
	}

	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("Azure OpenAI embeddings request failed: status=%d body=%s", response.StatusCode, strings.TrimSpace(string(responseBody)))
	}

	var payload embeddingsResponse
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		return nil, fmt.Errorf("parse embeddings response: %w", err)
	}
	if payload.Error != nil {
		return nil, fmt.Errorf("Azure OpenAI embeddings error: %s", payload.Error.Message)
	}
	if len(payload.Data) == 0 {
		return nil, errors.New("Azure OpenAI embeddings response did not include any vectors")
	}

	embedding := make([]float32, len(payload.Data[0].Embedding))
	for index, value := range payload.Data[0].Embedding {
		embedding[index] = float32(value)
	}
	if len(embedding) != cfg.EmbeddingDimensions {
		return nil, fmt.Errorf("embedding dimensions mismatch: got %d, expected %d", len(embedding), cfg.EmbeddingDimensions)
	}

	return embedding, nil
}

func InsertDocuments(ctx context.Context, container *azcosmos.ContainerClient, documents []map[string]any) (InsertStats, error) {
	stats := InsertStats{Total: len(documents)}
	semaphore := make(chan struct{}, maxInsertConcurrency)
	var mu sync.Mutex
	var wg sync.WaitGroup

	for _, document := range documents {
		document := document
		wg.Add(1)
		go func() {
			defer wg.Done()
			semaphore <- struct{}{}
			defer func() { <-semaphore }()

			// Extract Region from document for partition key
			region, ok := document["Region"].(string)
			if !ok {
				mu.Lock()
				stats.Failed++
				mu.Unlock()
				return
			}
			partitionKey := azcosmos.NewPartitionKey().AppendString(region)

			body, err := json.Marshal(document)
			if err != nil {
				mu.Lock()
				stats.Failed++
				mu.Unlock()
				return
			}

			// Retry with backoff on 429 (rate limiting)
			maxRetries := 5
			for attempt := 0; attempt <= maxRetries; attempt++ {
				response, err := container.CreateItem(ctx, partitionKey, body, nil)
				if err != nil {
					var responseError *azcore.ResponseError
					if errors.As(err, &responseError) {
						if responseError.StatusCode == http.StatusConflict {
							mu.Lock()
							stats.Skipped++
							mu.Unlock()
							return
						}
						if responseError.StatusCode == http.StatusTooManyRequests && attempt < maxRetries {
							wait := time.Duration(attempt+1) * time.Second
							time.Sleep(wait)
							continue
						}
					}
					mu.Lock()
					stats.Failed++
					mu.Unlock()
					return
				}

				mu.Lock()
				stats.Inserted++
				stats.RequestCharge += float64(response.RequestCharge)
				mu.Unlock()
				return
			}
		}()
	}

	wg.Wait()
	if stats.Failed > 0 {
		return stats, fmt.Errorf("failed to insert %d documents", stats.Failed)
	}

	return stats, nil
}

func QueryTopHotels(ctx context.Context, container *azcosmos.ContainerClient, embedding []float32, embeddingField, distanceFunction, partitionKeyValue string) ([]VectorSearchResult, float64, error) {
	if !validIdentifier.MatchString(embeddingField) {
		return nil, 0, fmt.Errorf("invalid embedding field name: %q", embeddingField)
	}

	embeddingJSON, err := json.Marshal(embedding)
	if err != nil {
		return nil, 0, fmt.Errorf("marshal embedding parameter: %w", err)
	}

	// Query text with WHERE clause for single-partition efficiency
	// The WHERE clause + SDK partition key routing (belt-and-suspenders) ensures:
	// 1. Query only searches documents in the specified region
	// 2. Lower RU consumption (single partition vs cross-partition)
	// 3. Faster query execution
	queryText := fmt.Sprintf(`SELECT TOP 5
		c.HotelId,
		c.HotelName,
		c.Description,
		VectorDistance(c.%s, @embedding, false, {'distanceFunction': '%s'}) AS SimilarityScore
	FROM c
	WHERE c.Region = @partitionKey`, embeddingField, distanceFunction)

	options := azcosmos.QueryOptions{
		QueryParameters: []azcosmos.QueryParameter{
			{
				Name:  "@embedding",
				Value: json.RawMessage(embeddingJSON),
			},
			{
				Name:  "@partitionKey",
				Value: partitionKeyValue,
			},
		},
	}

	// SDK-level partition key routing (belt-and-suspenders with WHERE clause)
	partitionKey := azcosmos.NewPartitionKey().AppendString(partitionKeyValue)
	pager := container.NewQueryItemsPager(queryText, partitionKey, &options)

	var results []VectorSearchResult
	var totalRequestCharge float64

	for pager.More() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return nil, totalRequestCharge, fmt.Errorf("query page: %w", err)
		}
		totalRequestCharge += float64(page.RequestCharge)
		for _, item := range page.Items {
			var result VectorSearchResult
			if err := json.Unmarshal(item, &result); err != nil {
				return nil, totalRequestCharge, fmt.Errorf("parse vector search result: %w", err)
			}
			results = append(results, result)
		}
	}

	return results, totalRequestCharge, nil
}

func RunContainerScenario(ctx context.Context, container *azcosmos.ContainerClient, containerName string, documents []map[string]any, embedding []float32, embeddingField, partitionKeyValue string) (*ContainerRunResult, error) {
	insertStats, err := InsertDocuments(ctx, container, documents)
	if err != nil {
		return nil, err
	}

	results, requestCharge, err := QueryTopHotels(ctx, container, embedding, embeddingField, "Cosine", partitionKeyValue)
	if err != nil {
		return nil, err
	}

	return &ContainerRunResult{
		ContainerName: containerName,
		InsertStats:   insertStats,
		Results:       results,
		RequestCharge: requestCharge,
	}, nil
}

func PrintContainerRunResult(result *ContainerRunResult) {
	fmt.Printf("\n=== %s ===\n", result.ContainerName)
	fmt.Printf("inserted=%d skipped=%d failed=%d total=%d writeRU=%.2f\n", result.InsertStats.Inserted, result.InsertStats.Skipped, result.InsertStats.Failed, result.InsertStats.Total, result.InsertStats.RequestCharge)
	for index, item := range result.Results {
		fmt.Printf("%d. HotelId=%s | HotelName=%s | score=%.4f | Description=%s\n", index+1, item.HotelID, item.HotelName, item.Score, summarizeDescription(item.Description))
	}
	fmt.Printf("queryRU=%.2f\n", result.RequestCharge)
}

func summarizeDescription(value string) string {
	trimmed := strings.Join(strings.Fields(value), " ")
	if len(trimmed) <= 88 {
		return trimmed
	}
	return trimmed[:85] + "..."
}

func algorithmLabel(containerName string) string {
	switch {
	case strings.Contains(containerName, "diskann"):
		return "DiskANN"
	case strings.Contains(containerName, "quantizedflat"):
		return "QuantizedFlat"
	case strings.Contains(containerName, "flat"):
		return "Flat"
	default:
		return containerName
	}
}

func DeleteContainers(ctx context.Context, credential azcore.TokenCredential, cfg *Config) error {
	// Initialize Cosmos management client
	// Note: v1.0.0 uses a different API - direct client creation instead of factory pattern
	sqlResourcesClient, err := armcosmos.NewSQLResourcesClient(cfg.SubscriptionID, credential, nil)
	if err != nil {
		return fmt.Errorf("failed to create SQL resources client: %w", err)
	}

	for _, containerName := range []string{"hotels_diskann", "hotels_quantizedflat"} {
		// Delete container via ARM SDK
		poller, err := sqlResourcesClient.BeginDeleteSQLContainer(ctx, cfg.ResourceGroup, cfg.AccountName, cfg.DatabaseName, containerName, nil)
		if err != nil {
			// 404 is expected if container doesn't exist on first run — skip silently
			if strings.Contains(err.Error(), "404") {
				fmt.Printf("  ✓ Deleted %s (was already removed)\n", containerName)
				continue
			}
			return fmt.Errorf("failed to delete container %q: %w", containerName, err)
		}

		// Wait for operation to complete
		_, err = poller.PollUntilDone(ctx, nil)
		if err != nil {
			// 404 is still expected on retry/completion
			if strings.Contains(err.Error(), "404") {
				fmt.Printf("  ✓ Deleted %s (was already removed)\n", containerName)
				continue
			}
			return fmt.Errorf("failed to wait for container deletion %q: %w", containerName, err)
		}

		fmt.Printf("  ✓ Deleted %s\n", containerName)
	}

	return nil
}

func dashes(n int) string {
	return strings.Repeat("-", n)
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen-3] + "..."
}

func newHTTPClient() *http.Client {
	return &http.Client{Timeout: 60 * time.Second}
}

// ClearContainerData deletes all sample-inserted documents from a container
func ClearContainerData(ctx context.Context, container *azcosmos.ContainerClient) error {
	// Query across all regions to find all documents
	regions := []string{"Northeast", "Midwest", "South", "West"}
	
	for _, region := range regions {
		queryText := "SELECT c.id, c.Region FROM c WHERE c.Region = @region"
		options := azcosmos.QueryOptions{
			QueryParameters: []azcosmos.QueryParameter{
				{Name: "@region", Value: region},
			},
		}
		partitionKey := azcosmos.NewPartitionKey().AppendString(region)
		pager := container.NewQueryItemsPager(queryText, partitionKey, &options)

		for pager.More() {
			page, err := pager.NextPage(ctx)
			if err != nil {
				// Region may have no documents, continue
				break
			}
			for _, item := range page.Items {
				var doc map[string]any
				if err := json.Unmarshal(item, &doc); err != nil {
					return fmt.Errorf("parse item for deletion: %w", err)
				}
				if id, ok := doc["id"].(string); ok {
					_, err := container.DeleteItem(ctx, partitionKey, id, nil)
					if err != nil {
						return fmt.Errorf("delete item %q: %w", id, err)
					}
				}
			}
		}
	}

	return nil
}
