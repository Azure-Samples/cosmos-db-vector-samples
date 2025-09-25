import os
from typing import List, Dict, Any
from utils import get_clients, get_clients_passwordless,read_file_return_json, insert_data, print_search_results, drop_vector_indexes
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


def create_ivf_vector_index(collection, vector_field: str, dimensions: int) -> None:

    print(f"Creating IVF vector index on field '{vector_field}'...")

    # Drop any existing vector indexes on this field first
    drop_vector_indexes(collection, vector_field)

    # Use the native MongoDB command for Cosmos DB vector indexes
    index_command = {
        "createIndexes": collection.name,
        "indexes": [
            {
                "name": f"ivf_index_{vector_field}",
                "key": {
                    vector_field: "cosmosSearch"  # Cosmos DB vector search index type
                },
                "cosmosSearchOptions": {
                    # IVF algorithm configuration
                    "kind": "vector-ivf",

                    # Vector dimensions must match the embedding model
                    "dimensions": dimensions,

                    # Cosine similarity is effective for text embeddings
                    "similarity": "COS",

                    # Number of clusters (centroids) to partition vectors into
                    # More clusters = faster search but potentially lower recall
                    # For small datasets like this, use fewer clusters
                    "numLists": 10
                }
            }
        ]
    }

    try:
        # Execute the createIndexes command directly
        result = collection.database.command(index_command)
        print("IVF vector index created successfully")

    except Exception as e:
        print(f"Error creating IVF vector index: {e}")
        raise


def perform_ivf_vector_search(collection,
                             azure_openai_client,
                             query_text: str,
                             vector_field: str,
                             model_name: str,
                             top_k: int = 5,
                             num_probes: int = 1) -> List[Dict[str, Any]]:

    print(f"Performing IVF vector search for: '{query_text}'")

    try:
        # Generate embedding vector for the search query
        embedding_response = azure_openai_client.embeddings.create(
            input=[query_text],
            model=model_name
        )

        query_embedding = embedding_response.data[0].embedding

        # Construct aggregation pipeline for IVF vector search
        pipeline = [
            {
                "$search": {
                    # Use cosmosSearch for vector operations in Cosmos DB
                    "cosmosSearch": {
                        # Query vector to find similar documents
                        "vector": query_embedding,

                        # Document field containing vectors to search against
                        "path": vector_field,

                        # Final number of results to return
                        "k": top_k
                    }
                }
            },
            {
                # Project only the fields we want in the output and add similarity score
                "$project": {
                    "document": "$$ROOT",
                    # Add search score from metadata
                    "score": {"$meta": "searchScore"}
                }
            }
        ]

        # Run the search aggregation pipeline
        results = list(collection.aggregate(pipeline))

        return results

    except Exception as e:
        print(f"Error performing IVF vector search: {e}")
        raise


def main():

    print("Starting IVF vector search demonstration...")

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
        # Initialize database and AI service clients
        print("\nInitializing clients...")
        mongo_client, azure_openai_client = get_clients_passwordless()

        # Connect to database and collection
        database = mongo_client[config['database_name']]
        collection = database[config['collection_name']]

        # Load hotel data with embeddings
        print(f"\nLoading data from {config['data_file']}...")
        data = read_file_return_json(config['data_file'])
        print(f"Loaded {len(data)} documents")

        # Verify embeddings exist in the data
        documents_with_embeddings = [doc for doc in data if config['vector_field'] in doc]
        if not documents_with_embeddings:
            raise ValueError(f"No documents found with embeddings in field '{config['vector_field']}'. "
                           "Please run create_embeddings.py first.")

        # Prepare collection with fresh data
        print(f"\nPreparing collection '{config['collection_name']}'...")

        # Remove any existing data for clean state
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

        # Create IVF vector index for clustering-based search
        print("\nCreating IVF vector index...")
        create_ivf_vector_index(
            collection,
            config['vector_field'],
            config['dimensions']
        )

        # Wait for index to be built and ready
        import time
        print("Waiting for index clustering to complete...")
        time.sleep(3)  # IVF may need more time for clustering

        # Demonstrate IVF search 
        query = "quintessential lodging near running trails, eateries, retail"

        results = perform_ivf_vector_search(
            collection,
            azure_openai_client,
            query,
            config['vector_field'],
            config['model_name'],
            top_k=5
        )

        # Display the search results
        print_search_results(results)

    except Exception as e:
        print(f"\nError during IVF demonstration: {e}")
        raise

    finally:
        # Ensure MongoDB connection is properly closed
        if 'mongo_client' in locals():
            mongo_client.close()


if __name__ == "__main__":
    main()