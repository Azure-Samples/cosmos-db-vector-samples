targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Name of the the environment which is used to generate a short unique hash used in all resources.')
param environmentName string

@minLength(1)
@description('Location for the OpenAI resource')
// https://learn.microsoft.com/azure/ai-services/openai/concepts/models?tabs=python-secure%2Cglobal-standard%2Cstandard-chat-completions#models-by-deployment-type
@allowed([
  'eastus2'
  'swedencentral'
])
@metadata({
  azd: {
    type: 'location'
  }
})
param location string

@description('Id of the principal to assign database and application roles.')
param deploymentUserPrincipalId string = ''

var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))
var tags = { 'azd-env-name': environmentName }
var prefix = '${environmentName}${resourceToken}'

// Organize resources in a resource group
resource resourceGroup 'Microsoft.Resources/resourceGroups@2021-04-01' = {
    name: '${environmentName}-${resourceToken}-rg'
    location: location
    tags: tags
}

module managedIdentity 'br/public:avm/res/managed-identity/user-assigned-identity:0.4.0' = {
  name: 'user-assigned-identity'
  scope: resourceGroup
  params: {
    name: 'managed-identity-${prefix}'
    location: location
    tags: tags
  }
}

// Azure OpenAI model and configuration variables
var chatModelName = 'gpt-4o-mini'
var chatModelVersion = '2024-07-18'
var chatModelApiVersion = '2024-08-01-preview'

var embeddingModelName = 'text-embedding-3-small'
var embeddingModelVersion = '1'
var embeddingModelApiVersion = '2024-08-01-preview'

// Data and embedding configuration
var dataFileWithVectors = '../data/HotelsData_toCosmosDB_Vector.json'
var dataFileWithoutVectors = '../data/HotelsData_toCosmosDB.JSON'
var fieldToEmbed = 'Description'
var embeddedFieldName = 'DescriptionVector'
var embeddingDimensions = '1536'
var embeddingBatchSize = '16'
var loadSizeBatch = '50'

var openAiServiceName = 'openai-${prefix}'
module openAi 'br/public:avm/res/cognitive-services/account:0.7.1' = {
  name: 'openai'
  scope: resourceGroup
  params: {
    name: openAiServiceName
    location: location
    tags: tags
    kind: 'OpenAI'
    sku: 'S0'
    customSubDomainName: openAiServiceName
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
    deployments: [
      {
        name: chatModelName
        model: {
          format: 'OpenAI'
          name: chatModelName
          version: chatModelVersion
        }
        sku: {
          name: 'GlobalStandard'
          capacity: 50
        }
      }
      {
        name: embeddingModelName
        model: {
          format: 'OpenAI'
          name: embeddingModelName
          version: embeddingModelVersion
        }
        sku: {
          name: 'Standard'
          capacity: 10
        }
      }
    ]
    roleAssignments: concat(
      [
        {
          principalId: managedIdentity.outputs.principalId
          roleDefinitionIdOrName: 'Cognitive Services OpenAI User'
        }
      ],
      !empty(deploymentUserPrincipalId) ? [
        {
          principalId: deploymentUserPrincipalId
          roleDefinitionIdOrName: 'Cognitive Services OpenAI User'
        }
      ] : []
    )
  }
}

var databaseName = 'Hotels'

module cosmosDbAccount 'br/public:avm/res/document-db/database-account:0.8.1' = {
  name: 'cosmos-db-account'
  scope: resourceGroup
  params: {
    name: 'cosmos-db-nosql-${prefix}'
    location: location
    locations: [
      {
        failoverPriority: 0
        locationName: location
        isZoneRedundant: false
      }
    ]
    tags: tags
    disableKeyBasedMetadataWriteAccess: true
    disableLocalAuth: true
    networkRestrictions: {
      publicNetworkAccess: 'Enabled'
      ipRules: []
      virtualNetworkRules: []
    }
    capabilitiesToAdd: [
      'EnableServerless'
    ]
    sqlRoleDefinitions: [
      {
        name: 'nosql-data-plane-contributor'
        dataAction: [
          'Microsoft.DocumentDB/databaseAccounts/readMetadata'
          'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/items/*'
          'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/*'
        ]
      }
    ]
    sqlRoleAssignmentsPrincipalIds: concat(
      [
        managedIdentity.outputs.principalId
      ],
      !empty(deploymentUserPrincipalId) ? [deploymentUserPrincipalId] : []
    )
    sqlDatabases: [
      {
        name: databaseName
        containers: [
          {
            name: 'hotels_diskann'
            paths: [
              '/HotelId'
            ]
          }
          {
            name: 'hotels_flat'
            paths: [
              '/HotelId'
            ]
          }
          {
            name: 'hotels_quantizedflat'
            paths: [
              '/HotelId'
            ]
          }
        ]
      }
    ]
  }
}

output AZURE_LOCATION string = location
output AZURE_TENANT_ID string = tenant().tenantId
output AZURE_RESOURCE_GROUP string = resourceGroup.name

// Specific to Azure OpenAI
output AZURE_OPENAI_SERVICE string = openAi.outputs.name
output AZURE_OPENAI_ENDPOINT string = openAi.outputs.endpoint

output AZURE_OPENAI_CHAT_MODEL string = chatModelName
output AZURE_OPENAI_CHAT_DEPLOYMENT string = chatModelName
output AZURE_OPENAI_CHAT_ENDPOINT string = openAi.outputs.endpoint
output AZURE_OPENAI_CHAT_API_VERSION string = chatModelApiVersion

output AZURE_OPENAI_EMBEDDING_MODEL string = embeddingModelName
output AZURE_OPENAI_EMBEDDING_DEPLOYMENT string = embeddingModelName
output AZURE_OPENAI_EMBEDDING_ENDPOINT string = openAi.outputs.endpoint
output AZURE_OPENAI_EMBEDDING_API_VERSION string = embeddingModelApiVersion

// Environment variables needed by utils.ts
output COSMOS_ENDPOINT string = cosmosDbAccount.outputs.endpoint
output AZURE_COSMOSDB_DATABASENAME string = databaseName

// Configuration for embedding creation and vector search
output DATA_FILE_WITH_VECTORS string = dataFileWithVectors
output DATA_FILE_WITHOUT_VECTORS string = dataFileWithoutVectors
output FIELD_TO_EMBED string = fieldToEmbed
output EMBEDDED_FIELD string = embeddedFieldName
output EMBEDDING_DIMENSIONS string = embeddingDimensions
output EMBEDDING_BATCH_SIZE string = embeddingBatchSize
output LOAD_SIZE_BATCH string = loadSizeBatch
