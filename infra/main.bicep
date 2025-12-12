targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Name of the the environment which is used to generate a short unique hash used in all resources.')
param environmentName string

@description('Indicates if the deployment is being executed from a pipeline.')
param pipeline bool = false

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


@description('The name for the administrator login.')
param mongoAdmin string = 'app'

@secure()
@description('The password for the administrator login.')
param mongoPassword string = newGuid()

@description('Name of the Planner GPT model to deploy')
param gptPlannerModelName string = 'gpt-4o-mini'

@description('Version of the Planner GPT model to deploy')
param gptPlannerModelVersion string = '2024-07-18'

@description('API version for the Planner GPT model')
param gptPlannerApiVersion string = '2024-08-01-preview'

@description('Name of the Synth GPT model to deploy')
param gptSynthModelName string = 'gpt-4o'

@description('Version of the Synth GPT model to deploy')
param gptSynthModelVersion string = '2024-08-06'

@description('API version for the Synth GPT model')
param gptSynthApiVersion string = '2024-08-01-preview'

@description('Capacity of the GPT deployment')
param gptDeploymentCapacity int = 50

// Embedding model parameters
@description('Name of the embedding model to deploy')
param embeddingModelName string = 'text-embedding-3-small'

@description('Version of the embedding model to deploy')
param embeddingModelVersion string = '1'
param embeddingApiVersion string = '2023-05-15'

@description('Capacity of the embedding model deployment')
param embeddingDeploymentCapacity int = 50

var principalType = 'User'
@description('Id of the user or app to assign application roles')
param principalId string = ''

var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))
var tags = { 'azd-env-name': environmentName }

// Organize resources in a resource group
resource resourceGroup 'Microsoft.Resources/resourceGroups@2021-04-01' = {
    name: '${environmentName}-${resourceToken}-rg'
    location: location
    tags: tags
}

// Log Analytics Workspace for Container Apps
module logAnalytics 'br/public:avm/res/operational-insights/workspace:0.9.1' = {
  name: 'logAnalytics'
  scope: resourceGroup
  params: {
    name: '${resourceToken}-logs'
    location: location
    tags: tags
    skuName: 'PerGB2018'
    dataRetention: 30
  }
}

// User-assigned managed identity for the container app
module managedIdentity 'br/public:avm/res/managed-identity/user-assigned-identity:0.4.0' = {
  name: 'containerAppIdentity'
  scope: resourceGroup
  params: {
    name: '${resourceToken}-identity'
    location: location
    tags: tags
  }
}


var openAiServiceName = '${resourceToken}-openai'
module openAi 'br/public:avm/res/cognitive-services/account:0.7.1' = {
  name: 'openai'
  scope: resourceGroup
  params: {
    name: openAiServiceName
    location: location
    tags: tags
    kind: 'OpenAI'
    sku: 'S0'
    disableLocalAuth: false
    customSubDomainName: openAiServiceName
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
    deployments: [
      {
        name: gptPlannerModelName
        model: {
          format: 'OpenAI'
          name: gptPlannerModelName
          version: gptPlannerModelVersion
        }
        sku: {
          name: 'GlobalStandard'
          capacity: gptDeploymentCapacity
        }
      }
      {
        name: gptSynthModelName
        model: {
          format: 'OpenAI'
          name: gptSynthModelName
          version: gptSynthModelVersion
        }
        sku: {
          name: 'GlobalStandard'
          capacity: gptDeploymentCapacity
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
          name: 'GlobalStandard'
          capacity: embeddingDeploymentCapacity
        }
      }
    ]
    roleAssignments: [
      {
        principalId: principalId
        roleDefinitionIdOrName: 'Cognitive Services OpenAI User'
        principalType: principalType
      }
      {
        principalId: principalId
        roleDefinitionIdOrName: 'Cognitive Services OpenAI Contributor'
        principalType: principalType
      }
      {
        principalId: managedIdentity.outputs.principalId
        roleDefinitionIdOrName: 'Cognitive Services OpenAI User'
        principalType: 'ServicePrincipal'
      }
    ]
  }
}

module mongoCluster 'documentdb.bicep' = {
  name: 'mongo-cluster'
  scope: resourceGroup
  params: {
    name: 'docdb-${resourceToken}'
    location: location
    tags: tags
    managedIdentityPrincipalId: managedIdentity.outputs.principalId
    principalId: principalId
    pipeline: pipeline
    mongoAdmin: mongoAdmin
    mongoPassword: mongoPassword
  }
}


// Resources
output AZURE_LOCATION string = location
output AZURE_TENANT_ID string = tenant().tenantId
output AZURE_PRINCIPAL_ID string = managedIdentity.outputs.principalId
output AZURE_RESOURCE_GROUP string = resourceGroup.name

// OpenAI Resource
output AZURE_OPENAI_API_INSTANCE_NAME string = openAi.outputs.name
output AZURE_OPENAI_ENDPOINT string = openAi.outputs.endpoint
output AZURE_OPENAI_BASE_PATH string = 'https://${openAi.outputs.name}.openai.azure.com'

// Embedding resource
output AZURE_OPENAI_EMBEDDING_DEPLOYMENT string = embeddingModelName
output AZURE_OPENAI_EMBEDDING_MODEL string = embeddingModelName
output AZURE_OPENAI_EMBEDDING_API_VERSION string = embeddingApiVersion

// LLM resource - planner agent
output AZURE_OPENAI_PLANNER_DEPLOYMENT string = gptPlannerModelName
output AZURE_OPENAI_PLANNER_API_VERSION string = gptPlannerApiVersion

// LLM resource - synth agent
output AZURE_OPENAI_SYNTH_DEPLOYMENT string = gptSynthModelName
output AZURE_OPENAI_SYNTH_API_VERSION string = gptSynthApiVersion

// DocumentDB
output AZURE_DOCUMENTDB_INSTANCE string = mongoCluster.outputs.name
output AZURE_DOCUMENTDB_CONNECTION_STRING string = mongoCluster.outputs.connectionString
output AZURE_DOCUMENTDB_ENDPOINT string = mongoCluster.outputs.endpoint
output MONGO_CLUSTER_NAME string = mongoCluster.outputs.name
output MONGO_CONNECTION_STRING string = 'mongodb+srv://${mongoCluster.outputs.name}.global.mongocluster.cosmos.azure.com/?authMechanism=MONGODB-OIDC'
// Source code
output ENV_PATH string = '../'


