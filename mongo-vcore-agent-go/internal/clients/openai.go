package clients

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/Azure/azure-sdk-for-go/sdk/azidentity"
	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/azure"
	"github.com/openai/openai-go/v3/option"
)

// OpenAIConfig holds configuration for Azure OpenAI clients
type OpenAIConfig struct {
	InstanceName string
	APIKey       string

	EmbeddingDeployment string
	EmbeddingAPIVersion string

	PlannerDeployment string
	PlannerAPIVersion string

	SynthDeployment string
	SynthAPIVersion string

	UsePasswordless bool
	Debug           bool
}

// OpenAIClients holds all Azure OpenAI clients
type OpenAIClients struct {
	config *OpenAIConfig
	client *openai.Client
}

// LoadConfigFromEnv loads OpenAI configuration from environment variables
func LoadConfigFromEnv() *OpenAIConfig {
	debug := os.Getenv("DEBUG") == "true" || os.Getenv("DEBUG") == "1"
	usePasswordless := os.Getenv("USE_PASSWORDLESS") == "true" || os.Getenv("USE_PASSWORDLESS") == "1"

	return &OpenAIConfig{
		InstanceName:        os.Getenv("AZURE_OPENAI_API_INSTANCE_NAME"),
		APIKey:              os.Getenv("AZURE_OPENAI_API_KEY"),
		EmbeddingDeployment: os.Getenv("AZURE_OPENAI_EMBEDDING_DEPLOYMENT"),
		EmbeddingAPIVersion: os.Getenv("AZURE_OPENAI_EMBEDDING_API_VERSION"),
		PlannerDeployment:   os.Getenv("AZURE_OPENAI_PLANNER_DEPLOYMENT"),
		PlannerAPIVersion:   os.Getenv("AZURE_OPENAI_PLANNER_API_VERSION"),
		SynthDeployment:     os.Getenv("AZURE_OPENAI_SYNTH_DEPLOYMENT"),
		SynthAPIVersion:     os.Getenv("AZURE_OPENAI_SYNTH_API_VERSION"),
		UsePasswordless:     usePasswordless,
		Debug:               debug,
	}
}

// NewOpenAIClients creates all Azure OpenAI clients with passwordless authentication support
func NewOpenAIClients(config *OpenAIConfig) (*OpenAIClients, error) {
	if config.InstanceName == "" {
		return nil, fmt.Errorf("AZURE_OPENAI_API_INSTANCE_NAME is required")
	}

	endpoint := fmt.Sprintf("https://%s.openai.azure.com/", config.InstanceName)

	// Use the default API version if not specified
	apiVersion := config.EmbeddingAPIVersion
	if apiVersion == "" {
		apiVersion = "2024-06-01"
	}

	var client openai.Client

	// Determine authentication method based on USE_PASSWORDLESS flag or auto-detection
	usePasswordless := config.UsePasswordless || config.APIKey == ""

	if usePasswordless {
		// Use passwordless authentication with Azure Identity
		if config.Debug {
			fmt.Println("[clients] Using passwordless (Azure Identity) authentication")
		}
		credential, err := azidentity.NewDefaultAzureCredential(nil)
		if err != nil {
			return nil, fmt.Errorf("failed to create Azure credential: %w", err)
		}

		client = openai.NewClient(
			azure.WithEndpoint(endpoint, apiVersion),
			azure.WithTokenCredential(credential),
		)
	} else {
		// Use API key authentication
		if config.Debug {
			fmt.Println("[clients] Using API key authentication")
		}
		if config.APIKey == "" {
			return nil, fmt.Errorf("AZURE_OPENAI_API_KEY is required when USE_PASSWORDLESS is not enabled")
		}
		client = openai.NewClient(
			azure.WithEndpoint(endpoint, apiVersion),
			option.WithAPIKey(config.APIKey),
		)
	}

	if config.Debug {
		fmt.Printf("[clients] OpenAI client created for instance: %s\n", config.InstanceName)
		fmt.Printf("[clients] Embedding deployment: %s\n", config.EmbeddingDeployment)
		fmt.Printf("[clients] Planner deployment: %s\n", config.PlannerDeployment)
		fmt.Printf("[clients] Synthesizer deployment: %s\n", config.SynthDeployment)
	}

	return &OpenAIClients{
		config: config,
		client: &client,
	}, nil
}

// GenerateEmbedding generates an embedding for the given text
func (c *OpenAIClients) GenerateEmbedding(ctx context.Context, text string) ([]float32, error) {
	resp, err := c.client.Embeddings.New(ctx, openai.EmbeddingNewParams{
		Input: openai.EmbeddingNewParamsInputUnion{
			OfString: openai.String(text),
		},
		Model: openai.EmbeddingModel(c.config.EmbeddingDeployment),
	})

	if err != nil {
		return nil, fmt.Errorf("failed to generate embedding: %w", err)
	}

	if len(resp.Data) == 0 {
		return nil, fmt.Errorf("no embeddings returned")
	}

	// Convert []float64 to []float32
	float64Embedding := resp.Data[0].Embedding
	float32Embedding := make([]float32, len(float64Embedding))
	for i, v := range float64Embedding {
		float32Embedding[i] = float32(v)
	}

	return float32Embedding, nil
}

// ChatMessage represents a chat message
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
	Name    string `json:"name,omitempty"`
}

// ToolCall represents a tool call from the LLM
type ToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

// ChatCompletionWithTools calls the planner with tool definitions
func (c *OpenAIClients) ChatCompletionWithTools(ctx context.Context, systemPrompt, userMessage string, tools []openai.ChatCompletionToolUnionParam) (*openai.ChatCompletion, error) {
	if len(tools) == 0 {
		return nil, fmt.Errorf("no tools provided to ChatCompletionWithTools")
	}

	if c.config.Debug {
		fmt.Printf("[planner] Calling with temperature=0.0, tools enabled\n")
		fmt.Printf("[planner] System prompt length: %d characters\n", len(systemPrompt))
		fmt.Printf("[planner] User message length: %d characters\n", len(userMessage))
	}

	resp, err := c.client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model: openai.ChatModel(c.config.PlannerDeployment),
		Messages: []openai.ChatCompletionMessageParamUnion{
			{
				OfSystem: &openai.ChatCompletionSystemMessageParam{
					Content: openai.ChatCompletionSystemMessageParamContentUnion{
						OfString: openai.String(systemPrompt),
					},
				},
			},
			{
				OfUser: &openai.ChatCompletionUserMessageParam{
					Content: openai.ChatCompletionUserMessageParamContentUnion{
						OfString: openai.String(userMessage),
					},
				},
			},
		},
		Temperature: openai.Float(0.0),
		Tools:       tools,
		TopP:        openai.Float(1.0),
		MaxTokens:   openai.Int(1000),
	})

	if err != nil {
		return nil, fmt.Errorf("planner chat completion failed: %w", err)
	}

	if resp == nil {
		return nil, fmt.Errorf("planner returned nil response")
	}

	if c.config.Debug {
		fmt.Printf("[planner] Response received with %d choices\n", len(resp.Choices))
		if len(resp.Choices) > 0 {
			fmt.Printf("[planner] Finish reason: %s\n", resp.Choices[0].FinishReason)
			fmt.Printf("[planner] Tool calls count: %d\n", len(resp.Choices[0].Message.ToolCalls))
			if len(resp.Choices[0].Message.ToolCalls) == 0 && resp.Choices[0].Message.Content != "" {
				fmt.Printf("[planner] Model response (text): %s\n", resp.Choices[0].Message.Content)
			}
		}
	}

	return resp, nil
}

// ChatCompletion calls the synthesizer without tools
func (c *OpenAIClients) ChatCompletion(ctx context.Context, systemPrompt, userMessage string) (string, error) {
	resp, err := c.client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model: openai.ChatModel(c.config.SynthDeployment),
		Messages: []openai.ChatCompletionMessageParamUnion{
			{
				OfSystem: &openai.ChatCompletionSystemMessageParam{
					Content: openai.ChatCompletionSystemMessageParamContentUnion{
						OfString: openai.String(systemPrompt),
					},
				},
			},
			{
				OfUser: &openai.ChatCompletionUserMessageParam{
					Content: openai.ChatCompletionUserMessageParamContentUnion{
						OfString: openai.String(userMessage),
					},
				},
			},
		},
		Temperature: openai.Float(0.3),
	})

	if err != nil {
		return "", fmt.Errorf("synthesizer chat completion failed: %w", err)
	}

	if len(resp.Choices) == 0 {
		return "", fmt.Errorf("no completion choices returned")
	}

	content := resp.Choices[0].Message.Content

	if c.config.Debug {
		fmt.Printf("[synthesizer] Output: %d characters\n", len(content))
	}

	return content, nil
}

// extractToolCallRaw extracts the tool call from a chat completion response and returns raw JSON arguments
func extractToolCallRaw(resp *openai.ChatCompletion) (string, string, error) {
	if resp == nil {
		return "", "", fmt.Errorf("response is nil")
	}

	if len(resp.Choices) == 0 {
		return "", "", fmt.Errorf("no choices in response")
	}

	choice := resp.Choices[0]

	// Check finish reason to understand why the model stopped
	if choice.FinishReason == "length" {
		return "", "", fmt.Errorf("response was cut off (length limit exceeded)")
	}

	if choice.FinishReason != "tool_calls" && choice.FinishReason != "stop" {
		return "", "", fmt.Errorf("unexpected finish reason: %s (expected 'tool_calls' or 'stop')", choice.FinishReason)
	}

	if len(choice.Message.ToolCalls) == 0 {
		// Model decided not to call a tool - return the text content if available
		content := choice.Message.Content
		if content != "" {
			return "", "", fmt.Errorf("no tool calls in response - model returned: %s", content)
		}
		return "", "", fmt.Errorf("no tool calls in response and no text content - finish_reason: %s", choice.FinishReason)
	}

	toolCall := choice.Message.ToolCalls[0]

	if toolCall.Type != "function" {
		return "", "", fmt.Errorf("unexpected tool call type: %s (expected 'function')", toolCall.Type)
	}

	return toolCall.Function.Name, toolCall.Function.Arguments, nil
}

// ExtractToolCall extracts the tool call from a chat completion response
func ExtractToolCall(resp *openai.ChatCompletion) (string, map[string]any, error) {
	toolName, argsJSON, err := extractToolCallRaw(resp)
	if err != nil {
		return "", nil, err
	}

	var args map[string]any
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return "", nil, fmt.Errorf("failed to parse tool arguments: %w (raw arguments: %s)", err, argsJSON)
	}

	return toolName, args, nil
}
