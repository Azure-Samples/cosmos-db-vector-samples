package query

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"

	"github.com/Azure/azure-sdk-for-go/sdk/ai/azopenai"
	"github.com/Azure/azure-sdk-for-go/sdk/data/azcosmos"
)

// QueryResult represents a single vector-search result row.
type QueryResult struct {
	HotelName       string  `json:"HotelName"`
	Description     string  `json:"Description"`
	Rating          float64 `json:"Rating"`
	SimilarityScore float64 `json:"SimilarityScore"`
}

// validIdentifier matches safe SQL identifiers (letters, digits, underscores).
var validIdentifier = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// ValidateFieldName ensures a field name is a safe SQL identifier to prevent
// injection when the name is interpolated into a query string.
func ValidateFieldName(fieldName string) error {
	if !validIdentifier.MatchString(fieldName) {
		return fmt.Errorf(
			"invalid field name: %q — must start with a letter or underscore and contain only letters, numbers, and underscores",
			fieldName,
		)
	}
	return nil
}

// GenerateEmbedding calls Azure OpenAI to produce an embedding vector for the
// given text, returning a []float32 suitable for VectorDistance queries.
func GenerateEmbedding(ctx context.Context, client *azopenai.Client, text, deployment string) ([]float32, error) {
	resp, err := client.GetEmbeddings(ctx, azopenai.EmbeddingsOptions{
		Input:          []string{text},
		DeploymentName: &deployment,
	}, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to generate embedding: %w", err)
	}

	if len(resp.Data) == 0 {
		return nil, fmt.Errorf("no embedding data returned")
	}

	return resp.Data[0].Embedding, nil
}

// ExecuteVectorSearch builds and runs a VectorDistance SQL query against the
// Cosmos DB container. Returns the result rows and the total request charge.
func ExecuteVectorSearch(
	ctx context.Context,
	container *azcosmos.ContainerClient,
	embedding []float32,
	embeddedField string,
) ([]QueryResult, float64, error) {
	if err := ValidateFieldName(embeddedField); err != nil {
		return nil, 0, err
	}

	// Build the SQL query with VectorDistance.
	// Uses TOP without ORDER BY for cross-partition compatibility with the Go SDK.
	// VectorDistance results are sorted client-side.
	queryText := fmt.Sprintf(
		"SELECT TOP 5 c.HotelName, c.Description, c.Rating, "+
			"VectorDistance(c.%s, @embedding) AS SimilarityScore "+
			"FROM c",
		embeddedField,
	)

	// Serialize the embedding to a JSON array for the parameter value.
	embeddingJSON, err := json.Marshal(embedding)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to marshal embedding: %w", err)
	}

	crossPartition := true
	params := azcosmos.QueryOptions{
		QueryParameters: []azcosmos.QueryParameter{
			{Name: "@embedding", Value: json.RawMessage(embeddingJSON)},
		},
		EnableCrossPartitionQuery: &crossPartition,
	}

	fmt.Println("\n--- Executing Vector Search Query ---")
	fmt.Println("Query:", queryText)
	fmt.Printf("Parameters: @embedding (vector with %d dimensions)\n", len(embedding))
	fmt.Println("--------------------------------------")

	pk := azcosmos.NewPartitionKey()
	pager := container.NewQueryItemsPager(queryText, pk, &params)

	var results []QueryResult
	var totalCharge float64

	for pager.More() {
		resp, err := pager.NextPage(ctx)
		if err != nil {
			return nil, totalCharge, fmt.Errorf("query failed: %w", err)
		}

		totalCharge += float64(resp.RequestCharge)

		if resp.ActivityID != "" {
			fmt.Println("Query activity ID:", resp.ActivityID)
		}

		for _, raw := range resp.Items {
			var r QueryResult
			if err := json.Unmarshal(raw, &r); err != nil {
				fmt.Printf("Warning: could not unmarshal result: %v\n", err)
				continue
			}
			results = append(results, r)
		}
	}

	// Sort by similarity score (lower distance = more similar for cosine).
	sort.Slice(results, func(i, j int) bool {
		return results[i].SimilarityScore < results[j].SimilarityScore
	})
	if len(results) > 5 {
		results = results[:5]
	}

	return results, totalCharge, nil
}

// PrintSearchResults outputs the results to stdout in a human-readable format.
func PrintSearchResults(results []QueryResult, requestCharge float64) {
	fmt.Println("\n--- Search Results ---")
	if len(results) == 0 {
		fmt.Println("No results found.")
		return
	}

	for i, r := range results {
		fmt.Printf("%d. %s, Score: %.4f\n", i+1, r.HotelName, r.SimilarityScore)
	}

	fmt.Printf("\nVector Search Request Charge: %.2f RUs\n\n", requestCharge)
}
