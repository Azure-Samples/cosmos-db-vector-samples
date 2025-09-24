"""
Utility functions for Cosmos DB vector search operations.

This module provides shared functionality for connecting to MongoDB/Cosmos DB,
managing Azure OpenAI clients, handling JSON files, and processing search results.
"""

import json
import os
import time
from typing import Dict, List, Any, Optional, Tuple
from pymongo import MongoClient, InsertOne
from pymongo.collection import Collection
from pymongo.errors import BulkWriteError
from azure.identity import DefaultAzureCredential
from openai import AzureOpenAI
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()


def get_clients() -> Tuple[MongoClient, AzureOpenAI]:
    """
    Create MongoDB and Azure OpenAI clients using connection string authentication.

    This is the simpler authentication method that uses connection strings and API keys.
    Requires MONGO_CONNECTION_STRING and AZURE_OPENAI_EMBEDDING_KEY in environment.

    Returns:
        Tuple containing MongoDB client and Azure OpenAI client

    Raises:
        ValueError: If required environment variables are missing
    """
    # Get MongoDB connection string - required for Cosmos DB access
    mongo_connection_string = os.getenv("MONGO_CONNECTION_STRING")
    if not mongo_connection_string:
        raise ValueError("MONGO_CONNECTION_STRING environment variable is required")

    # Create MongoDB client with optimized settings for Cosmos DB
    mongo_client = MongoClient(
        mongo_connection_string,
        maxPoolSize=50,  # Allow up to 50 connections for better performance
        minPoolSize=5,   # Keep minimum 5 connections open
        maxIdleTimeMS=30000,  # Close idle connections after 30 seconds
        serverSelectionTimeoutMS=5000,  # 5 second timeout for server selection
        socketTimeoutMS=20000  # 20 second socket timeout
    )

    # Get Azure OpenAI configuration
    azure_openai_endpoint = os.getenv("AZURE_OPENAI_EMBEDDING_ENDPOINT")
    azure_openai_key = os.getenv("AZURE_OPENAI_EMBEDDING_KEY")

    if not azure_openai_endpoint or not azure_openai_key:
        raise ValueError("Azure OpenAI endpoint and key are required")

    # Create Azure OpenAI client for generating embeddings
    azure_openai_client = AzureOpenAI(
        azure_endpoint=azure_openai_endpoint,
        api_key=azure_openai_key,
        api_version=os.getenv("AZURE_OPENAI_EMBEDDING_API_VERSION", "2024-02-01")
    )

    return mongo_client, azure_openai_client


def get_clients_passwordless() -> Tuple[MongoClient, AzureOpenAI]:
    """
    Create MongoDB and Azure OpenAI clients using Azure Active Directory authentication.

    This method uses DefaultAzureCredential for passwordless authentication.
    More secure but requires proper Azure RBAC setup.

    Returns:
        Tuple containing MongoDB client and Azure OpenAI client

    Raises:
        ValueError: If required environment variables are missing
    """
    # Get MongoDB connection string (still needed even with passwordless auth)
    mongo_connection_string = os.getenv("MONGO_CONNECTION_STRING")
    if not mongo_connection_string:
        raise ValueError("MONGO_CONNECTION_STRING environment variable is required")

    # Create credential object for Azure authentication
    credential = DefaultAzureCredential()

    # Create MongoDB client with Azure AD token callback
    mongo_client = MongoClient(
        mongo_connection_string,
        maxPoolSize=50,
        minPoolSize=5,
        maxIdleTimeoutMS=30000,
        serverSelectionTimeoutMS=5000,
        socketTimeoutMS=20000,
        authMechanism='MONGODB-OIDC',
        authMechanismProperties={'REQUEST_TOKEN_CALLBACK': lambda: azure_identity_token_callback(credential)}
    )

    # Get Azure OpenAI endpoint
    azure_openai_endpoint = os.getenv("AZURE_OPENAI_EMBEDDING_ENDPOINT")
    if not azure_openai_endpoint:
        raise ValueError("AZURE_OPENAI_EMBEDDING_ENDPOINT environment variable is required")

    # Create Azure OpenAI client with credential-based authentication
    azure_openai_client = AzureOpenAI(
        azure_endpoint=azure_openai_endpoint,
        azure_ad_token_provider=lambda: credential.get_token("https://cognitiveservices.azure.com/.default").token,
        api_version=os.getenv("AZURE_OPENAI_EMBEDDING_API_VERSION", "2024-02-01")
    )

    return mongo_client, azure_openai_client


def azure_identity_token_callback(credential: DefaultAzureCredential) -> str:
    """
    Callback function to retrieve Azure AD token for MongoDB authentication.

    This function is called by the MongoDB driver when it needs an authentication token.
    The scope is specific to Cosmos DB for MongoDB.

    Args:
        credential: Azure credential object to use for token retrieval

    Returns:
        Access token string for MongoDB authentication
    """
    # Cosmos DB for MongoDB requires this specific scope
    token_scope = "https://cosmos.azure.com/.default"

    # Get token from Azure AD
    token = credential.get_token(token_scope)

    return token.token


def read_file_return_json(file_path: str) -> List[Dict[str, Any]]:
    """
    Read a JSON file and return its contents as a Python object.

    Args:
        file_path: Path to the JSON file to read

    Returns:
        List of dictionaries containing the JSON data

    Raises:
        FileNotFoundError: If the file doesn't exist
        json.JSONDecodeError: If the file contains invalid JSON
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as file:
            return json.load(file)
    except FileNotFoundError:
        print(f"Error: File '{file_path}' not found")
        raise
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON in file '{file_path}': {e}")
        raise


def write_file_json(data: List[Dict[str, Any]], file_path: str) -> None:
    """
    Write data to a JSON file with pretty formatting.

    Args:
        data: List of dictionaries to write to file
        file_path: Path where the JSON file should be saved

    Raises:
        IOError: If the file cannot be written
    """
    try:
        with open(file_path, 'w', encoding='utf-8') as file:
            json.dump(data, file, indent=2, ensure_ascii=False)
        print(f"Data successfully written to '{file_path}'")
    except IOError as e:
        print(f"Error writing to file '{file_path}': {e}")
        raise


def insert_data(collection: Collection, data: List[Dict[str, Any]],
                batch_size: int = 100, index_fields: Optional[List[str]] = None) -> Dict[str, int]:
    """
    Insert data into a MongoDB collection in batches with error handling.

    This function handles large datasets by processing them in smaller batches,
    which prevents memory issues and provides better error recovery.

    Args:
        collection: MongoDB collection to insert data into
        data: List of documents to insert
        batch_size: Number of documents to insert per batch (default: 100)
        index_fields: Optional list of field names to create indexes on

    Returns:
        Dictionary with insertion statistics: 'total', 'inserted', 'failed'
    """
    total_documents = len(data)
    inserted_count = 0
    failed_count = 0

    print(f"Starting batch insertion of {total_documents} documents...")

    # Create indexes if specified
    if index_fields:
        for field in index_fields:
            try:
                collection.create_index(field)
                print(f"Created index on field: {field}")
            except Exception as e:
                print(f"Warning: Could not create index on {field}: {e}")

    # Process data in batches to manage memory and error recovery
    for i in range(0, total_documents, batch_size):
        batch = data[i:i + batch_size]
        batch_num = (i // batch_size) + 1
        total_batches = (total_documents + batch_size - 1) // batch_size

        print(f"Processing batch {batch_num}/{total_batches} ({len(batch)} documents)...")

        try:
            # Prepare bulk insert operations
            operations = [InsertOne(document) for document in batch]

            # Execute bulk insert
            result = collection.bulk_write(operations, ordered=False)
            inserted_count += result.inserted_count

            print(f"Batch {batch_num} completed: {result.inserted_count} documents inserted")

        except BulkWriteError as e:
            # Handle partial failures in bulk operations
            inserted_count += e.details.get('nInserted', 0)
            failed_count += len(batch) - e.details.get('nInserted', 0)

            print(f"Batch {batch_num} had errors: {e.details.get('nInserted', 0)} inserted, "
                  f"{failed_count} failed")

            # Print specific error details for debugging
            for error in e.details.get('writeErrors', []):
                print(f"  Error: {error.get('errmsg', 'Unknown error')}")

        except Exception as e:
            # Handle unexpected errors
            failed_count += len(batch)
            print(f"Batch {batch_num} failed completely: {e}")

        # Small delay between batches to avoid overwhelming the database
        time.sleep(0.1)

    # Return summary statistics
    stats = {
        'total': total_documents,
        'inserted': inserted_count,
        'failed': failed_count
    }

    print(f"\nInsertion completed:")
    print(f"  Total documents: {stats['total']}")
    print(f"  Successfully inserted: {stats['inserted']}")
    print(f"  Failed: {stats['failed']}")

    return stats


def drop_vector_indexes(collection, vector_field: str) -> None:
    """
    Drop all existing vector indexes on the specified field.

    Since Cosmos DB for MongoDB (vCore) only allows one vector index per field,
    we need to drop any existing vector indexes before creating a new one.

    Args:
        collection: MongoDB collection to drop indexes from
        vector_field: Name of the vector field to drop indexes for
    """
    try:
        # Get all indexes for the collection
        indexes = list(collection.list_indexes())

        # Find vector indexes on the specified field
        vector_indexes = []
        for index in indexes:
            if 'key' in index and vector_field in index['key']:
                if index['key'][vector_field] == 'cosmosSearch':
                    vector_indexes.append(index['name'])

        # Drop each vector index found
        for index_name in vector_indexes:
            print(f"Dropping existing vector index: {index_name}")
            collection.drop_index(index_name)

        if vector_indexes:
            print(f"Dropped {len(vector_indexes)} existing vector index(es)")
        else:
            print("No existing vector indexes found to drop")

    except Exception as e:
        print(f"Warning: Could not drop existing vector indexes: {e}")
        # Continue anyway - the error might be that no indexes exist


def print_search_results(results: List[Dict[str, Any]],
                        max_results: int = 5,
                        show_score: bool = True) -> None:
    """
    Print search results in a formatted, readable way.

    Args:
        results: List of search result documents from MongoDB aggregation
        max_results: Maximum number of results to display (default: 5)
        show_score: Whether to display similarity scores (default: True)
    """
    if not results:
        print("No search results found.")
        return

    print(f"\nSearch Results (showing top {min(len(results), max_results)}):")
    print("=" * 80)

    for i, result in enumerate(results[:max_results], 1):
        print(f"\nResult {i}:")
        print("-" * 40)

        # Display similarity score if available and requested
        if show_score and 'score' in result:
            print(f"Similarity Score: {result['score']:.4f}")

        # Display hotel name and ID
        if 'HotelName' in result:
            print(f"Hotel: {result['HotelName']}")
        if 'HotelId' in result:
            print(f"Hotel ID: {result['HotelId']}")

        # Display description if available
        if 'Description' in result:
            description = result['Description']
            # Truncate very long descriptions for readability
            if len(description) > 200:
                description = description[:200] + "..."
            print(f"Description: {description}")

        # Display category and rating
        if 'Category' in result:
            print(f"Category: {result['Category']}")
        if 'Rating' in result and result['Rating'] is not None:
            print(f"Rating: {result['Rating']}")

        # Display address if available
        if 'Address' in result and result['Address']:
            address = result['Address']
            if isinstance(address, dict):
                address_parts = []
                if 'StreetAddress' in address:
                    address_parts.append(address['StreetAddress'])
                if 'City' in address:
                    address_parts.append(address['City'])
                if 'StateProvince' in address:
                    address_parts.append(address['StateProvince'])

                if address_parts:
                    print(f"Address: {', '.join(address_parts)}")

    if len(results) > max_results:
        print(f"\n... and {len(results) - max_results} more results")