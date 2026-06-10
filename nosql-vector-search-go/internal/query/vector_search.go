package query

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strings"

	"github.com/Azure/azure-sdk-for-go/sdk/ai/azopenai"
	"github.com/Azure/azure-sdk-for-go/sdk/data/azcosmos"
)

// Valid distance functions for Cosmos DB NoSQL
var ValidDistanceFunctions = []string{"cosine", "euclidean", "dotproduct"}

// QueryResult represents a single vector-search result row.
type QueryResult struct {
	HotelName       string  `json:"HotelName"`
	Description     string  `json:"Description"`
	Rating          float64 `json:"Rating"`
	SimilarityScore float64 `json:"SimilarityScore"`
}

// MetricComparisonResult holds scores from all 3 distance metrics.
type MetricComparisonResult struct {
	HotelName   string                 `json:"HotelName"`
	Description string                 `json:"Description"`
	Rating      float64                `json:"Rating"`
	Scores      map[string]interface{} `json:"Scores"`
}

// NOTE: The Go azcosmos SDK has limited cross-partition query support.
// TOP and ORDER BY clauses are not supported in cross-partition queries.
// See: https://pkg.go.dev/github.com/Azure/azure-sdk-for-go/sdk/data/azcosmos#ContainerClient.NewQueryItemsPager
// To enable all query patterns (including VectorDistance with TOP/ORDER BY),
// this sample uses a single partition key value so all documents reside
// in the same logical partition. This restriction is temporary and will be
// revisited when the Go SDK adds full cross-partition query support.
const partitionKeyValue = "hotels"

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
// Cosmos DB container with the specified distance function.
// Returns the result rows and the total request charge.
func ExecuteVectorSearch(
	ctx context.Context,
	container *azcosmos.ContainerClient,
	embedding []float32,
	embeddedField string,
	distanceFunction string,
) ([]QueryResult, float64, error) {
	if err := ValidateFieldName(embeddedField); err != nil {
		return nil, 0, err
	}

	// Validate distance function
	validFunc := false
	for _, fn := range ValidDistanceFunctions {
		if strings.EqualFold(distanceFunction, fn) {
			validFunc = true
			distanceFunction = fn
			break
		}
	}
	if !validFunc {
		return nil, 0, fmt.Errorf("invalid distance function: %s. Must be one of: %v", distanceFunction, ValidDistanceFunctions)
	}

	// Build the SQL query with VectorDistance.
	// TOP + ORDER BY works here because all docs share a single partition key.
	queryText := fmt.Sprintf(
		"SELECT TOP 5 c.HotelName, c.Description, c.Rating, "+
			"VectorDistance(c.%s, @embedding, \"%s\") AS SimilarityScore "+
			"FROM c "+
			"ORDER BY VectorDistance(c.%s, @embedding, \"%s\")",
		embeddedField, distanceFunction, embeddedField, distanceFunction,
	)

	// Serialize the embedding to a JSON array for the parameter value.
	embeddingJSON, err := json.Marshal(embedding)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to marshal embedding: %w", err)
	}

	params := azcosmos.QueryOptions{
		QueryParameters: []azcosmos.QueryParameter{
			{Name: "@embedding", Value: json.RawMessage(embeddingJSON)},
		},
	}

	fmt.Println("\n--- Executing Vector Search Query ---")
	fmt.Println("Query:", queryText)
	fmt.Printf("Parameters: @embedding (vector with %d dimensions)\n", len(embedding))
	fmt.Println("--------------------------------------")

	pk := azcosmos.NewPartitionKey().AppendString(partitionKeyValue)
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

	return results, totalCharge, nil
}

// ExecuteMetricComparison runs all 3 distance functions and returns side-by-side results.
func ExecuteMetricComparison(
	ctx context.Context,
	container *azcosmos.ContainerClient,
	embedding []float32,
	embeddedField string,
) ([]MetricComparisonResult, map[string]float64, error) {
	if err := ValidateFieldName(embeddedField); err != nil {
		return nil, nil, err
	}

	embeddingJSON, err := json.Marshal(embedding)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to marshal embedding: %w", err)
	}

	// Store results by hotel name for aggregation
	resultMap := make(map[string]MetricComparisonResult)
	charges := make(map[string]float64)

	// Execute query for each distance function
	for _, distFunc := range ValidDistanceFunctions {
		queryText := fmt.Sprintf(
			"SELECT TOP 5 c.HotelName, c.Description, c.Rating, "+
				"VectorDistance(c.%s, @embedding, \"%s\") AS Score "+
				"FROM c "+
				"ORDER BY VectorDistance(c.%s, @embedding, \"%s\")",
			embeddedField, distFunc, embeddedField, distFunc,
		)

		params := azcosmos.QueryOptions{
			QueryParameters: []azcosmos.QueryParameter{
				{Name: "@embedding", Value: json.RawMessage(embeddingJSON)},
			},
		}

		pk := azcosmos.NewPartitionKey().AppendString(partitionKeyValue)
		pager := container.NewQueryItemsPager(queryText, pk, &params)

		for pager.More() {
			resp, err := pager.NextPage(ctx)
			if err != nil {
				return nil, charges, fmt.Errorf("comparison query failed for %s: %w", distFunc, err)
			}

			charges[distFunc] += float64(resp.RequestCharge)

			for _, raw := range resp.Items {
				var row struct {
					HotelName   string  `json:"HotelName"`
					Description string  `json:"Description"`
					Rating      float64 `json:"Rating"`
					Score       float64 `json:"Score"`
				}

				if err := json.Unmarshal(raw, &row); err != nil {
					continue
				}

				if result, exists := resultMap[row.HotelName]; exists {
					result.Scores[distFunc] = row.Score
					resultMap[row.HotelName] = result
				} else {
					resultMap[row.HotelName] = MetricComparisonResult{
						HotelName:   row.HotelName,
						Description: row.Description,
						Rating:      row.Rating,
						Scores: map[string]interface{}{
							distFunc: row.Score,
						},
					}
				}
			}
		}
	}

	// Convert map to slice, maintaining order
	var results []MetricComparisonResult
	for _, result := range resultMap {
		results = append(results, result)
	}

	return results, charges, nil
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

// PrintMetricComparison outputs comparison results in a human-readable table format.
func PrintMetricComparison(results []MetricComparisonResult, charges map[string]float64) {
	fmt.Println("\n--- Metric Comparison Results ---")
	if len(results) == 0 {
		fmt.Println("No results found.")
		return
	}

	fmt.Println("\nHotels ranked by each distance metric:")
	for i, r := range results {
		fmt.Printf("\n%d. %s\n", i+1, r.HotelName)
		if len(r.Scores) > 0 {
			for _, metric := range ValidDistanceFunctions {
				if score, ok := r.Scores[metric]; ok {
					fmt.Printf("   %s: %.4f\n", metric, score)
				}
			}
		}
	}

	fmt.Println("\n--- Request Charges per Metric ---")
	for _, metric := range ValidDistanceFunctions {
		if charge, ok := charges[metric]; ok {
			fmt.Printf("%s: %.2f RUs\n", metric, charge)
		}
	}
	fmt.Println()
}
