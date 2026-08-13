metadata description = 'Create database accounts.'

param accountName string
param location string = resourceGroup().location
param tags object = {}
param managedIdentityPrincipalId string
param deploymentUserPrincipalId string = ''
param databaseName string
param createIndexDatabaseName string = ''

var database = {
  name: databaseName // Database for existing vector-search samples
}

var vectorSearchContainerDefinitions = [
  {
    name: 'hotels_diskann'
    partitionKeyPaths: [
      '/HotelId'
    ]
    indexingPolicy: {
      indexingMode: 'consistent'
      automatic: true
      includedPaths: [
        {
          path: '/*'
        }
      ]
      excludedPaths: [
        {
          path: '/_etag/?'
        }
      ]
      vectorIndexes: [
        {
          path: '/DescriptionVector'
          type: 'diskANN'
        }
      ]
    }
    vectorEmbeddingPolicy: {
      vectorEmbeddings: [
        {
          path: '/DescriptionVector'
          dataType: 'float32'
          dimensions: 1536
          distanceFunction: 'cosine'
        }
      ]
    }
  }
  {
    name: 'hotels_quantizedflat'
    partitionKeyPaths: [
      '/HotelId'
    ]
    indexingPolicy: {
      indexingMode: 'consistent'
      automatic: true
      includedPaths: [
        {
          path: '/*'
        }
      ]
      excludedPaths: [
        {
          path: '/_etag/?'
        }
        {
          path: '/DescriptionVector/*'
        }
      ]
      vectorIndexes: [
        {
          path: '/DescriptionVector'
          type: 'quantizedFlat'
        }
      ]
    }
    vectorEmbeddingPolicy: {
      vectorEmbeddings: [
        {
          path: '/DescriptionVector'
          dataType: 'float32'
          dimensions: 1536
          distanceFunction: 'cosine'
        }
      ]
    }
  }
]



module cosmosDbAccount './cosmos-db/nosql/account.bicep' = {
  name: 'cosmos-db-account'
  params: {
    name: accountName
    location: location
    tags: tags
    enableServerless: true
    enableVectorSearch: true
    enableNoSQLFullTextSearch: true
    disableKeyBasedAuth: true

  }
}

// Vector-search database (only if createIndexDatabaseName is NOT provided)
module cosmosDbDatabase './cosmos-db/nosql/database.bicep' = if (empty(createIndexDatabaseName)) {
  name: 'cosmos-db-database'
  params: {
    name: database.name
    parentAccountName: cosmosDbAccount.outputs.name
    tags: tags
    setThroughput: false
  }
}

// Vector-search containers (only if createIndexDatabaseName is NOT provided)
module vectorSearchContainers './cosmos-db/nosql/container.bicep' = [
  for (container, index) in vectorSearchContainerDefinitions: if (empty(createIndexDatabaseName)) {
    name: 'cosmos-db-vector-search-container-${index}'
    params: {
      name: container.name
      parentAccountName: cosmosDbAccount.outputs.name
      parentDatabaseName: cosmosDbDatabase!.outputs.name
      tags: tags
      setThroughput: false
      partitionKeyPaths: container.partitionKeyPaths
      indexingPolicy: container.indexingPolicy
      vectorEmbeddingPolicy: container.vectorEmbeddingPolicy
    }
  }
]

// Create-index database and containers (only if createIndexDatabaseName parameter is provided)
module createIndexDatabase './cosmos-db/nosql/database.bicep' = if (!empty(createIndexDatabaseName)) {
  name: 'cosmos-db-create-index-database'
  params: {
    name: createIndexDatabaseName
    parentAccountName: cosmosDbAccount.outputs.name
    tags: tags
    setThroughput: false
  }
}

// Access to data plane only
// no access to control plane (e.g. creating databases, containers, etc.)
module nosqlDefinition './cosmos-db/nosql/role/definition.bicep' = {
  name: 'nosql-role-definition'
  params: {
    targetAccountName: cosmosDbAccount.outputs.name
    definitionName: 'Write to Azure Cosmos DB for NoSQL data plane' // Custom role name
    permissionsDataActions: [
      'Microsoft.DocumentDB/databaseAccounts/readMetadata' // Read account metadata
      'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/items/*' // Create items
      'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/*' // Manage items
    ]
  }
}

// User access to data plane
module nosqlUserAssignment './cosmos-db/nosql/role/assignment.bicep' = if (!empty(deploymentUserPrincipalId)) {
  name: 'nosql-role-assignment-user'
  params: {
    targetAccountName: cosmosDbAccount.outputs.name
    roleDefinitionId: nosqlDefinition.outputs.id
    principalId: deploymentUserPrincipalId ?? ''
  }
}

// Managed identity access to data plane
module nosqlManagedIdentityAssignment './cosmos-db/nosql/role/assignment.bicep' = if (!empty(managedIdentityPrincipalId)) {
  name: 'nosql-role-assignment-managed-identity'
  params: {
    targetAccountName: cosmosDbAccount.outputs.name
    roleDefinitionId: nosqlDefinition.outputs.id
    principalId: managedIdentityPrincipalId ?? ''
  }
}

output endpoint string = cosmosDbAccount.outputs.endpoint
output accountName string = cosmosDbAccount.outputs.name

output database object = !empty(createIndexDatabaseName)
  ? {}
  : {
      name: cosmosDbDatabase!.outputs.name
    }

output containers array = !empty(createIndexDatabaseName)
  ? []
  : [
      {
        name: vectorSearchContainers[0].outputs.name
      }
      {
        name: vectorSearchContainers[1].outputs.name
      }
    ]

output createIndexDatabase object = !empty(createIndexDatabaseName)
  ? {
      name: createIndexDatabase!.outputs.name
    }
  : {}

output embeddedFieldNameForVectorSearch string = 'DescriptionVector'
output embeddedFieldNameForCreateIndex string = 'embedding'

output partitionKeyPathForVectorSearch string = '/HotelId'
output partitionKeyPathForCreateIndex string = '/Region'

