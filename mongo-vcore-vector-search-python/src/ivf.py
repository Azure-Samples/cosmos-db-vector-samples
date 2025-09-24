"""
IVF vector search implementation for Cosmos DB.

IVF (Inverted File) creates clusters of similar vectors and uses centroids
to quickly narrow down search candidates. It's efficient for large datasets
and provides good performance with configurable accuracy trade-offs.
"""

import os
from typing import List, Dict, Any
from utils import get_clients, read_file_return_json, insert_data, print_search_results, drop_vector_indexes
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


def create_ivf_vector_index(collection, vector_field: str, dimensions: int) -> None:
    """
    Create an IVF vector index on the specified collection.

    IVF partitions the vector space into clusters (Voronoi cells) and creates
    an inverted index structure for efficient similarity search.

    Args:
        collection: MongoDB collection to create the index on
        vector_field: Name of the field containing vector embeddings
        dimensions: Number of dimensions in the vector embeddings
    """
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

        # Display configuration details for reference
        print(f"Index configuration:")
        print(f"  Type: IVF (Inverted File)")
        print(f"  Similarity metric: Cosine")
        print(f"  Dimensions: {dimensions}")
        print(f"  Number of lists: 10")

    except Exception as e:
        print(f"Error creating IVF vector index: {e}")
        raise


def perform_ivf_vector_search(collection,
                             azure_openai_client,
                             query_text: str,
                             vector_field: str,
                             model_name: str,
                             top_k: int = 5,
                             num_probes: int = 10) -> List[Dict[str, Any]]:
    """
    Perform vector similarity search using IVF index.

    IVF search first identifies the most relevant clusters based on centroids,
    then searches within those clusters for the best matches.

    Args:
        collection: MongoDB collection with IVF vector index
        azure_openai_client: Azure OpenAI client for generating query embeddings
        query_text: Text query to search for
        vector_field: Name of the field containing vector embeddings
        model_name: Name of the embedding model
        top_k: Number of top results to return
        num_probes: Number of clusters to search (affects accuracy vs speed)

    Returns:
        List of similar documents with similarity scores
    """
    print(f"Performing IVF vector search for: '{query_text}'")

    try:
        # Generate embedding vector for the search query
        print("Generating embedding for query...")
        embedding_response = azure_openai_client.embeddings.create(
            input=[query_text],
            model=model_name
        )

        query_embedding = embedding_response.data[0].embedding
        print(f"Generated embedding with {len(query_embedding)} dimensions")

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
                    "HotelId": 1,
                    "HotelName": 1,
                    "Description": 1,
                    "Category": 1,
                    "Rating": 1,
                    "Address": 1,
                    "Tags": 1,
                    "ParkingIncluded": 1,
                    # Add search score from metadata
                    "score": {"$meta": "searchScore"}
                }
            }
        ]

        print(f"Executing IVF vector search (top {top_k} results, {num_probes} cluster probes)...")

        # Run the search aggregation pipeline
        results = list(collection.aggregate(pipeline))

        print(f"IVF search completed: found {len(results)} similar results")
        return results

    except Exception as e:
        print(f"Error performing IVF vector search: {e}")
        raise


def main():
    """
    Main function to demonstrate IVF vector search functionality.

    This function:
    1. Loads hotel data with vector embeddings
    2. Inserts data into MongoDB collection
    3. Creates an IVF vector index with clustering
    4. Performs sample searches with different probe settings
    """
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

    print(f"Configuration:")
    print(f"  Database: {config['database_name']}")
    print(f"  Collection: {config['collection_name']}")
    print(f"  Data file: {config['data_file']}")
    print(f"  Vector field: {config['vector_field']}")
    print(f"  Vector dimensions: {config['dimensions']}")

    try:
        # Initialize database and AI service clients
        print("\nInitializing clients...")
        mongo_client, azure_openai_client = get_clients()

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

        print(f"Found {len(documents_with_embeddings)} documents with embeddings")

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

        # Demonstrate IVF search capabilities with various scenarios
        search_scenarios = [
            {
                "query": "hotel with pool and spa amenities",
                "description": "Luxury amenities search",
                "probes": [5, 10, 20]
            },
            {
                "query": "budget accommodation with basic facilities",
                "description": "Economy hotel search",
                "probes": [5, 10]
            },
            {
                "query": "extended stay hotel with kitchen facilities",
                "description": "Long-term accommodation",
                "probes": [10, 15]
            }
        ]

        for scenario in search_scenarios:
            query = scenario["query"]
            description = scenario["description"]
            probe_values = scenario["probes"]

            print(f"\n{'='*80}")
            print(f"SEARCH SCENARIO: {query}")
            print(f"Description: {description}")
            print('='*80)

            # Test different probe values to show accuracy vs speed trade-off
            for num_probes in probe_values:
                print(f"\n--- IVF Search with {num_probes} cluster probes ---")
                print(f"(Higher probe counts search more clusters for better accuracy)")

                results = perform_ivf_vector_search(
                    collection,
                    azure_openai_client,
                    query,
                    config['vector_field'],
                    config['model_name'],
                    top_k=3,
                    num_probes=num_probes
                )

                # Display the search results
                print_search_results(results, max_results=3, show_score=True)

        print(f"\n{'='*80}")
        print("IVF vector search demonstration completed successfully!")
        print("Key features of IVF indexing:")
        print("  • Clusters vectors by similarity using centroids")
        print("  • Fast search by examining only relevant clusters")
        print("  • Configurable accuracy vs speed with probe parameters")
        print("  • Efficient for large datasets with many vectors")
        print("  • Good balance between memory usage and search quality")
        print('='*80)

    except Exception as e:
        print(f"\nError during IVF demonstration: {e}")
        raise

    finally:
        # Ensure MongoDB connection is properly closed
        if 'mongo_client' in locals():
            mongo_client.close()


if __name__ == "__main__":
    main()