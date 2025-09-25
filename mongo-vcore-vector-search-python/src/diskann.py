import os
from typing import List, Dict, Any
from utils import get_clients, get_clients_passwordless, read_file_return_json, insert_data, print_search_results, drop_vector_indexes
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


def create_diskann_vector_index(collection, vector_field: str, dimensions: int) -> None:

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

    print(f"Performing DiskANN vector search for: '{query_text}'")

    try:
        # Generate embedding for the query text
        embedding_response = azure_openai_client.embeddings.create(
            input=[query_text],
            model=model_name
        )

        query_embedding = embedding_response.data[0].embedding

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
                    "document": "$$ROOT",
                    # Add search score from metadata
                    "score": {"$meta": "searchScore"}
                }
            }
        ]

        # Execute the aggregation pipeline
        results = list(collection.aggregate(pipeline))

        return results

    except Exception as e:
        print(f"Error performing DiskANN vector search: {e}")
        raise


def main():

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
        # Initialize clients
        print("\nInitializing MongoDB and Azure OpenAI clients...")
        mongo_client, azure_openai_client = get_clients_passwordless()

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
        query = "quintessential lodging near running trails, eateries, retail"

        results = perform_diskann_vector_search(
            collection,
            azure_openai_client,
            query,
            config['vector_field'],
            config['model_name'],
            top_k=5
        )

        # Display results
        print_search_results(results, max_results=5, show_score=True)


    except Exception as e:
        print(f"\nError during DiskANN demonstration: {e}")
        raise

    finally:
        # Close the MongoDB client
        if 'mongo_client' in locals():
            mongo_client.close()


if __name__ == "__main__":
    main()