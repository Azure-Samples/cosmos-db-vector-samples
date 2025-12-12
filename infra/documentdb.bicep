metadata description = 'Provisions resources for an Azure Cosmos DB for MongoDB vCore cluster.'

@description('The name of the Azure Cosmos DB for MongoDB vCore cluster.')
param name string

@description('Primary location for the resources.')
param location string

@description('Tags to be applied to the resource.')
param tags object

@description('Principal identifier of the identity that is deploying the template.')
param principalId string

@description('Principal identifier of the identity that is used for the web application.')
param managedIdentityPrincipalId string

@description('The password for the administrator login.')
param mongoAdmin string = 'app'

@secure()
@description('The password for the administrator login.')
param mongoPassword string = newGuid()

@description('Indicates if the deployment is being executed from a pipeline.')
param pipeline bool = false

resource mongoCluster 'Microsoft.DocumentDB/mongoClusters@2025-04-01-preview' = {
  name: name
  location: location
  tags: tags
  properties: {
    administrator: {
      userName: mongoAdmin
      password: mongoPassword
    }
    compute: {
      tier: 'M10'
    }
    sharding: {
      shardCount: 1
    }
    storage: {
      sizeGb: 32
    }
    highAvailability: {
      targetMode: 'Disabled'
    }
    publicNetworkAccess: 'Enabled'
    authConfig: {
      allowedModes: [
        'MicrosoftEntraID'
        'NativeAuth'
      ]
    }
  }
}

resource mongoClusterUserManagedIdentity 'Microsoft.DocumentDB/mongoClusters/users@2025-04-01-preview' = {
  parent: mongoCluster
  name: managedIdentityPrincipalId
  properties: {
    identityProvider: {
      type: 'MicrosoftEntraID'
      properties: {
        principalType: 'ServicePrincipal'
      }
    }
    roles: [
      {
        db: 'admin'
        role: 'dbOwner'
      }
    ]
  }
}

resource mongoClusterUserDeploymentIdentity 'Microsoft.DocumentDB/mongoClusters/users@2025-04-01-preview' = if (!pipeline && principalId != '' && principalId != managedIdentityPrincipalId) {
  parent: mongoCluster
  name: principalId
  properties: {
    identityProvider: {
      type: 'MicrosoftEntraID'
      properties: {
        principalType: 'User'
      }
    }
    roles: [
      {
        db: 'admin'
        role: 'dbOwner'
      }
    ]
  }
}

resource mongoClusterFirewallAllowAzure 'Microsoft.DocumentDB/mongoClusters/firewallRules@2025-04-01-preview' = {
  parent: mongoCluster
  name: 'allow-azure-services'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource mongoClusterFirewallAllowAll 'Microsoft.DocumentDB/mongoClusters/firewallRules@2025-04-01-preview' = {
  parent: mongoCluster
  name: 'allow-all-ip-addresses'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '255.255.255.255'
  }
}

output name string = mongoCluster.name
output resourceId string = mongoCluster.id
output endpoint string = '${mongoCluster.name}.global.mongocluster.cosmos.azure.com'
output connectionString string = 'mongodb://${mongoAdmin}:${mongoPassword}@${mongoCluster.name}.global.mongocluster.cosmos.azure.com:10255/?ssl=true&replicaSet=globaldb&retrywrites=false&maxIdleTimeMS=120000&appName=@${mongoCluster.name}@'
