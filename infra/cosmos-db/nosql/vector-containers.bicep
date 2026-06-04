metadata description = 'Create DiskANN and QuantizedFlat Azure Cosmos DB for NoSQL containers.'

param parentAccountName string
param parentDatabaseName string
param tags object = {}

@description('Enables throughput setting at this resource level. Defaults to false.')
param setThroughput bool = false

@description('Enables autoscale. If setThroughput is enabled, defaults to false.')
param autoscale bool = false

@description('The amount of throughput set. If setThroughput is enabled, defaults to 400.')
param throughput int = 400

@description('List of hierarhical partition key paths applied to both containers.')
param partitionKeyPaths string[]

@description('Vector field path applied to both containers.')
param vectorPath string

@description('Embedding dimensions applied to both containers.')
param vectorDimensions int = 1536

@description('Distance function applied to both containers.')
param distanceFunction string = 'cosine'

@description('Name of the DiskANN container.')
param diskAnnContainerName string = 'hotels_diskann'

@description('Name of the QuantizedFlat container.')
param quantizedFlatContainerName string = 'hotels_quantizedflat'

var containers = [
  {
    name: diskAnnContainerName
    vectorIndexType: 'diskANN'
    excludedPaths: [
      {
        path: '/_etag/?'
      }
    ]
  }
  {
    name: quantizedFlatContainerName
    vectorIndexType: 'quantizedFlat'
    excludedPaths: [
      {
        path: '/_etag/?'
      }
      {
        path: '${vectorPath}/*'
      }
    ]
  }
]

module vectorContainers './container.bicep' = [
  for (container, index) in containers: {
    name: 'vector-container-${index}'
    params: {
      name: container.name
      parentAccountName: parentAccountName
      parentDatabaseName: parentDatabaseName
      tags: tags
      setThroughput: setThroughput
      autoscale: autoscale
      throughput: throughput
      partitionKeyPaths: partitionKeyPaths
      indexingPolicy: {
        indexingMode: 'consistent'
        automatic: true
        includedPaths: [
          {
            path: '/*'
          }
        ]
        excludedPaths: container.excludedPaths
        vectorIndexes: [
          {
            path: vectorPath
            type: container.vectorIndexType
          }
        ]
      }
      vectorEmbeddingPolicy: {
        vectorEmbeddings: [
          {
            path: vectorPath
            dataType: 'float32'
            dimensions: vectorDimensions
            distanceFunction: distanceFunction
          }
        ]
      }
    }
  }
]

output containers array = [
  for (container, index) in containers: {
    name: vectorContainers[index].outputs.name
    vectorIndexType: container.vectorIndexType
    partitionKeyPaths: partitionKeyPaths
    vectorPath: vectorPath
    dimensions: vectorDimensions
  }
]
