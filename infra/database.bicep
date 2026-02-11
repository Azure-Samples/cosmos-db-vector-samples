metadata description = 'Create database accounts.'

param accountName string
param location string = resourceGroup().location
param tags object = {}

var database = {
  name: 'Hotels' // Database for application
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
    fullTextPolicy: {
      fullTextPaths: []
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
      fullTextPolicy: {
        fullTextPaths: []
      }
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
  name: 'cosmos-db-database-${database.name}'
  params: {
    name: database.name
    parentAccountName: cosmosDbAccount.outputs.name
    tags: tags
    setThroughput: false
  }
}

module cosmosDbContainers './cosmos-db/nosql/container.bicep' = [
  for (container, _) in containers: {
    name: 'cosmos-db-container-${container.name}'
    params: {
      name: container.name
      parentAccountName: cosmosDbAccount.outputs.name
      parentDatabaseName: cosmosDbDatabase.outputs.name
      tags: tags
      setThroughput: false
      partitionKeyPaths: container.partitionKeyPaths
      indexingPolicy: container.indexingPolicy
      vectorEmbeddingPolicy: container.vectorEmbeddingPolicy
      fullTextPolicy: container.fullTextPolicy
    }
  }
]

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
