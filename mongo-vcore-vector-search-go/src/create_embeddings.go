package main

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"time"

	"github.com/joho/godotenv"
	"github.com/openai/openai-go/v3"
)

// CreateEmbeddings generates embeddings for a list of texts using Azure OpenAI.
//
// This function calls the Azure OpenAI service to convert text into vector
// representations that can be used for similarity search.
//
// Args:
//   - texts: List of text strings to generate embeddings for
//   - azureOpenAIClient: Configured Azure OpenAI client
//   - modelName: Name of the embedding model to use (e.g., 'text-embedding-ada-002')
//
// Returns:
//   - List of embedding vectors, where each vector is a list of floats
//   - Error if the API call fails
func CreateEmbeddings(ctx context.Context, texts []string, openAIClient openai.Client, modelName string) ([][]float64, error) {
	if len(texts) == 0 {
		return nil, fmt.Errorf("no texts provided for embedding")
	}

	fmt.Printf("Generating embeddings for %d texts...\n", len(texts))

	// Call Azure OpenAI embedding API
	// The response contains embeddings for all input texts
	resp, err := openAIClient.Embeddings.New(ctx, openai.EmbeddingNewParams{
		Input: openai.EmbeddingNewParamsInputUnion{
			OfArrayOfStrings: texts,
		},
		Model: modelName,
	})

	if err != nil {
		return nil, fmt.Errorf("error generating embeddings: %v", err)
	}

	// Extract embedding vectors from the API response
	embeddings := make([][]float64, len(resp.Data))
	for i, item := range resp.Data {
		embeddings[i] = item.Embedding
	}

	fmt.Printf("Successfully generated %d embeddings\n", len(embeddings))
	return embeddings, nil
}

// ProcessEmbeddingBatch processes a batch of data to add embeddings.
//
// This function takes a batch of documents, extracts the text to embed,
// generates embeddings, and adds them back to the original documents.
//
// Args:
//   - dataBatch: List of documents to process
//   - azureOpenAIClient: Configured Azure OpenAI client
//   - fieldToEmbed: Name of the field containing text to embed
//   - embeddedField: Name of the field where embeddings will be stored
//   - modelName: Name of the embedding model to use
func ProcessEmbeddingBatch(ctx context.Context, dataBatch []map[string]interface{}, openAIClient openai.Client, fieldToEmbed, embeddedField, modelName string) error {
	// Extract texts that need embeddings
	var textsToEmbed []string
	var indicesWithText []int // Track which documents have text to embed

	for i, document := range dataBatch {
		if value, exists := document[fieldToEmbed]; exists {
			if text, ok := value.(string); ok && text != "" {
				textsToEmbed = append(textsToEmbed, text)
				indicesWithText = append(indicesWithText, i)
			} else {
				fmt.Printf("Warning: Document %v has invalid %s field\n", document["HotelId"], fieldToEmbed)
			}
		} else {
			fmt.Printf("Warning: Document %v missing %s field\n", document["HotelId"], fieldToEmbed)
		}
	}

	// Generate embeddings for all texts in this batch
	if len(textsToEmbed) > 0 {
		embeddings, err := CreateEmbeddings(ctx, textsToEmbed, openAIClient, modelName)
		if err != nil {
			return fmt.Errorf("failed to create embeddings: %v", err)
		}

		// Add embeddings back to the original documents
		for embeddingIdx, docIdx := range indicesWithText {
			dataBatch[docIdx][embeddedField] = embeddings[embeddingIdx]
		}

		fmt.Printf("Added embeddings to %d documents in batch\n", len(embeddings))
	} else {
		fmt.Println("No texts found to embed in this batch")
	}

	return nil
}

// EmbeddingConfig holds configuration for the embedding creation process
type EmbeddingConfig struct {
	ModelName          string
	DataWithoutVectors string
	DataWithVectors    string
	FieldToEmbed       string
	EmbeddedField      string
	BatchSize          int
}

// LoadEmbeddingConfig loads configuration from environment variables
func LoadEmbeddingConfig() *EmbeddingConfig {
	// Load environment variables from .env file
	err := godotenv.Load()
	if err != nil {
		log.Printf("Warning: Error loading .env file: %v", err)
	}

	batchSize, _ := strconv.Atoi(getEnvOrDefault("EMBEDDING_SIZE_BATCH", "16"))

	return &EmbeddingConfig{
		ModelName:          getEnvOrDefault("AZURE_OPENAI_EMBEDDING_MODEL", "text-embedding-ada-002"),
		DataWithoutVectors: getEnvOrDefault("DATA_FILE_WITHOUT_VECTORS", "HotelsData_toCosmosDB.json"),
		DataWithVectors:    getEnvOrDefault("DATA_FILE_WITH_VECTORS", "data/HotelsData_toCosmosDB_Vector.json"),
		FieldToEmbed:       getEnvOrDefault("FIELD_TO_EMBED", "Description"),
		EmbeddedField:      getEnvOrDefault("EMBEDDED_FIELD", "DescriptionVector"),
		BatchSize:          batchSize,
	}
}

// main function orchestrates the embedding creation process.
//
// This function:
// 1. Loads configuration from environment variables
// 2. Reads the input data file
// 3. Processes data in batches to generate embeddings
// 4. Saves the enhanced data with embeddings
func main() {
	ctx := context.Background()

	fmt.Println("Starting embedding creation process...")

	// Load configuration from environment variables
	config := LoadEmbeddingConfig()

	fmt.Printf("Configuration:\n")
	fmt.Printf("  Input file: %s\n", config.DataWithoutVectors)
	fmt.Printf("  Output file: %s\n", config.DataWithVectors)
	fmt.Printf("  Field to embed: %s\n", config.FieldToEmbed)
	fmt.Printf("  Embedding field: %s\n", config.EmbeddedField)
	fmt.Printf("  Batch size: %d\n", config.BatchSize)
	fmt.Printf("  Model: %s\n", config.ModelName)

	// Initialize clients for MongoDB and Azure OpenAI
	fmt.Println("\nInitializing Azure OpenAI client...")
	mongoClient, azureOpenAIClient, err := GetClientsPasswordless()
	if err != nil {
		log.Fatalf("Failed to initialize clients: %v", err)
	}
	defer func() {
		if mongoClient != nil {
			mongoClient.Disconnect(ctx)
		}
	}()

	// Read the input data file
	fmt.Printf("\nReading input data from %s...\n", config.DataWithoutVectors)
	data, err := ReadFileReturnJSON(config.DataWithoutVectors)
	if err != nil {
		log.Fatalf("Failed to read input file: %v", err)
	}
	fmt.Printf("Loaded %d documents\n", len(data))

	// Process data in batches to avoid API rate limits and memory issues
	totalBatches := (len(data) + config.BatchSize - 1) / config.BatchSize
	fmt.Printf("\nProcessing %d documents in %d batches...\n", len(data), totalBatches)

	for i := 0; i < len(data); i += config.BatchSize {
		end := i + config.BatchSize
		if end > len(data) {
			end = len(data)
		}

		batch := data[i:end]
		batchNum := (i / config.BatchSize) + 1

		fmt.Printf("\nProcessing batch %d/%d (%d documents)...\n", batchNum, totalBatches, len(batch))

		// Generate embeddings for this batch
		err := ProcessEmbeddingBatch(
			ctx,
			batch,
			azureOpenAIClient,
			config.FieldToEmbed,
			config.EmbeddedField,
			config.ModelName,
		)
		if err != nil {
			log.Fatalf("Failed to process batch %d: %v", batchNum, err)
		}

		// Small delay between batches to respect API rate limits
		if end < len(data) { // Don't delay after the last batch
			fmt.Println("Waiting before next batch to respect rate limits...")
			time.Sleep(1 * time.Second)
		}
	}

	// Save the enhanced data with embeddings
	fmt.Printf("\nSaving enhanced data to %s...\n", config.DataWithVectors)
	err = WriteFileJSON(data, config.DataWithVectors)
	if err != nil {
		log.Fatalf("Failed to save output file: %v", err)
	}

	fmt.Println("\nEmbedding creation completed successfully!")

	// Display summary information
	documentsWithEmbeddings := 0
	var firstEmbedding []float32

	for _, doc := range data {
		if embedding, exists := doc[config.EmbeddedField]; exists {
			documentsWithEmbeddings++
			if firstEmbedding == nil {
				if embeddingSlice, ok := embedding.([]float32); ok {
					firstEmbedding = embeddingSlice
				}
			}
		}
	}

	fmt.Printf("\nSummary:\n")
	fmt.Printf("  Total documents processed: %d\n", len(data))
	fmt.Printf("  Documents with embeddings: %d\n", documentsWithEmbeddings)

	if len(firstEmbedding) > 0 {
		// Show embedding dimensions for verification
		fmt.Printf("  Embedding dimensions: %d\n", len(firstEmbedding))
	}
}
