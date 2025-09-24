"""
Create embeddings for hotel data using Azure OpenAI.

This script reads hotel data without embeddings, generates vector embeddings
for the description field using Azure OpenAI, and saves the enhanced data
with embeddings for use in vector search operations.
"""

import os
import time
from typing import List, Dict, Any
from utils import get_clients, read_file_return_json, write_file_json
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


def create_embeddings(texts: List[str], azure_openai_client, model_name: str) -> List[List[float]]:
    """
    Generate embeddings for a list of texts using Azure OpenAI.

    This function calls the Azure OpenAI service to convert text into vector
    representations that can be used for similarity search.

    Args:
        texts: List of text strings to generate embeddings for
        azure_openai_client: Configured Azure OpenAI client
        model_name: Name of the embedding model to use (e.g., 'text-embedding-ada-002')

    Returns:
        List of embedding vectors, where each vector is a list of floats

    Raises:
        Exception: If the API call fails
    """
    try:
        # Call Azure OpenAI embedding API
        # The response contains embeddings for all input texts
        response = azure_openai_client.embeddings.create(
            input=texts,
            model=model_name
        )

        # Extract embedding vectors from the API response
        embeddings = []
        for item in response.data:
            embeddings.append(item.embedding)

        print(f"Successfully generated {len(embeddings)} embeddings")
        return embeddings

    except Exception as e:
        print(f"Error generating embeddings: {e}")
        raise


def process_embedding_batch(data_batch: List[Dict[str, Any]],
                          azure_openai_client,
                          field_to_embed: str,
                          embedded_field: str,
                          model_name: str) -> None:
    """
    Process a batch of data to add embeddings.

    This function takes a batch of documents, extracts the text to embed,
    generates embeddings, and adds them back to the original documents.

    Args:
        data_batch: List of documents to process
        azure_openai_client: Configured Azure OpenAI client
        field_to_embed: Name of the field containing text to embed
        embedded_field: Name of the field where embeddings will be stored
        model_name: Name of the embedding model to use
    """
    # Extract texts that need embeddings
    texts_to_embed = []
    indices_with_text = []  # Track which documents have text to embed

    for i, document in enumerate(data_batch):
        if field_to_embed in document and document[field_to_embed]:
            texts_to_embed.append(document[field_to_embed])
            indices_with_text.append(i)
        else:
            print(f"Warning: Document {document.get('HotelId', 'unknown')} missing {field_to_embed} field")

    # Generate embeddings for all texts in this batch
    if texts_to_embed:
        embeddings = create_embeddings(texts_to_embed, azure_openai_client, model_name)

        # Add embeddings back to the original documents
        for embedding_idx, doc_idx in enumerate(indices_with_text):
            data_batch[doc_idx][embedded_field] = embeddings[embedding_idx]

        print(f"Added embeddings to {len(embeddings)} documents in batch")
    else:
        print("No texts found to embed in this batch")


def main():
    """
    Main function to orchestrate the embedding creation process.

    This function:
    1. Loads configuration from environment variables
    2. Reads the input data file
    3. Processes data in batches to generate embeddings
    4. Saves the enhanced data with embeddings
    """
    print("Starting embedding creation process...")

    # Load configuration from environment variables
    config = {
        'model_name': os.getenv('AZURE_OPENAI_EMBEDDING_MODEL', 'text-embedding-ada-002'),
        'input_file': os.getenv('DATA_FILE_WITHOUT_VECTORS', 'data/HotelsData_toCosmosDB_Vector.json'),
        'output_file': os.getenv('DATA_FILE_WITH_VECTORS', 'data/HotelsData_with_vectors.json'),
        'field_to_embed': os.getenv('FIELD_TO_EMBED', 'Description'),
        'embedded_field': os.getenv('EMBEDDED_FIELD', 'DescriptionVector'),
        'batch_size': int(os.getenv('EMBEDDING_SIZE_BATCH', '16'))
    }

    print(f"Configuration:")
    print(f"  Input file: {config['input_file']}")
    print(f"  Output file: {config['output_file']}")
    print(f"  Field to embed: {config['field_to_embed']}")
    print(f"  Embedding field: {config['embedded_field']}")
    print(f"  Batch size: {config['batch_size']}")
    print(f"  Model: {config['model_name']}")

    try:
        # Initialize clients for MongoDB and Azure OpenAI
        print("\nInitializing Azure OpenAI client...")
        mongo_client, azure_openai_client = get_clients()

        # Read the input data file
        print(f"\nReading input data from {config['input_file']}...")
        data = read_file_return_json(config['input_file'])
        print(f"Loaded {len(data)} documents")

        # Process data in batches to avoid API rate limits and memory issues
        total_batches = (len(data) + config['batch_size'] - 1) // config['batch_size']
        print(f"\nProcessing {len(data)} documents in {total_batches} batches...")

        for i in range(0, len(data), config['batch_size']):
            batch = data[i:i + config['batch_size']]
            batch_num = (i // config['batch_size']) + 1

            print(f"\nProcessing batch {batch_num}/{total_batches} ({len(batch)} documents)...")

            # Generate embeddings for this batch
            process_embedding_batch(
                batch,
                azure_openai_client,
                config['field_to_embed'],
                config['embedded_field'],
                config['model_name']
            )

            # Small delay between batches to respect API rate limits
            if i + config['batch_size'] < len(data):  # Don't delay after the last batch
                print("Waiting before next batch to respect rate limits...")
                time.sleep(1)

        # Save the enhanced data with embeddings
        print(f"\nSaving enhanced data to {config['output_file']}...")
        write_file_json(data, config['output_file'])

        print("\nEmbedding creation completed successfully!")

        # Display summary information
        documents_with_embeddings = sum(1 for doc in data if config['embedded_field'] in doc)
        print(f"\nSummary:")
        print(f"  Total documents processed: {len(data)}")
        print(f"  Documents with embeddings: {documents_with_embeddings}")

        if documents_with_embeddings > 0:
            # Show embedding dimensions for verification
            first_embedding = next(doc[config['embedded_field']] for doc in data
                                 if config['embedded_field'] in doc)
            print(f"  Embedding dimensions: {len(first_embedding)}")

    except Exception as e:
        print(f"\nError during embedding creation: {e}")
        raise

    finally:
        # Close the MongoDB client if it was created
        if 'mongo_client' in locals():
            mongo_client.close()


if __name__ == "__main__":
    main()