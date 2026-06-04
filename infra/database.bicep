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

module vectorSearchContainers './cosmos-db/nosql/vector-containers.bicep' = {
  name: 'cosmos-db-vector-search-containers'
  params: {
    parentAccountName: cosmosDbAccount.outputs.name
    parentDatabaseName: cosmosDbDatabase.outputs.name
    tags: tags
    setThroughput: false
    partitionKeyPaths: [
      '/HotelId'
    ]
    vectorPath: '/DescriptionVector'
    vectorDimensions: 1536
  }
}

module createIndexDatabase './cosmos-db/nosql/database.bicep' = if (!empty(createIndexDatabaseName)) {
  name: 'cosmos-db-create-index-database'
  params: {
    name: createIndexDatabaseName
    parentAccountName: cosmosDbAccount.outputs.name
    tags: tags
    setThroughput: false
  }
}

module createIndexContainers './cosmos-db/nosql/vector-containers.bicep' = if (!empty(createIndexDatabaseName)) {
  name: 'cosmos-db-create-index-containers'
  params: {
    parentAccountName: cosmosDbAccount.outputs.name
    parentDatabaseName: createIndexDatabase!.outputs.name
    tags: tags
    setThroughput: false
    partitionKeyPaths: [
      '/PartitionKey'
    ]
    vectorPath: '/DescriptionVector'
    vectorDimensions: 1536
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
output containers array = vectorSearchContainers.outputs.containers
output createIndexDatabase object = !empty(createIndexDatabaseName)
  ? {
      name: createIndexDatabase!.outputs.name
    }
  : {}
output createIndexContainers array = !empty(createIndexDatabaseName)
  ? createIndexContainers!.outputs.containers
  : []

