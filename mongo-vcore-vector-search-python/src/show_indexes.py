"""
Display vector indexes for Cosmos DB collections.

This utility script shows all vector indexes in a collection, including
their configuration details, status, and performance characteristics.
Useful for debugging and monitoring vector search setups.
"""

import os
from typing import List, Dict, Any
from utils import get_clients
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


def format_index_info(index_info: Dict[str, Any]) -> str:
    """
    Format index information into a readable string representation.

    Takes the raw index information from MongoDB and creates a nicely
    formatted display showing the most important details.

    Args:
        index_info: Dictionary containing index metadata from MongoDB

    Returns:
        Formatted string representation of the index
    """
    lines = []

    # Basic index information
    name = index_info.get('name', 'Unknown')
    lines.append(f"Index Name: {name}")

    # Check if this is a vector index by looking for vector search configuration
    if 'vectorSearchConfiguration' in index_info:
        config = index_info['vectorSearchConfiguration']
        lines.append(f"Type: Vector Search Index")

        # Vector search specific details
        if 'similarity' in config:
            lines.append(f"Similarity Metric: {config['similarity']}")
        if 'dimensions' in config:
            lines.append(f"Vector Dimensions: {config['dimensions']}")

        # Check for specific vector index types and their parameters
        if 'diskann' in config:
            diskann_config = config['diskann']
            lines.append(f"Algorithm: DiskANN")
            lines.append(f"  Max Degree: {diskann_config.get('maxDegree', 'N/A')}")
            lines.append(f"  Build Parameter: {diskann_config.get('buildParam', 'N/A')}")

        elif 'hnsw' in config:
            hnsw_config = config['hnsw']
            lines.append(f"Algorithm: HNSW (Hierarchical Navigable Small World)")
            lines.append(f"  Max Connections: {hnsw_config.get('maxConnections', 'N/A')}")
            lines.append(f"  EF Construction: {hnsw_config.get('efConstruction', 'N/A')}")

        elif 'ivf' in config:
            ivf_config = config['ivf']
            lines.append(f"Algorithm: IVF (Inverted File)")
            lines.append(f"  Number of Clusters: {ivf_config.get('numClusters', 'N/A')}")
            lines.append(f"  Minimum Vectors: {ivf_config.get('minVectors', 'N/A')}")
    else:
        # Regular MongoDB index
        lines.append(f"Type: Standard MongoDB Index")

        # Show the key pattern for regular indexes
        if 'key' in index_info:
            key_info = index_info['key']
            if isinstance(key_info, dict):
                key_fields = ', '.join([f"{k}: {v}" for k, v in key_info.items()])
                lines.append(f"Key Pattern: {key_fields}")

    # Index status and statistics if available
    if 'unique' in index_info and index_info['unique']:
        lines.append("Unique: Yes")

    if 'sparse' in index_info and index_info['sparse']:
        lines.append("Sparse: Yes")

    if 'background' in index_info and index_info['background']:
        lines.append("Built in Background: Yes")

    return '\n'.join(f"  {line}" for line in lines)


def show_collection_indexes(collection, collection_name: str) -> None:
    """
    Display all indexes for a specific collection.

    This function retrieves and displays comprehensive information about
    all indexes in the collection, with special formatting for vector indexes.

    Args:
        collection: MongoDB collection object
        collection_name: Name of the collection for display purposes
    """
    print(f"\n{'='*80}")
    print(f"INDEXES FOR COLLECTION: {collection_name}")
    print('='*80)

    try:
        # Get all indexes for this collection
        # list_indexes() returns a cursor with detailed index information
        indexes = list(collection.list_indexes())

        if not indexes:
            print("No indexes found in this collection.")
            return

        print(f"Found {len(indexes)} index(es):\n")

        # Display each index with its details
        for i, index_info in enumerate(indexes, 1):
            print(f"Index {i}:")
            print(format_index_info(index_info))

            # Add separator between indexes (except for the last one)
            if i < len(indexes):
                print(f"\n{'-'*60}")
            print()

    except Exception as e:
        print(f"Error retrieving indexes for collection '{collection_name}': {e}")


def show_database_collections_and_indexes(database, database_name: str) -> None:
    """
    Display all collections in a database and their indexes.

    This function provides a comprehensive overview of the database structure,
    showing all collections and their associated indexes.

    Args:
        database: MongoDB database object
        database_name: Name of the database for display purposes
    """
    print(f"\n{'#'*80}")
    print(f"DATABASE: {database_name}")
    print('#'*80)

    try:
        # Get list of all collections in the database
        collection_names = database.list_collection_names()

        if not collection_names:
            print("No collections found in this database.")
            return

        print(f"Found {len(collection_names)} collection(s) in database:")

        # Show indexes for each collection
        for collection_name in collection_names:
            collection = database[collection_name]

            # Get basic collection statistics
            try:
                stats = database.command("collStats", collection_name)
                doc_count = stats.get('count', 0)
                print(f"\nCollection: {collection_name} ({doc_count} documents)")
            except:
                # If collStats fails, just show the collection name
                print(f"\nCollection: {collection_name}")

            # Show all indexes for this collection
            show_collection_indexes(collection, collection_name)

    except Exception as e:
        print(f"Error accessing database '{database_name}': {e}")


def main():
    """
    Main function to display vector indexes and collection information.

    This function connects to MongoDB and shows detailed information about
    all databases, collections, and their indexes, with special attention
    to vector search indexes.
    """
    print("Vector Index Information Display")
    print("="*50)

    # Load configuration from environment variables
    config = {
        'cluster_name': os.getenv('MONGO_CLUSTER_NAME', 'vectorSearch'),
        'default_database': 'vectorSearchDB',
        'default_collection': 'vectorSearchCollection'
    }

    print(f"Cluster: {config['cluster_name']}")
    print(f"Default Database: {config['default_database']}")
    print(f"Default Collection: {config['default_collection']}")

    try:
        # Initialize MongoDB client
        print("\nConnecting to MongoDB...")
        mongo_client, _ = get_clients()  # We only need MongoDB client for this operation

        # Option 1: Show indexes for the default database and collection
        print(f"\n{'*'*80}")
        print("OPTION 1: DEFAULT DATABASE AND COLLECTION")
        print('*'*80)

        database = mongo_client[config['default_database']]
        collection = database[config['default_collection']]

        # Check if the collection exists and has documents
        try:
            doc_count = collection.count_documents({})
            if doc_count > 0:
                print(f"Collection '{config['default_collection']}' contains {doc_count} documents")
                show_collection_indexes(collection, config['default_collection'])
            else:
                print(f"Collection '{config['default_collection']}' is empty or doesn't exist.")
                print("Run one of the vector search scripts (diskann.py, hnsw.py, ivf.py) first.")
        except Exception as e:
            print(f"Cannot access collection '{config['default_collection']}': {e}")

        # Option 2: Show all databases and their collections
        print(f"\n{'*'*80}")
        print("OPTION 2: ALL DATABASES AND COLLECTIONS")
        print('*'*80)

        try:
            # Get list of all databases
            database_names = mongo_client.list_database_names()

            # Filter out system databases that users typically don't care about
            user_databases = [db for db in database_names
                            if db not in ['admin', 'local', 'config']]

            if user_databases:
                print(f"Found {len(user_databases)} user database(s):")

                for db_name in user_databases:
                    database = mongo_client[db_name]
                    show_database_collections_and_indexes(database, db_name)
            else:
                print("No user databases found.")

        except Exception as e:
            print(f"Error listing databases: {e}")

        print(f"\n{'='*80}")
        print("Index information display completed.")
        print("Use this information to:")
        print("  • Verify vector indexes are created correctly")
        print("  • Check index configuration parameters")
        print("  • Monitor index status and performance")
        print("  • Debug vector search issues")
        print('='*80)

    except Exception as e:
        print(f"\nError during index information display: {e}")
        raise

    finally:
        # Clean up MongoDB connection
        if 'mongo_client' in locals():
            mongo_client.close()


if __name__ == "__main__":
    main()