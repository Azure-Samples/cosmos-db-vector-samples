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
	openAIClients *clients.OpenAIClients
	searchTool    *VectorSearchTool
	debug         bool
}

// NewPlannerAgent creates a new planner agent
func NewPlannerAgent(openaiClients *clients.OpenAIClients, searchTool *VectorSearchTool, debug bool) *PlannerAgent {
	return &PlannerAgent{
		openAIClients: openaiClients,
		searchTool:    searchTool,
		debug:         debug,
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
	toolDef := a.searchTool.GetToolDefinition()

	// Call planner with tool definitions
	resp, err := a.openAIClients.ChatCompletionWithTools(ctx, prompts.PlannerSystemPrompt, userMessage, []openai.ChatCompletionToolUnionParam{toolDef})
	if err != nil {
		return "", fmt.Errorf("planner failed: %w", err)
	}

	// Extract tool call
	toolName, argsMap, err := clients.ExtractToolCall(resp)
	if err != nil {
		return "", fmt.Errorf("failed to extract tool call: %w", err)
	}

	if toolName != prompts.ToolName {
		return "", fmt.Errorf("unexpected tool called: %s", toolName)
	}

	// Parse arguments using typed struct
	args, err := parseToolArgumentsFromMap(argsMap)
	if err != nil {
		return "", fmt.Errorf("failed to parse tool arguments: %w", err)
	}

	// Use default if nearestNeighbors not provided
	if args.NearestNeighbors == 0 {
		args.NearestNeighbors = nearestNeighbors
	}

	fmt.Printf("Tool: %s\n", toolName)
	fmt.Printf("Query: %s\n", args.Query)
	fmt.Printf("K: %d\n", args.NearestNeighbors)

	// Execute the tool
	searchResults, err := a.searchTool.Execute(ctx, args.Query, args.NearestNeighbors)
	if err != nil {
		return "", fmt.Errorf("search tool execution failed: %w", err)
	}

	return searchResults, nil
}

// SynthesizerAgent generates final recommendations
type SynthesizerAgent struct {
	openAIClients *clients.OpenAIClients
	debug         bool
}

// NewSynthesizerAgent creates a new synthesizer agent
func NewSynthesizerAgent(openaiClients *clients.OpenAIClients, debug bool) *SynthesizerAgent {
	return &SynthesizerAgent{
		openAIClients: openaiClients,
		debug:         debug,
	}
}

// Run executes the synthesizer agent workflow
func (a *SynthesizerAgent) Run(ctx context.Context, userQuery, hotelContext string) (string, error) {
	fmt.Println("\n--- SYNTHESIZER ---")
	fmt.Printf("Context size: %d characters\n", len(hotelContext))

	userMessage := prompts.CreateSynthesizerUserPrompt(userQuery, hotelContext)

	// Call synthesizer (no tools)
	finalAnswer, err := a.openAIClients.ChatCompletion(ctx, prompts.SynthesizerSystemPrompt, userMessage)
	if err != nil {
		return "", fmt.Errorf("synthesizer failed: %w", err)
	}

	return finalAnswer, nil
}
