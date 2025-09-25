import os
from typing import List, Dict, Any
from utils import get_clients, get_clients_passwordless, read_file_return_json, insert_data, print_search_results, drop_vector_indexes
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


def create_hnsw_vector_index(collection, vector_field: str, dimensions: int) -> None:

    print(f"Creating HNSW vector index on field '{vector_field}'...")

    # Drop any existing vector indexes on this field first
    drop_vector_indexes(collection, vector_field)

    # Use the native MongoDB command for Cosmos DB vector indexes
    index_command = {
        "createIndexes": collection.name,
        "indexes": [
            {
                "name": f"hnsw_index_{vector_field}",
                "key": {
                    vector_field: "cosmosSearch"  # Cosmos DB vector search index type
                },
                "cosmosSearchOptions": {
                    # HNSW algorithm configuration
                    "kind": "vector-hnsw",

                    # Vector dimensions must match the embedding model
                    "dimensions": dimensions,

                    # Cosine similarity works well with text embeddings
                    "similarity": "COS",

                    # Maximum connections per node in the graph (parameter 'm')
                    # Higher values improve recall but increase memory usage and build time
                    "m": 16,

                    # Size of the candidate list during construction
                    # Higher values improve index quality but slow down building
                    "efConstruction": 64
                }
            }
        ]
    }

    try:
        # Execute the createIndexes command directly
        result = collection.database.command(index_command)
        print("HNSW vector index created successfully")

    except Exception as e:
        print(f"Error creating HNSW vector index: {e}")
        raise


def perform_hnsw_vector_search(collection,
                              azure_openai_client,
                              query_text: str,
                              vector_field: str,
                              model_name: str,
                              top_k: int = 5,
                              ef_search: int = 16) -> List[Dict[str, Any]]:

    print(f"Performing HNSW vector search for: '{query_text}'")

    try:
        # Convert query text to embedding vector
        embedding_response = azure_openai_client.embeddings.create(
            input=[query_text],
            model=model_name
        )

        query_embedding = embedding_response.data[0].embedding

        # Build aggregation pipeline for HNSW vector search
        pipeline = [
            {
                "$search": {
                    # Use cosmosSearch for vector operations in Cosmos DB
                    "cosmosSearch": {
                        # Query vector to find similar documents for
                        "vector": query_embedding,

                        # Field in documents containing vectors to compare against
                        "path": vector_field,

                        # Maximum number of results to return
                        "k": top_k
                    }
                }
            },
            {
                # Select only the fields needed for display and add similarity score
                "$project": {
                    "document": "$$ROOT",
                    # Add search score from metadata
                    "score": {"$meta": "searchScore"}
                }
            }
        ]

        # Execute the search pipeline
        results = list(collection.aggregate(pipeline))

        return results

    except Exception as e:
        print(f"Error performing HNSW vector search: {e}")
        raise


def main():

    print("Starting HNSW vector search demonstration...")

    # Load configuration from environment variables
    config = {
        'cluster_name': os.getenv('MONGO_CLUSTER_NAME', 'vectorSearch'),
        'database_name': 'vectorSearchDB',
        'collection_name': 'vectorSearchCollection',
        'data_file': os.getenv('DATA_FILE_WITH_VECTORS', 'data/HotelsData_with_vectors.json'),
        'vector_field': os.getenv('EMBEDDED_FIELD', 'DescriptionVector'),
        'model_name': os.getenv('AZURE_OPENAI_EMBEDDING_MODEL', 'text-embedding-ada-002'),
        'dimensions': int(os.getenv('EMBEDDING_DIMENSIONS', '1536')),
        'batch_size': int(os.getenv('LOAD_SIZE_BATCH', '100'))
    }

    try:
        # Initialize MongoDB and Azure OpenAI clients
        print("\nInitializing clients...")
        mongo_client, azure_openai_client = get_clients_passwordless()

        # Access database and collection
        database = mongo_client[config['database_name']]
        collection = database[config['collection_name']]

        # Load hotel data with embeddings
        print(f"\nLoading data from {config['data_file']}...")
        data = read_file_return_json(config['data_file'])
        print(f"Loaded {len(data)} documents")

        # Verify that embeddings are present in the data
        documents_with_embeddings = [doc for doc in data if config['vector_field'] in doc]
        if not documents_with_embeddings:
            raise ValueError(f"No documents found with embeddings in field '{config['vector_field']}'. "
                           "Please run create_embeddings.py first.")

        # Insert data into MongoDB collection
        print(f"\nPreparing collection '{config['collection_name']}'...")

        # Clear any existing data to start fresh
        collection.delete_many({})
        print("Cleared existing data from collection")

        # Insert hotel data with embeddings
        stats = insert_data(
            collection,
            documents_with_embeddings,
            batch_size=config['batch_size']
        )

        if stats['inserted'] == 0:
            raise ValueError("No documents were inserted successfully")

        # Create HNSW vector index for efficient similarity search
        print("\nCreating HNSW vector index...")
        create_hnsw_vector_index(
            collection,
            config['vector_field'],
            config['dimensions']
        )

        # Allow time for index to become ready
        import time
        print("Waiting for index to be ready...")
        time.sleep(2)

        # Demonstrate HNSW search with various queries
        query = "quintessential lodging near running trails, eateries, retail"

        results = perform_hnsw_vector_search(
            collection,
            azure_openai_client,
            query,
            config['vector_field'],
            config['model_name'],
            top_k=5,
            ef_search=16
        )

        # Display the search results
        print_search_results(results, max_results=5, show_score=True)


    except Exception as e:
        print(f"\nError during HNSW demonstration: {e}")
        raise

    finally:
        # Clean up MongoDB connection
        if 'mongo_client' in locals():
            mongo_client.close()


if __name__ == "__main__":
    main()