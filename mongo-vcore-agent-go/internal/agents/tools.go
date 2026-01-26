package agents

import (
	"context"
	"fmt"
	"strings"

	"github.com/Azure-Samples/cosmos-db-vector-samples/mongo-vcore-agent-go/internal/clients"
	"github.com/Azure-Samples/cosmos-db-vector-samples/mongo-vcore-agent-go/internal/prompts"
	"github.com/Azure-Samples/cosmos-db-vector-samples/mongo-vcore-agent-go/internal/vectorstore"
	"github.com/openai/openai-go/v3"
)

// VectorSearchTool implements the hotel search functionality
type VectorSearchTool struct {
	openAIClients *clients.OpenAIClients
	vectorStore   *vectorstore.VectorStore
	debug         bool
}

// NewVectorSearchTool creates a new vector search tool
func NewVectorSearchTool(openaiClients *clients.OpenAIClients, vectorStore *vectorstore.VectorStore, debug bool) *VectorSearchTool {
	return &VectorSearchTool{
		openAIClients: openaiClients,
		vectorStore:   vectorStore,
		debug:         debug,
	}
}

// Execute performs the vector search
func (t *VectorSearchTool) Execute(ctx context.Context, query string, nearestNeighbors int) (string, error) {
	// Generate embedding for query
	queryVector, err := t.openAIClients.GenerateEmbedding(ctx, query)
	if err != nil {
		return "", fmt.Errorf("failed to generate embedding: %w", err)
	}

	// Perform vector search
	results, err := t.vectorStore.VectorSearch(ctx, queryVector, nearestNeighbors)
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
	paramSchema := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"query": map[string]any{
				"type":        "string",
				"description": "Natural language search query describing desired hotel characteristics",
			},
			"nearestNeighbors": map[string]any{
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

// toolArguments represents the arguments for the search tool
type toolArguments struct {
	Query            string `json:"query"`
	NearestNeighbors int    `json:"nearestNeighbors"`
}

// parseToolArgumentsFromMap parses tool arguments from a map
func parseToolArgumentsFromMap(argsMap map[string]any) (*toolArguments, error) {
	args := &toolArguments{}

	if query, ok := argsMap["query"].(string); ok {
		args.Query = query
	} else {
		return nil, fmt.Errorf("query argument missing or invalid")
	}

	if nn, ok := argsMap["nearestNeighbors"].(float64); ok {
		args.NearestNeighbors = int(nn)
	}

	return args, nil
}
