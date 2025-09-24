"""
DiskANN vector search implementation for Cosmos DB.

DiskANN (Disk-based Approximate Nearest Neighbor) is optimized for large-scale
vector search with efficient disk usage. It provides good performance for
datasets that don't fit entirely in memory.
"""

import os
from typing import List, Dict, Any
from utils import get_clients, read_file_return_json, insert_data, print_search_results, drop_vector_indexes
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


def create_diskann_vector_index(collection, vector_field: str, dimensions: int) -> None:
    """
    Create a DiskANN vector index on the specified collection.

    DiskANN is designed for large datasets and provides efficient approximate
    nearest neighbor search with disk-based storage optimization.

    Args:
        collection: MongoDB collection to create the index on
        vector_field: Name of the field containing vector embeddings
        dimensions: Number of dimensions in the vector embeddings
    """
    print(f"Creating DiskANN vector index on field '{vector_field}'...")

    # Drop any existing vector indexes on this field first
    drop_vector_indexes(collection, vector_field)

    # Use the native MongoDB command for Cosmos DB vector indexes
    index_command = {
        "createIndexes": collection.name,
        "indexes": [
            {
                "name": f"diskann_index_{vector_field}",
                "key": {
                    vector_field: "cosmosSearch"  # Cosmos DB vector search index type
                },
                "cosmosSearchOptions": {
                    # DiskANN algorithm configuration
                    "kind": "vector-diskann",

                    # Vector dimensions must match the embedding model
                    "dimensions": dimensions,

                    # Vector similarity metric - cosine is good for text embeddings
                    "similarity": "COS",

                    # Maximum degree: number of edges per node in the graph
                    # Higher values improve accuracy but increase memory usage
                    "maxDegree": 20,

                    # Build parameter: candidates evaluated during index construction
                    # Higher values improve index quality but increase build time
                    "lBuild": 10
                }
            }
        ]
    }

    try:
        # Execute the createIndexes command directly
        result = collection.database.command(index_command)
        print("DiskANN vector index created successfully")

        # Display index configuration for verification
        print(f"Index configuration:")
        print(f"  Type: DiskANN")
        print(f"  Similarity metric: Cosine")
        print(f"  Dimensions: {dimensions}")
        print(f"  Max degree: 20")
        print(f"  Build parameter: 10")

    except Exception as e:
        print(f"Error creating DiskANN vector index: {e}")

        # Check if it's a tier limitation and suggest alternatives
        if "not enabled for this cluster tier" in str(e):
            print("\nDiskANN indexes require a higher cluster tier.")
            print("Try one of these alternatives:")
            print("  • Upgrade your Cosmos DB cluster to a higher tier")
            print("  • Use HNSW instead: python src/hnsw.py")
            print("  • Use IVF instead: python src/ivf.py")
        raise


def perform_diskann_vector_search(collection,
                                 azure_openai_client,
                                 query_text: str,
                                 vector_field: str,
                                 model_name: str,
                                 top_k: int = 5) -> List[Dict[str, Any]]:
    """
    Perform vector similarity search using DiskANN index.

    This function converts the query text to a vector embedding and searches
    for the most similar documents using the DiskANN index.

    Args:
        collection: MongoDB collection with DiskANN vector index
        azure_openai_client: Azure OpenAI client for generating query embeddings
        query_text: Text query to search for
        vector_field: Name of the field containing vector embeddings
        model_name: Name of the embedding model
        top_k: Number of top results to return

    Returns:
        List of similar documents with similarity scores
    """
    print(f"Performing DiskANN vector search for: '{query_text}'")

    try:
        # Generate embedding for the query text
        print("Generating embedding for query...")
        embedding_response = azure_openai_client.embeddings.create(
            input=[query_text],
            model=model_name
        )

        query_embedding = embedding_response.data[0].embedding
        print(f"Generated embedding with {len(query_embedding)} dimensions")

        # Construct the aggregation pipeline for vector search
        # Cosmos DB for MongoDB vCore uses $search with cosmosSearch
        pipeline = [
            {
                "$search": {
                    # Use cosmosSearch for vector operations in Cosmos DB
                    "cosmosSearch": {
                        # The query vector to search for
                        "vector": query_embedding,

                        # Field containing the document vectors to compare against
                        "path": vector_field,

                        # Number of final results to return
                        "k": top_k
                    }
                }
            },
            {
                # Add similarity score to the results
                "$project": {
                    "HotelId": 1,
                    "HotelName": 1,
                    "Description": 1,
                    "Category": 1,
                    "Rating": 1,
                    "Address": 1,
                    # Add search score from metadata
                    "score": {"$meta": "searchScore"}
                }
            }
        ]

        print(f"Executing DiskANN vector search (top {top_k} results)...")

        # Execute the aggregation pipeline
        results = list(collection.aggregate(pipeline))

        print(f"Found {len(results)} similar results")
        return results

    except Exception as e:
        print(f"Error performing DiskANN vector search: {e}")
        raise


def main():
    """
    Main function to demonstrate DiskANN vector search functionality.

    This function:
    1. Loads hotel data with embeddings
    2. Inserts the data into MongoDB collection
    3. Creates a DiskANN vector index
    4. Performs a sample vector search query
    """
    print("Starting DiskANN vector search demonstration...")

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
        # Initialize clients
        print("\nInitializing MongoDB and Azure OpenAI clients...")
        mongo_client, azure_openai_client = get_clients()

        # Get database and collection
        database = mongo_client[config['database_name']]
        collection = database[config['collection_name']]

        # Load data with embeddings
        print(f"\nLoading data from {config['data_file']}...")
        data = read_file_return_json(config['data_file'])
        print(f"Loaded {len(data)} documents")

        # Verify embeddings are present
        documents_with_embeddings = [doc for doc in data if config['vector_field'] in doc]
        if not documents_with_embeddings:
            raise ValueError(f"No documents found with embeddings in field '{config['vector_field']}'. "
                           "Please run create_embeddings.py first.")

        print(f"Found {len(documents_with_embeddings)} documents with embeddings")

        # Insert data into collection
        print(f"\nInserting data into collection '{config['collection_name']}'...")

        # Clear existing data to ensure clean state
        collection.delete_many({})
        print("Cleared existing data from collection")

        # Insert the hotel data
        stats = insert_data(
            collection,
            documents_with_embeddings,
            batch_size=config['batch_size']
        )

        if stats['inserted'] == 0:
            raise ValueError("No documents were inserted successfully")

        # Create DiskANN vector index
        print("\nCreating DiskANN vector index...")
        create_diskann_vector_index(
            collection,
            config['vector_field'],
            config['dimensions']
        )

        # Wait briefly for index to be ready
        import time
        print("Waiting for index to be ready...")
        time.sleep(2)

        # Perform sample vector search
        sample_queries = [
            "luxury hotel with pool and spa",
            "budget accommodation downtown",
            "hotel near airport with free parking"
        ]

        for query in sample_queries:
            print(f"\n{'='*80}")
            print(f"SAMPLE SEARCH: {query}")
            print('='*80)

            results = perform_diskann_vector_search(
                collection,
                azure_openai_client,
                query,
                config['vector_field'],
                config['model_name'],
                top_k=3
            )

            # Display results
            print_search_results(results, max_results=3, show_score=True)

        print(f"\n{'='*80}")
        print("DiskANN vector search demonstration completed successfully!")
        print("The DiskANN index is now ready for interactive queries.")
        print('='*80)

    except Exception as e:
        print(f"\nError during DiskANN demonstration: {e}")
        raise

    finally:
        # Close the MongoDB client
        if 'mongo_client' in locals():
            mongo_client.close()


if __name__ == "__main__":
    main()