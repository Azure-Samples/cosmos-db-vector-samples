import json
import os
import time
from typing import Dict, List, Any, Optional, Tuple
from pymongo import MongoClient, InsertOne
from pymongo.collection import Collection
from pymongo.errors import BulkWriteError
from azure.identity import DefaultAzureCredential
from pymongo.auth_oidc import OIDCCallback, OIDCCallbackContext, OIDCCallbackResult
from openai import AzureOpenAI
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

class AzureIdentityTokenCallback(OIDCCallback):
    def __init__(self, credential):
        self.credential = credential

    def fetch(self, context: OIDCCallbackContext) -> OIDCCallbackResult:
        token = self.credential.get_token(
            "https://ossrdbms-aad.database.windows.net/.default").token
        return OIDCCallbackResult(access_token=token)

def get_clients() -> Tuple[MongoClient, AzureOpenAI]:

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

    # Get MongoDB cluster name for passwordless authentication
    cluster_name = os.getenv("MONGO_CLUSTER_NAME")
    if not cluster_name:
        raise ValueError("MONGO_CLUSTER_NAME environment variable is required")

    # Create credential object for Azure authentication
    credential = DefaultAzureCredential()

    authProperties = {"OIDC_CALLBACK": AzureIdentityTokenCallback(credential)}

    # Create MongoDB client with Azure AD token callback
    mongo_client = MongoClient(
        f"mongodb+srv://{cluster_name}.global.mongocluster.cosmos.azure.com/",
        connectTimeoutMS=120000,
        tls=True,
        retryWrites=True,
        authMechanism="MONGODB-OIDC",
        authMechanismProperties=authProperties
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

    # Cosmos DB for MongoDB requires this specific scope
    token_scope = "https://cosmos.azure.com/.default"

    # Get token from Azure AD
    token = credential.get_token(token_scope)

    return token.token


def read_file_return_json(file_path: str) -> List[Dict[str, Any]]:

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

    try:
        with open(file_path, 'w', encoding='utf-8') as file:
            json.dump(data, file, indent=2, ensure_ascii=False)
        print(f"Data successfully written to '{file_path}'")
    except IOError as e:
        print(f"Error writing to file '{file_path}': {e}")
        raise


def insert_data(collection: Collection, data: List[Dict[str, Any]],
                batch_size: int = 100, index_fields: Optional[List[str]] = None) -> Dict[str, int]:

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

    return stats


def drop_vector_indexes(collection, vector_field: str) -> None:

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


def print_search_resultsx(results: List[Dict[str, Any]],
                        max_results: int = 5,
                        show_score: bool = True) -> None:

    if not results:
        print("No search results found.")
        return

    print(f"\nSearch Results (showing top {min(len(results), max_results)}):")
    print("=" * 80)

    for i, result in enumerate(results[:max_results], 1):

        # Display hotel name and ID
        print(f"HotelName: {result['HotelName']}, Score: {result['score']:.4f}")

def print_search_results(results: List[Dict[str, Any]],
                        max_results: int = 5,
                        show_score: bool = True) -> None:

    if not results:
        print("No search results found.")
        return

    print(f"\nSearch Results (showing top {min(len(results), max_results)}):")
    print("=" * 80)

    for i, result in enumerate(results[:max_results], 1):

        # Check if results are nested under 'document' (when using $$ROOT)
        if 'document' in result:
            doc = result['document']
        else:
            doc = result

        # Display hotel name and ID
        print(f"HotelName: {doc['HotelName']}, Score: {result['score']:.4f}")


    if len(results) > max_results:
        print(f"\n... and {len(results) - max_results} more results")