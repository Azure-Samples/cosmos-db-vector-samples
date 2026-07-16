metadata description = 'Create database accounts.'

param accountName string
param location string = resourceGroup().location
param tags object = {}
param managedIdentityPrincipalId string
param deploymentUserPrincipalId string = ''
param databaseName string

var database = {
  name: databaseName // Database for application
}

var containers = [
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
        {
          path: '/DescriptionVector/*'
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

module cosmosDbDatabase './cosmos-db/nosql/database.bicep' = {
  name: 'cosmos-db-database'  
  params: {
    name: database.name       
    parentAccountName: cosmosDbAccount.outputs.name
    tags: tags
    setThroughput: false
  }
}

module cosmosDbContainers './cosmos-db/nosql/container.bicep' = [
  for (container, index) in containers: {
    name: 'cosmos-db-container-${index}'  
    params: {
      name: container.name
      parentAccountName: cosmosDbAccount.outputs.name
      parentDatabaseName: cosmosDbDatabase.outputs.name
      tags: tags
      setThroughput: false
      partitionKeyPaths: container.partitionKeyPaths
      indexingPolicy: container.indexingPolicy
      vectorEmbeddingPolicy: container.vectorEmbeddingPolicy
    }
  }
]

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
    targetAccountName: cosmosDbAccount.outputs.name // Existing account
    roleDefinitionId: nosqlDefinition.outputs.id // New role definition
    principalId: deploymentUserPrincipalId ?? '' // Principal to assign role
    principalType: 'User' // Principal type for assigning role
  }
}

// Managed identity access to data plane
module nosqlManagedIdentityAssignment './cosmos-db/nosql/role/assignment.bicep' = if (!empty(managedIdentityPrincipalId)) {
  name: 'nosql-role-assignment-managed-identity'
  params: {
    targetAccountName: cosmosDbAccount.outputs.name // Existing account
    roleDefinitionId: nosqlDefinition.outputs.id // New role definition
    principalId: managedIdentityPrincipalId ?? '' // Principal to assign role
    principalType: 'ServicePrincipal' // Principal type for assigning role
  }
}

output endpoint string = cosmosDbAccount.outputs.endpoint
output accountName string = cosmosDbAccount.outputs.name

output database object = {
  name: cosmosDbDatabase.outputs.name
}
output containers array = [
  for (_, index) in containers: {
    name: cosmosDbContainers[index].outputs.name
  }
]

