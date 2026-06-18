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
	"strings"
	"sync"
	"time"

	"github.com/Azure/azure-sdk-for-go/sdk/azcore"
	"github.com/Azure/azure-sdk-for-go/sdk/azcore/policy"
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

	prepared := make([]map[string]any, 0, len(documents))
	for _, doc := range documents {
		hotelID, _ := doc["HotelId"].(string)
		if strings.TrimSpace(hotelID) == "" {
			return nil, errors.New("every document must include a non-empty HotelId")
		}
		preparedDoc := cloneDocument(doc)
		preparedDoc["id"] = hotelID
		preparedDoc[partitionKeyFieldName] = partitionKeyFieldValue
		prepared = append(prepared, preparedDoc)
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
	partitionKey := azcosmos.NewPartitionKey().AppendString(partitionKeyFieldValue)
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

func QueryTopHotels(ctx context.Context, container *azcosmos.ContainerClient, embedding []float32, embeddingField, metric string) ([]VectorSearchResult, float64, error) {
	if !validIdentifier.MatchString(embeddingField) {
		return nil, 0, fmt.Errorf("invalid embedding field name: %q", embeddingField)
	}

	embeddingJSON, err := json.Marshal(embedding)
	if err != nil {
		return nil, 0, fmt.Errorf("marshal embedding parameter: %w", err)
	}

	queryText := fmt.Sprintf(`SELECT TOP 5
		c.HotelId,
		c.HotelName,
		c.Description,
		VectorDistance(c.%s, @embedding, false) AS score
	FROM c
	ORDER BY VectorDistance(c.%s, @embedding, false)`, embeddingField, embeddingField)

	options := azcosmos.QueryOptions{
		QueryParameters: []azcosmos.QueryParameter{{
			Name:  "@embedding",
			Value: json.RawMessage(embeddingJSON),
		}},
	}

	partitionKey := azcosmos.NewPartitionKey().AppendString(partitionKeyFieldValue)
	pager := container.NewQueryItemsPager(queryText, partitionKey, &options)

	results := make([]VectorSearchResult, 0, 5)
	var requestCharge float64
	for pager.More() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return nil, requestCharge, fmt.Errorf("query vector results: %w", err)
		}
		requestCharge += float64(page.RequestCharge)
		for _, item := range page.Items {
			var result VectorSearchResult
			if err := json.Unmarshal(item, &result); err != nil {
				return nil, requestCharge, fmt.Errorf("parse vector search result: %w", err)
			}
			results = append(results, result)
		}
	}

	return results, requestCharge, nil
}

func RunContainerScenario(ctx context.Context, container *azcosmos.ContainerClient, containerName string, documents []map[string]any, embedding []float32, embeddingField string) (*ContainerRunResult, error) {
	insertStats, err := InsertDocuments(ctx, container, documents)
	if err != nil {
		return nil, err
	}

	results, requestCharge, err := QueryTopHotels(ctx, container, embedding, embeddingField, "cosine")
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
