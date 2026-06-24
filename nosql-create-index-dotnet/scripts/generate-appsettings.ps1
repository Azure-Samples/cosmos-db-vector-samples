<#
.SYNOPSIS
    Generate appsettings.json for the .NET create-index sample from azd environment values.

.DESCRIPTION
    Uses `azd env get-values` to retrieve environment variables and creates a valid
    appsettings.json file that the .NET sample can read. Validates required values
    before writing the file.

.PARAMETER OutputPath
    Path where appsettings.json will be written. Defaults to the dotnet sample root.

.PARAMETER SkipValidation
    If specified, skips validation of required fields (useful for partial configs).

.EXAMPLE
    PS> .\generate-appsettings.ps1
    # Generates appsettings.json in the current sample root

    PS> .\generate-appsettings.ps1 -OutputPath "C:\custom\path\appsettings.json"
    # Writes to custom location

    PS> .\generate-appsettings.ps1 -SkipValidation
    # Generates even if some fields are missing
#>

param(
    [Parameter(Mandatory = $false)]
    [string]$OutputPath = (Join-Path $PSScriptRoot ".." "appsettings.json"),
    
    [Parameter(Mandatory = $false)]
    [switch]$SkipValidation
)

# Resolve to absolute path
$OutputPath = [System.IO.Path]::GetFullPath($OutputPath)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Generate appsettings.json for .NET Sample" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Retrieve azd environment values
Write-Host "Retrieving azd environment values..." -ForegroundColor Yellow
try {
    $azdOutput = @()
    $azdOutput = azd env get-values 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Failed to run 'azd env get-values'" -ForegroundColor Red
        Write-Host "Make sure you've run 'azd up' or 'azd env new' first" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "ERROR: Could not execute azd command: $_" -ForegroundColor Red
    exit 1
}

# Parse azd output into a hashtable
$envValues = @{}
foreach ($line in $azdOutput) {
    if ($line -match "^([^=]+)=(.*)$") {
        $key = $matches[1].Trim()
        $value = $matches[2].Trim()
        # Remove surrounding quotes if present
        if ($value.StartsWith('"') -and $value.EndsWith('"')) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        $envValues[$key] = $value
    }
}

Write-Host "Retrieved values: $($envValues.Count) environment variables" -ForegroundColor Green
Write-Host ""

# Extract specific values with fallbacks
$cosmosDbEndpoint = $envValues['AZURE_COSMOSDB_ENDPOINT'] ?? ""
$databaseName = $envValues['AZURE_COSMOSDB_DATABASENAME'] ?? "HotelsCreateIndex"
$containerName = $envValues['AZURE_COSMOSDB_CONTAINER_NAME'] ?? ""
$embeddedField = $envValues['AZURE_COSMOSDB_CREATE_INDEX_EMBEDDED_FIELD'] ?? "embedding"
$openAiEndpoint = $envValues['AZURE_OPENAI_ENDPOINT'] ?? ""
$openAiDeployment = $envValues['AZURE_OPENAI_EMBEDDING_DEPLOYMENT'] ?? "text-embedding-3-small"
$openAiApiVersion = $envValues['AZURE_OPENAI_EMBEDDING_API_VERSION'] ?? "2024-08-01-preview"
$vectorAlgorithm = $envValues['VECTOR_ALGORITHM'] ?? ""
$partitionKeyValue = $envValues['PARTITION_KEY_VALUE'] ?? "Northeast"
$dataFile = $envValues['DATA_FILE_WITH_VECTORS_AND_REGIONS'] ?? "./data/HotelsData_toCosmosDB_Vector_byRegion.json"
$subscriptionId = $envValues['AZURE_SUBSCRIPTION_ID'] ?? ""
$resourceGroup = $envValues['AZURE_RESOURCE_GROUP'] ?? ""
$accountName = $envValues['AZURE_COSMOSDB_ACCOUNT_NAME'] ?? ""

# Validate required fields
$missingFields = @()
if ([string]::IsNullOrWhiteSpace($cosmosDbEndpoint)) { $missingFields += "AZURE_COSMOSDB_ENDPOINT" }
if ([string]::IsNullOrWhiteSpace($openAiEndpoint)) { $missingFields += "AZURE_OPENAI_ENDPOINT" }

if ($missingFields.Count -gt 0 -and -not $SkipValidation) {
    Write-Host "ERROR: Missing required environment variables from azd:" -ForegroundColor Red
    $missingFields | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    Write-Host ""
    Write-Host "Run with -SkipValidation to generate with empty values (not recommended)" -ForegroundColor Yellow
    exit 1
}

# Build the appsettings object
$appsettings = @{
    "CosmosDbSettings" = @{
        "Endpoint"        = $cosmosDbEndpoint
        "DatabaseName"    = $databaseName
        "ContainerName"   = $containerName
        "PartitionKeyValue" = $partitionKeyValue
        "SubscriptionId"  = $subscriptionId
        "ResourceGroup"   = $resourceGroup
        "AccountName"     = $accountName
    }
    "OpenAiSettings" = @{
        "Endpoint"   = $openAiEndpoint
        "Deployment" = $openAiDeployment
        "ApiVersion" = $openAiApiVersion
    }
    "VectorAlgorithm" = $vectorAlgorithm
    "EmbeddedField"   = $embeddedField
    "DataFilePath"    = $dataFile
}

# Ensure output directory exists
$outputDir = [System.IO.Path]::GetDirectoryName($OutputPath)
if (-not (Test-Path $outputDir)) {
    Write-Host "Creating output directory: $outputDir" -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

# Convert to JSON and write with UTF-8 NoBOM encoding (Windows-compatible)
try {
    $jsonContent = $appsettings | ConvertTo-Json -Depth 10
    Out-File -FilePath $OutputPath -InputObject $jsonContent -Encoding utf8NoBOM -Force
    Write-Host "✓ Generated: $OutputPath" -ForegroundColor Green
    Write-Host ""
} catch {
    Write-Host "ERROR: Failed to write appsettings.json: $_" -ForegroundColor Red
    exit 1
}

# Display summary
Write-Host "Configuration Summary:" -ForegroundColor Cyan
Write-Host "  Cosmos DB Endpoint:    $($cosmosDbEndpoint.Substring(0, [Math]::Min(50, $cosmosDbEndpoint.Length)))..." -ForegroundColor Gray
Write-Host "  Database:              $databaseName" -ForegroundColor Gray
Write-Host "  Container:             $(if ([string]::IsNullOrWhiteSpace($containerName)) { '(empty - will use both)' } else { $containerName })" -ForegroundColor Gray
Write-Host "  Embedded Field:        $embeddedField" -ForegroundColor Gray
Write-Host "  OpenAI Endpoint:       $($openAiEndpoint.Substring(0, [Math]::Min(50, $openAiEndpoint.Length)))..." -ForegroundColor Gray
Write-Host "  OpenAI Deployment:     $openAiDeployment" -ForegroundColor Gray
Write-Host "  Data File:             $dataFile" -ForegroundColor Gray
Write-Host ""

Write-Host "✓ appsettings.json is ready for use with 'dotnet run'" -ForegroundColor Green
Write-Host ""
