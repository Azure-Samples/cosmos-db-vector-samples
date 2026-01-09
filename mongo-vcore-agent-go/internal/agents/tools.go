package agents

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/Azure-Samples/cosmos-db-vector-samples/mongo-vcore-agent-go/internal/clients"
	"github.com/Azure-Samples/cosmos-db-vector-samples/mongo-vcore-agent-go/internal/prompts"
	"github.com/Azure-Samples/cosmos-db-vector-samples/mongo-vcore-agent-go/internal/vectorstore"
	"github.com/openai/openai-go/v3"
)

// VectorSearchTool implements the hotel search functionality
type VectorSearchTool struct {
	OpenAIClients *clients.OpenAIClients
	VectorStore   *vectorstore.VectorStore
	Debug         bool
}

// NewVectorSearchTool creates a new vector search tool
func NewVectorSearchTool(openaiClients *clients.OpenAIClients, vectorStore *vectorstore.VectorStore, debug bool) *VectorSearchTool {
	return &VectorSearchTool{
		OpenAIClients: openaiClients,
		VectorStore:   vectorStore,
		Debug:         debug,
	}
}

// Execute performs the vector search
func (t *VectorSearchTool) Execute(ctx context.Context, query string, nearestNeighbors int) (string, error) {
	// Generate embedding for query
	queryVector, err := t.OpenAIClients.GenerateEmbedding(ctx, query)
	if err != nil {
		return "", fmt.Errorf("failed to generate embedding: %w", err)
	}

	// Perform vector search
	results, err := t.VectorStore.VectorSearch(ctx, queryVector, nearestNeighbors)
	if err != nil {
		return "", fmt.Errorf("vector search failed: %w", err)
	}

	// Format results for synthesizer
	var formattedResults []string
	for i, result := range results {
		fmt.Printf("Hotel #%d: %s, Score: %.6f\n", i+1, result.Hotel.HotelName, result.Score)
		formattedResults = append(formattedResults, vectorstore.FormatHotelForSynthesizer(result))
	}

	return strings.Join(formattedResults, "\n\n"), nil
}

// GetToolDefinition returns the Azure OpenAI tool definition
func (t *VectorSearchTool) GetToolDefinition() openai.ChatCompletionToolUnionParam {
	paramSchema := map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"query": map[string]interface{}{
				"type":        "string",
				"description": "Natural language search query describing desired hotel characteristics",
			},
			"nearestNeighbors": map[string]interface{}{
				"type":        "integer",
				"description": "Number of results to return (1-20)",
				"default":     5,
			},
		},
		"required": []string{"query", "nearestNeighbors"},
	}

	return openai.ChatCompletionToolUnionParam{
		OfFunction: &openai.ChatCompletionFunctionToolParam{
			Function: openai.FunctionDefinitionParam{
				Name:        prompts.ToolName,
				Description: openai.String(prompts.ToolDescription),
				Parameters:  paramSchema,
			},
		},
	}
}

// ToolArguments represents the arguments for the search tool
type ToolArguments struct {
	Query            string `json:"query"`
	NearestNeighbors int    `json:"nearestNeighbors"`
}

// ParseToolArguments parses tool arguments from JSON
func ParseToolArguments(argsJSON string) (*ToolArguments, error) {
	var args ToolArguments
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return nil, fmt.Errorf("failed to parse tool arguments: %w", err)
	}
	return &args, nil
}
