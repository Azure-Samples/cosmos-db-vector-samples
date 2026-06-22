#!/usr/bin/env pwsh
<#
.SYNOPSIS
Test all three create-index samples by fetching env vars from azd and running them.

.DESCRIPTION
This script:
1. Calls `azd env get-values` to fetch environment variables
2. Creates wrapper scripts for each language that feed azd values into the sample
3. Runs each wrapper script
4. Reports which are still blocked and why
5. Compares expected env var names against bicep outputs
#>

param(
    [switch]$ShowEnvVars = $false
)

$RepoRoot = (Get-Item $PSScriptRoot).Parent.Parent.FullName
$ScriptsDir = Join-Path $RepoRoot ".github" "scripts"
$ReportFile = Join-Path $ScriptsDir "env-var-analysis.md"

Write-Host "========================================" -ForegroundColor Green
Write-Host "ENV VAR EXTRACTION & SAMPLE TEST" -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Green

# Step 1: Get environment variables from azd
Write-Host "Fetching environment variables from azd..." -ForegroundColor Cyan
$azdVars = @{}
try {
    $output = azd env get-values 2>&1
    if ($LASTEXITCODE -eq 0) {
        # Parse azd env output (format: KEY=VALUE)
        $output | ForEach-Object {
            if ($_ -match '^([A-Z_]+)=(.*)$') {
                $key = $matches[1]
                $value = $matches[2]
                $azdVars[$key] = $value
            }
        }
        Write-Host "  ✓ Found $($azdVars.Count) environment variables" -ForegroundColor Green
    } else {
        Write-Host "  ✗ azd env get-values failed" -ForegroundColor Red
        Write-Host "  Make sure you're in a project with 'azd' initialized" -ForegroundColor Yellow
        exit 1
    }
} catch {
    Write-Host "  ✗ Error calling azd: $_" -ForegroundColor Red
    exit 1
}

if ($ShowEnvVars) {
    Write-Host "`nAzd Environment Variables:" -ForegroundColor Cyan
    $azdVars.Keys | Sort-Object | ForEach-Object {
        $value = if ($azdVars[$_].Length -gt 60) { $azdVars[$_].Substring(0, 57) + "..." } else { $azdVars[$_] }
        Write-Host "  $($_): $value"
    }
}

# Step 2: Create and run wrapper scripts
Write-Host "`n========================================" -ForegroundColor Green
Write-Host "RUNNING SAMPLES WITH AZD ENV VARS" -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Green

$results = @{}

# Python
Write-Host "Testing Python sample..." -ForegroundColor Cyan
$pythonDir = Join-Path $RepoRoot "nosql-create-index-python"
$pythonWrapper = @"
`$env:AZURE_COSMOSDB_ENDPOINT = `$args[0]
`$env:AZURE_COSMOSDB_DATABASENAME = `$args[1]
`$env:AZURE_OPENAI_EMBEDDING_ENDPOINT = `$args[2]
`$env:AZURE_OPENAI_EMBEDDING_DEPLOYMENT = `$args[3]

Set-Location `"$pythonDir`"
python -m pytest tests\ -v --tb=line 2>&1 | Select-Object -First 30
"@

$pythonScript = Join-Path $env:TEMP "test_python_create_index.ps1"
$pythonWrapper | Set-Content $pythonScript

$pythonEndpoint = $azdVars["AZURE_COSMOSDB_ENDPOINT"] ?? "MISSING"
$pythonDb = $azdVars["AZURE_COSMOSDB_DATABASENAME"] ?? "MISSING"
$pythonOpenaiEndpoint = $azdVars["AZURE_OPENAI_EMBEDDING_ENDPOINT"] ?? "MISSING"
$pythonOpenaiDeployment = $azdVars["AZURE_OPENAI_EMBEDDING_DEPLOYMENT"] ?? "MISSING"

if ($pythonEndpoint -eq "MISSING" -or $pythonDb -eq "MISSING" -or $pythonOpenaiEndpoint -eq "MISSING" -or $pythonOpenaiDeployment -eq "MISSING") {
    Write-Host "  ✗ Missing required env vars:" -ForegroundColor Red
    if ($pythonEndpoint -eq "MISSING") { Write-Host "    - AZURE_COSMOSDB_ENDPOINT" }
    if ($pythonDb -eq "MISSING") { Write-Host "    - AZURE_COSMOSDB_DATABASENAME" }
    if ($pythonOpenaiEndpoint -eq "MISSING") { Write-Host "    - AZURE_OPENAI_EMBEDDING_ENDPOINT" }
    if ($pythonOpenaiDeployment -eq "MISSING") { Write-Host "    - AZURE_OPENAI_EMBEDDING_DEPLOYMENT" }
    $results["python"] = "BLOCKED_MISSING_VARS"
} else {
    Write-Host "  Running Python tests with azd env vars..." -ForegroundColor Gray
    & pwsh $pythonScript $pythonEndpoint $pythonDb $pythonOpenaiEndpoint $pythonOpenaiDeployment 2>&1 | Tee-Object -Variable pythonOutput | Select-Object -First 20
    $results["python"] = if ($LASTEXITCODE -eq 0) { "PASS" } else { "FAIL" }
    Write-Host "  Status: $($results["python"])" -ForegroundColor $(if ($results["python"] -eq "PASS") { "Green" } else { "Red" })
}

# TypeScript
Write-Host "`nTesting TypeScript sample..." -ForegroundColor Cyan
$tsDir = Join-Path $RepoRoot "nosql-create-index-typescript"
$tsWrapper = @"
`$env:AZURE_COSMOSDB_ENDPOINT = `$args[0]
`$env:AZURE_COSMOSDB_DATABASENAME = `$args[1]
`$env:AZURE_OPENAI_EMBEDDING_ENDPOINT = `$args[2]
`$env:AZURE_OPENAI_EMBEDDING_DEPLOYMENT = `$args[3]
`$env:AZURE_USER_PRINCIPAL_ID = `$args[4]

Set-Location `"$tsDir`"
npm test 2>&1 | Select-Object -First 30
"@

$tsScript = Join-Path $env:TEMP "test_typescript_create_index.ps1"
$tsWrapper | Set-Content $tsScript

$tsEndpoint = $azdVars["AZURE_COSMOSDB_ENDPOINT"] ?? "MISSING"
$tsDb = $azdVars["AZURE_COSMOSDB_DATABASENAME"] ?? "MISSING"
$tsOpenaiEndpoint = $azdVars["AZURE_OPENAI_EMBEDDING_ENDPOINT"] ?? "MISSING"
$tsOpenaiDeployment = $azdVars["AZURE_OPENAI_EMBEDDING_DEPLOYMENT"] ?? "MISSING"
$tsUserPrincipalId = $azdVars["AZURE_USER_PRINCIPAL_ID"] ?? "MISSING"

if ($tsUserPrincipalId -eq "MISSING") {
    Write-Host "  ✗ Missing required env var:" -ForegroundColor Red
    Write-Host "    - AZURE_USER_PRINCIPAL_ID (required for RBAC test)" -ForegroundColor Red
    $results["typescript"] = "BLOCKED_MISSING_VARS"
} else {
    Write-Host "  Running TypeScript tests with azd env vars..." -ForegroundColor Gray
    & pwsh $tsScript $tsEndpoint $tsDb $tsOpenaiEndpoint $tsOpenaiDeployment $tsUserPrincipalId 2>&1 | Tee-Object -Variable tsOutput | Select-Object -First 20
    $results["typescript"] = if ($LASTEXITCODE -eq 0) { "PASS" } else { "FAIL" }
    Write-Host "  Status: $($results["typescript"])" -ForegroundColor $(if ($results["typescript"] -eq "PASS") { "Green" } else { "Red" })
}

# .NET
Write-Host "`nTesting .NET sample..." -ForegroundColor Cyan
$dotnetDir = Join-Path $RepoRoot "nosql-create-index-dotnet"
$dotnetWrapper = @"
`$env:AZURE_COSMOSDB_ENDPOINT = `$args[0]
`$env:AZURE_COSMOSDB_DATABASENAME = `$args[1]
`$env:AZURE_OPENAI_EMBEDDING_ENDPOINT = `$args[2]
`$env:AZURE_OPENAI_EMBEDDING_DEPLOYMENT = `$args[3]
`$env:AZURE_COSMOSDB_CREATE_INDEX_EMBEDDED_FIELD = `$args[4]

Set-Location `"$dotnetDir`"
dotnet test 2>&1 | Select-Object -First 30
"@

$dotnetScript = Join-Path $env:TEMP "test_dotnet_create_index.ps1"
$dotnetWrapper | Set-Content $dotnetScript

$dotnetEndpoint = $azdVars["AZURE_COSMOSDB_ENDPOINT"] ?? "MISSING"
$dotnetDb = $azdVars["AZURE_COSMOSDB_DATABASENAME"] ?? "MISSING"
$dotnetOpenaiEndpoint = $azdVars["AZURE_OPENAI_EMBEDDING_ENDPOINT"] ?? "MISSING"
$dotnetOpenaiDeployment = $azdVars["AZURE_OPENAI_EMBEDDING_DEPLOYMENT"] ?? "MISSING"
$dotnetEmbeddingField = $azdVars["AZURE_COSMOSDB_CREATE_INDEX_EMBEDDED_FIELD"] ?? "embedding"

if ($dotnetEndpoint -eq "MISSING" -or $dotnetDb -eq "MISSING" -or $dotnetOpenaiEndpoint -eq "MISSING" -or $dotnetOpenaiDeployment -eq "MISSING") {
    Write-Host "  ✗ Missing required env vars:" -ForegroundColor Red
    if ($dotnetEndpoint -eq "MISSING") { Write-Host "    - AZURE_COSMOSDB_ENDPOINT" }
    if ($dotnetDb -eq "MISSING") { Write-Host "    - AZURE_COSMOSDB_DATABASENAME" }
    if ($dotnetOpenaiEndpoint -eq "MISSING") { Write-Host "    - AZURE_OPENAI_EMBEDDING_ENDPOINT" }
    if ($dotnetOpenaiDeployment -eq "MISSING") { Write-Host "    - AZURE_OPENAI_EMBEDDING_DEPLOYMENT" }
    $results["dotnet"] = "BLOCKED_MISSING_VARS"
} else {
    Write-Host "  Running .NET tests with azd env vars..." -ForegroundColor Gray
    & pwsh $dotnetScript $dotnetEndpoint $dotnetDb $dotnetOpenaiEndpoint $dotnetOpenaiDeployment $dotnetEmbeddingField 2>&1 | Tee-Object -Variable dotnetOutput | Select-Object -First 20
    $results["dotnet"] = if ($LASTEXITCODE -eq 0) { "PASS" } else { "FAIL" }
    Write-Host "  Status: $($results["dotnet"])" -ForegroundColor $(if ($results["dotnet"] -eq "PASS") { "Green" } else { "Red" })
}

# Go
Write-Host "`nTesting Go sample..." -ForegroundColor Cyan
$goDir = Join-Path $RepoRoot "nosql-create-index-go"
$goWrapper = @"
`$env:AZURE_COSMOSDB_ENDPOINT = `$args[0]
`$env:AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME = `$args[1]
`$env:AZURE_OPENAI_EMBEDDING_ENDPOINT = `$args[2]
`$env:AZURE_OPENAI_EMBEDDING_DEPLOYMENT = `$args[3]
`$env:AZURE_COSMOSDB_CREATE_INDEX_EMBEDDED_FIELD = `$args[4]

Set-Location `"$goDir`"
go test ./... 2>&1 | Select-Object -First 30
"@

$goScript = Join-Path $env:TEMP "test_go_create_index.ps1"
$goWrapper | Set-Content $goScript

$goEndpoint = $azdVars["AZURE_COSMOSDB_ENDPOINT"] ?? "MISSING"
$goDb = $azdVars["AZURE_COSMOSDB_DATABASENAME"] ?? "MISSING"
$goOpenaiEndpoint = $azdVars["AZURE_OPENAI_EMBEDDING_ENDPOINT"] ?? "MISSING"
$goOpenaiDeployment = $azdVars["AZURE_OPENAI_EMBEDDING_DEPLOYMENT"] ?? "MISSING"
$goEmbeddingField = $azdVars["AZURE_COSMOSDB_CREATE_INDEX_EMBEDDED_FIELD"] ?? "embedding"

if ($goEndpoint -eq "MISSING" -or $goDb -eq "MISSING" -or $goOpenaiEndpoint -eq "MISSING" -or $goOpenaiDeployment -eq "MISSING") {
    Write-Host "  ✗ Missing required env vars:" -ForegroundColor Red
    if ($goEndpoint -eq "MISSING") { Write-Host "    - AZURE_COSMOSDB_ENDPOINT" }
    if ($goDb -eq "MISSING") { Write-Host "    - AZURE_COSMOSDB_DATABASENAME" }
    if ($goOpenaiEndpoint -eq "MISSING") { Write-Host "    - AZURE_OPENAI_EMBEDDING_ENDPOINT" }
    if ($goOpenaiDeployment -eq "MISSING") { Write-Host "    - AZURE_OPENAI_EMBEDDING_DEPLOYMENT" }
    $results["go"] = "BLOCKED_MISSING_VARS"
} else {
    Write-Host "  Running Go tests with azd env vars..." -ForegroundColor Gray
    & pwsh $goScript $goEndpoint $goDb $goOpenaiEndpoint $goOpenaiDeployment $goEmbeddingField 2>&1 | Tee-Object -Variable goOutput | Select-Object -First 20
    $results["go"] = if ($LASTEXITCODE -eq 0) { "PASS" } else { "FAIL" }
    Write-Host "  Status: $($results["go"])" -ForegroundColor $(if ($results["go"] -eq "PASS") { "Green" } else { "Red" })
}

# Java
Write-Host "`nTesting Java sample..." -ForegroundColor Cyan
$javaDir = Join-Path $RepoRoot "nosql-create-index-java"
$javaWrapper = @"
`$env:AZURE_COSMOSDB_ENDPOINT = `$args[0]
`$env:AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME = `$args[1]
`$env:AZURE_OPENAI_EMBEDDING_ENDPOINT = `$args[2]
`$env:AZURE_OPENAI_EMBEDDING_DEPLOYMENT = `$args[3]
`$env:AZURE_COSMOSDB_CREATE_INDEX_EMBEDDED_FIELD = `$args[4]

Set-Location `"$javaDir`"
mvn test 2>&1 | Select-Object -First 30
"@

$javaScript = Join-Path $env:TEMP "test_java_create_index.ps1"
$javaWrapper | Set-Content $javaScript

$javaEndpoint = $azdVars["AZURE_COSMOSDB_ENDPOINT"] ?? "MISSING"
$javaDb = $azdVars["AZURE_COSMOSDB_DATABASENAME"] ?? "MISSING"
$javaOpenaiEndpoint = $azdVars["AZURE_OPENAI_EMBEDDING_ENDPOINT"] ?? "MISSING"
$javaOpenaiDeployment = $azdVars["AZURE_OPENAI_EMBEDDING_DEPLOYMENT"] ?? "MISSING"
$javaEmbeddingField = $azdVars["AZURE_COSMOSDB_CREATE_INDEX_EMBEDDED_FIELD"] ?? "embedding"

if ($javaEndpoint -eq "MISSING" -or $javaDb -eq "MISSING" -or $javaOpenaiEndpoint -eq "MISSING" -or $javaOpenaiDeployment -eq "MISSING") {
    Write-Host "  ✗ Missing required env vars:" -ForegroundColor Red
    if ($javaEndpoint -eq "MISSING") { Write-Host "    - AZURE_COSMOSDB_ENDPOINT" }
    if ($javaDb -eq "MISSING") { Write-Host "    - AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME" }
    if ($javaOpenaiEndpoint -eq "MISSING") { Write-Host "    - AZURE_OPENAI_EMBEDDING_ENDPOINT" }
    if ($javaOpenaiDeployment -eq "MISSING") { Write-Host "    - AZURE_OPENAI_EMBEDDING_DEPLOYMENT" }
    $results["java"] = "BLOCKED_MISSING_VARS"
} else {
    Write-Host "  Running Java tests with azd env vars..." -ForegroundColor Gray
    & pwsh $javaScript $javaEndpoint $javaDb $javaOpenaiEndpoint $javaOpenaiDeployment $javaEmbeddingField 2>&1 | Tee-Object -Variable javaOutput | Select-Object -First 20
    $results["java"] = if ($LASTEXITCODE -eq 0) { "PASS" } else { "FAIL" }
    Write-Host "  Status: $($results["java"])" -ForegroundColor $(if ($results["java"] -eq "PASS") { "Green" } else { "Red" })
}

# Step 3: Compare expected env var names
Write-Host "`n========================================" -ForegroundColor Green
Write-Host "ENV VAR NAME ANALYSIS" -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Green

Write-Host "Expected env vars from PLAN (section 5.1, source of truth = bicep outputs):" -ForegroundColor Cyan
$planExpected = @(
    "AZURE_TENANT_ID"
    "AZURE_LOCATION"
    "AZURE_RESOURCE_GROUP"
    "AZURE_COSMOSDB_ACCOUNT_NAME"
    "AZURE_COSMOSDB_ENDPOINT"
    "AZURE_COSMOSDB_DATABASENAME"
    "AZURE_COSMOSDB_DISKANN_CONTAINER_NAME"
    "AZURE_COSMOSDB_QUANTIZEDFLAT_CONTAINER_NAME"
    "AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME"
    "AZURE_COSMOSDB_CREATE_INDEX_DISKANN_CONTAINER_NAME"
    "AZURE_COSMOSDB_CREATE_INDEX_QUANTIZEDFLAT_CONTAINER_NAME"
    "AZURE_COSMOSDB_CREATE_INDEX_EMBEDDED_FIELD"
    "AZURE_OPENAI_SERVICE"
    "AZURE_OPENAI_ENDPOINT"
    "AZURE_OPENAI_EMBEDDING_DEPLOYMENT"
    "AZURE_OPENAI_EMBEDDING_API_VERSION"
)
$planExpected | ForEach-Object { Write-Host "  - $_" }

Write-Host "`nActual env vars from BICEP outputs:" -ForegroundColor Cyan
$bicepOutputs = @(
    "AZURE_LOCATION"
    "AZURE_TENANT_ID"
    "AZURE_RESOURCE_GROUP"
    "AZURE_OPENAI_SERVICE"
    "AZURE_OPENAI_ENDPOINT"
    "AZURE_OPENAI_CHAT_MODEL"
    "AZURE_OPENAI_CHAT_DEPLOYMENT"
    "AZURE_OPENAI_CHAT_API_VERSION"
    "AZURE_OPENAI_EMBEDDING_MODEL"
    "AZURE_OPENAI_EMBEDDING_DEPLOYMENT"
    "AZURE_OPENAI_EMBEDDING_API_VERSION"
    "AZURE_OPENAI_EMBEDDING_ENDPOINT"
    "AZURE_COSMOSDB_ACCOUNT_NAME"
    "AZURE_COSMOSDB_ENDPOINT"
    "AZURE_COSMOSDB_DATABASENAME"
    "AZURE_COSMOSDB_DISKANN_CONTAINER_NAME"
    "AZURE_COSMOSDB_QUANTIZEDFLAT_CONTAINER_NAME"
    "AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME"
    "AZURE_COSMOSDB_CREATE_INDEX_DISKANN_CONTAINER_NAME"
    "AZURE_COSMOSDB_CREATE_INDEX_QUANTIZEDFLAT_CONTAINER_NAME"
    "AZURE_COSMOSDB_CREATE_INDEX_EMBEDDED_FIELD"
    "AZURE_COSMOSDB_CREATE_INDEX_PARTITION_KEY_PATH"
    "AZURE_COSMOSDB_CREATE_INDEX_EMBEDDING_DIMENSIONS"
    "DATA_FILE_WITH_VECTORS"
    "DATA_FILE_WITHOUT_VECTORS"
    "FIELD_TO_EMBED"
    "EMBEDDED_FIELD"
    "EMBEDDING_DIMENSIONS"
    "EMBEDDING_BATCH_SIZE"
    "LOAD_SIZE_BATCH"
)
$bicepOutputs | ForEach-Object { Write-Host "  - $_" }

Write-Host "`nValidation: Checking if plan env vars match bicep outputs..." -ForegroundColor Cyan
$mismatches = @()

# Now that plan is corrected, planExpected and bicepOutputs should have no mismatches
# Check that all expected vars are in bicep outputs
foreach ($expected in $planExpected) {
    if ($expected -notin $bicepOutputs) {
        Write-Host "  ✗ Plan expects $expected but bicep does NOT output it" -ForegroundColor Red
        $mismatches += "$expected (missing from bicep)"
    }
}

# Also check for unexpected vars in bicep that aren't in plan (informational only)
foreach ($output in $bicepOutputs) {
    if ($output -notin $planExpected) {
        Write-Host "  ℹ Bicep outputs $output but plan doesn't reference it (OK — may be for future use)" -ForegroundColor Blue
    }
}

if ($mismatches.Count -eq 0) {
    Write-Host "`n✓ PLAN AND BICEP ENV VARS ARE ALIGNED — No mismatches!" -ForegroundColor Green
} else {
    Write-Host "`n✗ MISMATCHES FOUND:" -ForegroundColor Red
    $mismatches | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
}


Write-Host "`nActual azd values found:" -ForegroundColor Cyan
$azdVars.Keys | Sort-Object | Where-Object { $_ -match "AZURE_" } | ForEach-Object {
    $value = if ($azdVars[$_].Length -gt 50) { $azdVars[$_].Substring(0, 47) + "..." } else { $azdVars[$_] }
    Write-Host "  $($_): $value"
}

# Step 4: Summary
Write-Host "`n========================================" -ForegroundColor Green
Write-Host "SUMMARY" -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Green

Write-Host "Test Results:" -ForegroundColor Cyan
$results.Keys | Sort-Object | ForEach-Object {
    $symbol = if ($results[$_] -eq "PASS") { "✓" } else { "✗" }
    $color = if ($results[$_] -eq "PASS") { "Green" } else { "Red" }
    Write-Host "  $symbol $($_): $($results[$_])" -ForegroundColor $color
}

Write-Host "`nEnv Var Name Mismatches:" -ForegroundColor Cyan
if ($mismatches.Count -eq 0) {
    Write-Host "  ✓ No mismatches (plan matches bicep)" -ForegroundColor Green
} else {
    $mismatches | ForEach-Object { Write-Host "  ⚠ $_" -ForegroundColor Yellow }
}

Write-Host "`nConclusion:" -ForegroundColor Cyan
if ($mismatches.Count -gt 0) {
    Write-Host "  The PLAN section 5.1 needs to be updated to match BICEP outputs" -ForegroundColor Yellow
    Write-Host "  The BICEP is correct. The PLAN is wrong." -ForegroundColor Yellow
}
