targetScope = 'resourceGroup'

param location string
param cosmosAccountName string
param databaseName string
param resourceGroupName string
param managedIdentityResourceId string

// Deployment script to configure vector policies and indexes using Azure CLI
resource configureVectorIndexes 'Microsoft.Resources/deploymentScripts@2023-08-01' = {
  name: 'configure-vector-indexes'
  location: location
  kind: 'AzureCLI'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentityResourceId}': {}
    }
  }
  properties: {
    azCliVersion: '2.54.0'
    retentionInterval: 'PT1H'
    scriptContent: '''
      set -e
      
      ACCOUNT_NAME="${accountName}"
      RESOURCE_GROUP="${resourceGroupName}"
      DB_NAME="${databaseName}"
      
      # Function to configure vector index for a container
      configureContainer() {
        local CONTAINER_NAME=$1
        local ALGO_TYPE=$2
        
        echo "Configuring $CONTAINER_NAME with $ALGO_TYPE algorithm..."
        
        # Create policy file with vector embedding and indexing configuration
        cat > /tmp/policy.json <<EOF
{
  "indexingMode": "consistent",
  "automatic": true,
  "includedPaths": [
    {
      "path": "/*"
    }
  ],
  "excludedPaths": [
    {
      "path": "/_etag/?"
    }
  ],
  "vectorIndexes": [
    {
      "path": "/DescriptionVector",
      "type": "${ALGO_TYPE}"
    }
  ],
  "vectorEmbeddingPolicy": {
    "vectorEmbeddings": [
      {
        "path": "/DescriptionVector",
        "dataType": "float32",
        "dimensions": 1536,
        "distanceFunction": "cosine"
      }
    ]
  }
}
EOF
        
        # Update container with policy file
        az cosmosdb sql container update \
          --account-name "$ACCOUNT_NAME" \
          --database-name "$DB_NAME" \
          --name "$CONTAINER_NAME" \
          --resource-group "$RESOURCE_GROUP" \
          --idx @/tmp/policy.json
        
        echo "Completed configuration for $CONTAINER_NAME"
      }
      
      # Configure all three containers
      configureContainer "hotels_diskann" "diskANN"
      configureContainer "hotels_quantizedflat" "quantizedFlat"
      configureContainer "hotels_flat" "flat"
      
      echo "Vector index configuration complete"
    '''
    environmentVariables: [
      {
        name: 'accountName'
        value: cosmosAccountName
      }
      {
        name: 'resourceGroupName'
        value: resourceGroupName
      }
      {
        name: 'databaseName'
        value: databaseName
      }
    ]
    cleanupPreference: 'OnSuccess'
  }
}

output deploymentScriptId string = configureVectorIndexes.id
