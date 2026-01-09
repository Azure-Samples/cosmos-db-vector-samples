package agents

import (
	"context"
	"fmt"

	"github.com/Azure-Samples/cosmos-db-vector-samples/mongo-vcore-agent-go/internal/clients"
	"github.com/Azure-Samples/cosmos-db-vector-samples/mongo-vcore-agent-go/internal/prompts"
	"github.com/openai/openai-go/v3"
)

// PlannerAgent orchestrates the tool calling
type PlannerAgent struct {
	OpenAIClients *clients.OpenAIClients
	SearchTool    *VectorSearchTool
	Debug         bool
}

// NewPlannerAgent creates a new planner agent
func NewPlannerAgent(openaiClients *clients.OpenAIClients, searchTool *VectorSearchTool, debug bool) *PlannerAgent {
	return &PlannerAgent{
		OpenAIClients: openaiClients,
		SearchTool:    searchTool,
		Debug:         debug,
	}
}

// Run executes the planner agent workflow
func (a *PlannerAgent) Run(ctx context.Context, userQuery string, nearestNeighbors int) (string, error) {
	fmt.Println("\n--- PLANNER ---")

	userMessage := fmt.Sprintf(
		`Search for hotels matching this request: "%s". Use nearestNeighbors=%d.`,
		userQuery,
		nearestNeighbors,
	)

	// Get tool definition
	toolDef := a.SearchTool.GetToolDefinition()

	// Call planner with tool definitions
	resp, err := a.OpenAIClients.ChatCompletionWithTools(ctx, prompts.PlannerSystemPrompt, userMessage, []openai.ChatCompletionToolUnionParam{toolDef})
	if err != nil {
		return "", fmt.Errorf("planner failed: %w", err)
	}

	// Extract tool call
	toolName, args, err := clients.ExtractToolCall(resp)
	if err != nil {
		return "", fmt.Errorf("failed to extract tool call: %w", err)
	}

	if toolName != prompts.ToolName {
		return "", fmt.Errorf("unexpected tool called: %s", toolName)
	}

	// Extract arguments
	query, ok := args["query"].(string)
	if !ok {
		return "", fmt.Errorf("query argument missing or invalid")
	}

	k := nearestNeighbors
	if kVal, ok := args["nearestNeighbors"].(float64); ok {
		k = int(kVal)
	}

	fmt.Printf("Tool: %s\n", toolName)
	fmt.Printf("Query: %s\n", query)
	fmt.Printf("K: %d\n", k)

	// Execute the tool
	searchResults, err := a.SearchTool.Execute(ctx, query, k)
	if err != nil {
		return "", fmt.Errorf("search tool execution failed: %w", err)
	}

	return searchResults, nil
}

// SynthesizerAgent generates final recommendations
type SynthesizerAgent struct {
	OpenAIClients *clients.OpenAIClients
	Debug         bool
}

// NewSynthesizerAgent creates a new synthesizer agent
func NewSynthesizerAgent(openaiClients *clients.OpenAIClients, debug bool) *SynthesizerAgent {
	return &SynthesizerAgent{
		OpenAIClients: openaiClients,
		Debug:         debug,
	}
}

// Run executes the synthesizer agent workflow
func (a *SynthesizerAgent) Run(ctx context.Context, userQuery, hotelContext string) (string, error) {
	fmt.Println("\n--- SYNTHESIZER ---")
	fmt.Printf("Context size: %d characters\n", len(hotelContext))

	userMessage := prompts.CreateSynthesizerUserPrompt(userQuery, hotelContext)

	// Call synthesizer (no tools)
	finalAnswer, err := a.OpenAIClients.ChatCompletion(ctx, prompts.SynthesizerSystemPrompt, userMessage)
	if err != nil {
		return "", fmt.Errorf("synthesizer failed: %w", err)
	}

	return finalAnswer, nil
}
