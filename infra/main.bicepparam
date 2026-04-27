using './main.bicep'

param environmentName = readEnvironmentVariable('AZURE_ENV_NAME', 'development')
param location = readEnvironmentVariable('AZURE_LOCATION', 'eastus2')
param openAiLocation = readEnvironmentVariable('AZURE_OPENAI_LOCATION', readEnvironmentVariable('AZURE_LOCATION', 'eastus2'))
param deploymentUserPrincipalId = readEnvironmentVariable('AZURE_PRINCIPAL_ID', '')

// OpenAI model configuration
param chatModelName = readEnvironmentVariable('AZURE_OPENAI_CHAT_MODEL', 'gpt-4.1-mini')
param chatModelVersion = readEnvironmentVariable('AZURE_OPENAI_CHAT_MODEL_VERSION', '2025-04-14')
param chatModelSkuName = readEnvironmentVariable('AZURE_OPENAI_CHAT_MODEL_TYPE', 'Standard')
param embeddingModelName = readEnvironmentVariable('AZURE_OPENAI_EMBEDDING_MODEL', 'text-embedding-3-small')
param embeddingModelVersion = readEnvironmentVariable('AZURE_OPENAI_EMBEDDING_MODEL_VERSION', '1')
param embeddingModelSkuName = readEnvironmentVariable('AZURE_OPENAI_EMBEDDING_MODEL_TYPE', 'Standard')
