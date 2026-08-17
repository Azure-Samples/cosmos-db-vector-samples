#!/bin/bash

#
# generate-appsettings.sh
#
# Generate appsettings.json for the .NET create-index sample from azd environment values.
#
# Usage:
#   ./generate-appsettings.sh                           # Generate in sample root
#   ./generate-appsettings.sh /custom/path/appsettings.json  # Generate at custom path
#   ./generate-appsettings.sh --skip-validation        # Skip required field checks
#

set -euo pipefail

# Default output path
OUTPUT_PATH="${1:-.}/appsettings.json"
SKIP_VALIDATION="${2:-}"

# Resolve to absolute path
OUTPUT_PATH="$(cd "$(dirname "$OUTPUT_PATH")" && pwd)/$(basename "$OUTPUT_PATH")"

echo "========================================"
echo "Generate appsettings.json for .NET Sample"
echo "========================================"
echo ""

# Retrieve azd environment values
echo "Retrieving azd environment values..."
if ! azd_output=$(azd env get-values 2>&1); then
    echo "ERROR: Failed to run 'azd env get-values'"
    echo "Make sure you've run 'azd up' or 'azd env new' first"
    exit 1
fi

# Parse azd output into associative arrays
declare -A env_values

while IFS='=' read -r key value; do
    if [[ -n "$key" ]]; then
        # Remove surrounding quotes if present
        value="${value%\"}"
        value="${value#\"}"
        env_values["$key"]="$value"
    fi
done <<< "$azd_output"

echo "Retrieved values: ${#env_values[@]} environment variables"
echo ""

# Extract specific values with fallbacks
cosmos_db_endpoint="${env_values[AZURE_COSMOSDB_ENDPOINT]:-}"
database_name="${env_values[AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME]:-HotelsCreateIndex}"
container_name="${env_values[AZURE_COSMOSDB_CONTAINER_NAME]:-}"
diskann_container_name="${env_values[AZURE_COSMOSDB_CREATE_INDEX_DISKANN_CONTAINER_NAME]:-hotels_diskann}"
quantizedflat_container_name="${env_values[AZURE_COSMOSDB_CREATE_INDEX_QUANTIZEDFLAT_CONTAINER_NAME]:-hotels_quantizedflat}"
allow_custom_container_deletion="${env_values[AZURE_COSMOSDB_CREATE_INDEX_ALLOW_CUSTOM_CONTAINER_DELETION]:-false}"
embedded_field="${env_values[AZURE_COSMOSDB_CREATE_INDEX_EMBEDDED_FIELD]:-embedding}"
open_ai_endpoint="${env_values[AZURE_OPENAI_EMBEDDING_ENDPOINT]:-${env_values[AZURE_OPENAI_ENDPOINT]:-}}"
open_ai_deployment="${env_values[AZURE_OPENAI_EMBEDDING_DEPLOYMENT]:-text-embedding-3-small}"
open_ai_api_version="${env_values[AZURE_OPENAI_EMBEDDING_API_VERSION]:-2024-08-01-preview}"
vector_algorithm="${env_values[VECTOR_ALGORITHM]:-}"
partition_key_value="${env_values[PARTITION_KEY_VALUE]:-Northeast}"
data_file="${env_values[DATA_FILE_WITH_VECTORS_AND_REGIONS]:-./data/HotelsData_toCosmosDB_Vector_byRegion.json}"
subscription_id="${env_values[AZURE_SUBSCRIPTION_ID]:-}"
resource_group="${env_values[AZURE_RESOURCE_GROUP]:-}"
account_name="${env_values[AZURE_COSMOSDB_ACCOUNT_NAME]:-}"
location="${env_values[AZURE_LOCATION]:-}"

# Validate required fields
missing_fields=()
[[ -z "$cosmos_db_endpoint" ]] && missing_fields+=("AZURE_COSMOSDB_ENDPOINT")
[[ -z "$database_name" ]] && missing_fields+=("AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME")
[[ -z "$open_ai_endpoint" ]] && missing_fields+=("AZURE_OPENAI_EMBEDDING_ENDPOINT")
[[ -z "$open_ai_deployment" ]] && missing_fields+=("AZURE_OPENAI_EMBEDDING_DEPLOYMENT")
[[ -z "$subscription_id" ]] && missing_fields+=("AZURE_SUBSCRIPTION_ID")
[[ -z "$resource_group" ]] && missing_fields+=("AZURE_RESOURCE_GROUP")
[[ -z "$account_name" ]] && missing_fields+=("AZURE_COSMOSDB_ACCOUNT_NAME")
[[ -z "$location" ]] && missing_fields+=("AZURE_LOCATION")
[[ -z "$data_file" ]] && missing_fields+=("DATA_FILE_WITH_VECTORS_AND_REGIONS")

if [[ ! "$allow_custom_container_deletion" =~ ^([Tt][Rr][Uu][Ee]|[Ff][Aa][Ll][Ss][Ee])$ ]]; then
    echo "ERROR: AZURE_COSMOSDB_CREATE_INDEX_ALLOW_CUSTOM_CONTAINER_DELETION must be true or false."
    exit 1
fi
allow_custom_container_deletion="${allow_custom_container_deletion,,}"
if [[ "${diskann_container_name,,}" == "${quantizedflat_container_name,,}" ]]; then
    echo "ERROR: DiskANN and QuantizedFlat container names must be different (case-insensitive)."
    exit 1
fi
if [[ "$diskann_container_name" != "hotels_diskann" ||
      "$quantizedflat_container_name" != "hotels_quantizedflat" ]] &&
   [[ "$allow_custom_container_deletion" != "true" ]]; then
    echo "ERROR: Custom container names require AZURE_COSMOSDB_CREATE_INDEX_ALLOW_CUSTOM_CONTAINER_DELETION=true."
    exit 1
fi

if [[ ${#missing_fields[@]} -gt 0 ]] && [[ -z "$SKIP_VALIDATION" ]]; then
    echo "ERROR: Missing required environment variables from azd:"
    for field in "${missing_fields[@]}"; do
        echo "  - $field"
    done
    echo ""
    echo "Run with --skip-validation to generate with empty values (not recommended)"
    exit 1
fi

# Ensure output directory exists
output_dir="$(dirname "$OUTPUT_PATH")"
mkdir -p "$output_dir"

# Build the appsettings.json content
cat > "$OUTPUT_PATH" <<EOF
{
  "CosmosDbSettings": {
    "Endpoint": "$cosmos_db_endpoint",
    "DatabaseName": "$database_name",
    "ContainerName": "$container_name",
    "PartitionKeyValue": "$partition_key_value",
    "SubscriptionId": "$subscription_id",
    "ResourceGroup": "$resource_group",
    "AccountName": "$account_name",
    "Location": "$location",
    "DiskANNContainerName": "$diskann_container_name",
    "QuantizedFlatContainerName": "$quantizedflat_container_name",
    "AllowCustomContainerDeletion": $allow_custom_container_deletion
  },
  "OpenAiSettings": {
    "Endpoint": "$open_ai_endpoint",
    "Deployment": "$open_ai_deployment",
    "ApiVersion": "$open_ai_api_version"
  },
  "VectorAlgorithm": "$vector_algorithm",
  "EmbeddedField": "$embedded_field",
  "DataFilePath": "$data_file"
}
EOF

if ! grep -Fq "\"DatabaseName\": \"$database_name\"" "$OUTPUT_PATH" ||
   ! grep -Fq "\"Location\": \"$location\"" "$OUTPUT_PATH" ||
   ! grep -Fq "\"DiskANNContainerName\": \"$diskann_container_name\"" "$OUTPUT_PATH" ||
   ! grep -Fq "\"QuantizedFlatContainerName\": \"$quantizedflat_container_name\"" "$OUTPUT_PATH"; then
    echo "ERROR: Generated settings validation failed."
    exit 1
fi

echo "✓ Generated: $OUTPUT_PATH"
echo ""

# Display summary
echo "Configuration Summary:"
echo "  Cosmos DB Endpoint:    ${cosmos_db_endpoint:0:50}..."
echo "  Database:              $database_name"
echo "  Container:             ${container_name:-'(empty - will use both)'}"
echo "  Embedded Field:        $embedded_field"
echo "  OpenAI Endpoint:       ${open_ai_endpoint:0:50}..."
echo "  OpenAI Deployment:     $open_ai_deployment"
echo "  Data File:             $data_file"
echo ""

echo "✓ appsettings.json is ready for use with 'dotnet run'"
echo ""
