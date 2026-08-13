using './main.bicep'

param environmentName = readEnvironmentVariable('AZURE_ENV_NAME', 'development')
param location = readEnvironmentVariable('AZURE_LOCATION', 'eastus2')
param deploymentUserPrincipalId = readEnvironmentVariable('AZURE_PRINCIPAL_ID', '')
param createIndexDatabaseName = readEnvironmentVariable('AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME', '')
