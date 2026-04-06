package client

import (
	"fmt"

	"github.com/Azure/azure-sdk-for-go/sdk/ai/azopenai"
	"github.com/Azure/azure-sdk-for-go/sdk/azcore"
	"github.com/Azure/azure-sdk-for-go/sdk/azidentity"
	"github.com/Azure/azure-sdk-for-go/sdk/data/azcosmos"
)

// Clients holds the initialized Azure service clients.
type Clients struct {
	Cosmos *azcosmos.Client
	OpenAI *azopenai.Client
}

// NewClientsPasswordless creates Cosmos DB and Azure OpenAI clients using
// DefaultAzureCredential (passwordless / managed-identity authentication).
func NewClientsPasswordless(cosmosEndpoint, openAIEndpoint string) (*Clients, error) {
	cred, err := azidentity.NewDefaultAzureCredential(nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create DefaultAzureCredential: %w", err)
	}

	cosmosClient, err := azcosmos.NewClient(cosmosEndpoint, cred, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create Cosmos DB client: %w", err)
	}

	openAIClient, err := azopenai.NewClient(openAIEndpoint, cred, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create Azure OpenAI client: %w", err)
	}

	return &Clients{Cosmos: cosmosClient, OpenAI: openAIClient}, nil
}

// NewClientsWithKey creates Cosmos DB (passwordless) and Azure OpenAI (key-based) clients.
// Use this when Azure OpenAI requires an API key instead of token credentials.
func NewClientsWithKey(cosmosEndpoint, openAIEndpoint, openAIKey string) (*Clients, error) {
	cred, err := azidentity.NewDefaultAzureCredential(nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create DefaultAzureCredential: %w", err)
	}

	cosmosClient, err := azcosmos.NewClient(cosmosEndpoint, cred, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create Cosmos DB client: %w", err)
	}

	keyCred := azcore.NewKeyCredential(openAIKey)

	openAIClient, err := azopenai.NewClientWithKeyCredential(openAIEndpoint, keyCred, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create Azure OpenAI client with key: %w", err)
	}

	return &Clients{Cosmos: cosmosClient, OpenAI: openAIClient}, nil
}
