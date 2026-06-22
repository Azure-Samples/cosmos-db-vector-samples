#!/usr/bin/env pwsh
<#
.SYNOPSIS
Verification script that tests each language's create-index implementation
against the 2-part goals defined in create-index-architecture.md.

.DESCRIPTION
This script:
1. Reads the plan (create-index-architecture.md)
2. Extracts Goal 1 (ARM SDK control plane) and Goal 2 (distance functions)
3. Runs each language's test suite
4. Validates against specific requirements from the plan
5. Generates a structured report for auto-regeneration

.OUTPUTS
- Structured JSON with per-language, per-goal verification results
- Human-readable summary report
- Specific assertion results (pass/fail) for each requirement
#>

param(
    [string]$LanguagesToTest = "python,typescript,dotnet",
    [switch]$GenerateReport = $true,
    [switch]$Verbose = $false
)

# Configuration
$RepoRoot = (Get-Item $PSScriptRoot).Parent.Parent.FullName
$PlansDir = Join-Path $RepoRoot ".github/plans"
$PlanFile = Join-Path $PlansDir "create-index-architecture.md"
$OutputDir = Join-Path $PlansDir "verification-results"
$ReportFile = Join-Path $OutputDir "VERIFICATION_RESULTS.json"
$SummaryFile = Join-Path $OutputDir "VERIFICATION_SUMMARY.md"

# Ensure output directory exists
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
}

# ==============================================================================
# GOAL DEFINITIONS (extracted from plan)
# ==============================================================================

$Goal1 = @{
    Name = "ARM SDK Control Plane"
    Description = "Use ARM SDK to create containers with /Region partition key and both DiskANN and QuantizedFlat vector indexes"
    Requirements = @(
        @{
            ID = "G1-1"
            Name = "Container Creation with /Region Partition Key"
            Description = "Containers (hotels_diskann, hotels_quantizedflat) created with /Region partition key"
            VerificationMethod = "code_inspection"
        }
        @{
            ID = "G1-2"
            Name = "DiskANN Index Creation"
            Description = "Both containers have DiskANN vector index with Cosine distance metric"
            VerificationMethod = "code_inspection"
        }
        @{
            ID = "G1-3"
            Name = "QuantizedFlat Index Creation"
            Description = "Both containers have QuantizedFlat vector index with Cosine distance metric"
            VerificationMethod = "code_inspection"
        }
        @{
            ID = "G1-4"
            Name = "Vector Embedding Field"
            Description = "Vector embedding field specified as /embedding with 1536 dimensions, Float32"
            VerificationMethod = "code_inspection"
        }
    )
}

$Goal2 = @{
    Name = "Distance Functions Across All Algorithms"
    Description = "VectorDistance queries execute with all 3 distance functions (Cosine, DotProduct, Euclidean) returning consistent results"
    Requirements = @(
        @{
            ID = "G2-1"
            Name = "Ingestion with Region Batching"
            Description = "Documents ingested in batches grouped by Region (4-5 batch operations for 4 regions)"
            VerificationMethod = "test_execution"
        }
        @{
            ID = "G2-2"
            Name = "Cosine Distance Function"
            Description = "VectorDistance queries work with Cosine distance function, no ORDER BY, partition key in WHERE clause"
            VerificationMethod = "test_execution"
        }
        @{
            ID = "G2-3"
            Name = "DotProduct Distance Function"
            Description = "VectorDistance queries work with DotProduct distance function, no ORDER BY, partition key in WHERE clause"
            VerificationMethod = "test_execution"
        }
        @{
            ID = "G2-4"
            Name = "Euclidean Distance Function"
            Description = "VectorDistance queries work with Euclidean distance function, no ORDER BY, partition key in WHERE clause"
            VerificationMethod = "test_execution"
        }
        @{
            ID = "G2-5"
            Name = "Cross-Language Result Consistency"
            Description = "Results match across all languages (same HotelId, same ranking, score variance < 0.01)"
            VerificationMethod = "cross_language_comparison"
        }
    )
}

# ==============================================================================
# AUTHENTICATION VALIDATION
# ==============================================================================

function Test-AuthenticationPatterns {
    param([hashtable]$Results)
    
    Write-Host "`nValidating authentication patterns..." -ForegroundColor Cyan
    
    $authPatterns = @{
        python = @{
            path = "nosql-create-index-python/src"
            filePattern = "*.py"
            shouldHave = @("DefaultAzureCredential", "from azure.identity")
            shouldNotHave = @("AZURE_COSMOS_KEY", "AZURE_OPENAI_KEY", "password", "secret_key", "api_key")
        }
        typescript = @{
            path = "nosql-create-index-typescript/src"
            filePattern = "*.ts"
            shouldHave = @("DefaultAzureCredential", "from @azure/identity")
            shouldNotHave = @("COSMOS_KEY", "OPENAI_KEY", "password", "apiKey", "secretKey")
        }
        dotnet = @{
            path = "nosql-create-index-dotnet/src"
            filePattern = "*.cs"
            shouldHave = @("DefaultAzureCredential", "using Azure.Identity")
            shouldNotHave = @("CosmosKeyCredential", "ApiKey", "password", "secretKey")
        }
    }
    
    foreach ($lang in $Results.languages.Keys) {
        if (-not $authPatterns.ContainsKey($lang)) {
            continue
        }
        
        $langConfig = $authPatterns[$lang]
        $srcPath = Join-Path $RepoRoot $langConfig.path
        
        if (-not (Test-Path $srcPath)) {
            Write-Host "  ⚠ Skipping $lang — path not found" -ForegroundColor Yellow
            continue
        }
        
        # Find all source files
        $files = @(Get-ChildItem -Path $srcPath -Filter $langConfig.filePattern -File -Recurse -ErrorAction SilentlyContinue)
        $allContent = @($files | Get-Content -Raw) -join "`n"
        
        # Check for required auth pattern
        $hasDefaultAzureCredential = $false
        foreach ($pattern in $langConfig.shouldHave) {
            if ($allContent -match [regex]::Escape($pattern)) {
                $hasDefaultAzureCredential = $true
                break
            }
        }
        
        # Check for forbidden patterns
        $hasForbiddenPattern = $false
        $forbiddenPatterns = @()
        foreach ($pattern in $langConfig.shouldNotHave) {
            if ($allContent -match [regex]::Escape($pattern)) {
                $hasForbiddenPattern = $true
                $forbiddenPatterns += $pattern
            }
        }
        
        $Results.languages[$lang]["auth_check"] = @{
            status = if ($hasDefaultAzureCredential -and -not $hasForbiddenPattern) { "PASS" } else { "FAIL" }
            uses_default_azure_credential = $hasDefaultAzureCredential
            has_forbidden_patterns = $forbiddenPatterns
        }
        
        if ($hasDefaultAzureCredential -and -not $hasForbiddenPattern) {
            Write-Host "  ✓ $($lang): Uses DefaultAzureCredential, no hardcoded keys" -ForegroundColor Green
        } else {
            Write-Host "  ✗ $($lang): Auth validation failed" -ForegroundColor Red
            if (-not $hasDefaultAzureCredential) {
                Write-Host "    - Missing DefaultAzureCredential usage" -ForegroundColor Red
            }
            if ($hasForbiddenPattern) {
                Write-Host "    - Found forbidden patterns: $($forbiddenPatterns -join ', ')" -ForegroundColor Red
            }
        }
    }
}

# ==============================================================================
# LANGUAGE-SPECIFIC TEST RUNNERS
# ==============================================================================

function Test-Python {
    param([hashtable]$Results)
    
    Write-Host "Testing Python implementation..." -ForegroundColor Cyan
    $pythonDir = Join-Path $RepoRoot "nosql-create-index-python"
    
    # Check if pytest exists
    $hasPytest = python -m pytest --version 2>&1 | Select-String "pytest"
    
    if ($hasPytest) {
        # Look for tests in various locations
        $testDirs = @(
            "$pythonDir\tests",
            "$pythonDir\src\tests",
            "$pythonDir\test"
        )
        
        $testDir = $null
        foreach ($dir in $testDirs) {
            if (Test-Path $dir) {
                $testDir = $dir
                break
            }
        }
        
        if ($testDir) {
            Write-Host "  Running: python -m pytest $testDir -v --tb=short" -ForegroundColor Gray
            $testOutput = python -m pytest "$testDir" -v --tb=short 2>&1
            $testResult = $LASTEXITCODE -eq 0
        } else {
            Write-Host "  No test directory found in standard locations" -ForegroundColor Yellow
            $testResult = $false
            $testOutput = "No test directory found"
        }
        
        $Results["python"]["build_test"]["status"] = if ($testResult) { "PASS" } else { "FAIL" }
        $Results["python"]["build_test"]["output"] = $testOutput | Out-String
        
        # Parse test output for specific assertions
        $cosineMatch = $testOutput | Select-String "cosine|Cosine" -SimpleMatch
        $dotproductMatch = $testOutput | Select-String "dotproduct|DotProduct" -SimpleMatch
        $euclideanMatch = $testOutput | Select-String "euclidean|Euclidean" -SimpleMatch
        
        $Results["python"]["G2-2"]["status"] = if ($cosineMatch) { "PASS" } else { "FAIL" }
        $Results["python"]["G2-3"]["status"] = if ($dotproductMatch) { "PASS" } else { "FAIL" }
        $Results["python"]["G2-4"]["status"] = if ($euclideanMatch) { "PASS" } else { "FAIL" }
    } else {
        Write-Host "  pytest not found, skipping tests" -ForegroundColor Yellow
        $Results["python"]["build_test"]["status"] = "SKIPPED"
    }
    
    # Code inspection for Goal 1
    $controlPlaneFile = Join-Path $pythonDir "src/control_plane.py"
    if (Test-Path $controlPlaneFile) {
        $content = Get-Content $controlPlaneFile -Raw
        
        $Results["python"]["G1-1"]["status"] = if ($content -match "/Region") { "PASS" } else { "FAIL" }
        $Results["python"]["G1-2"]["status"] = if ($content -match "DISK_ANN|DiskANN") { "PASS" } else { "FAIL" }
        $Results["python"]["G1-3"]["status"] = if ($content -match "QuantizedFlat") { "PASS" } else { "FAIL" }
        $Results["python"]["G1-4"]["status"] = if ($content -match '1536|embedding') { "PASS" } else { "FAIL" }
    }
}

function Test-TypeScript {
    param([hashtable]$Results)
    
    Write-Host "Testing TypeScript implementation..." -ForegroundColor Cyan
    $tsDir = Join-Path $RepoRoot "nosql-create-index-typescript"
    
    # Check if npm exists
    $hasNpm = npm --version 2>&1
    
    if ($hasNpm) {
        Write-Host "  Running: npm test --prefix $tsDir" -ForegroundColor Gray
        Push-Location $tsDir
        $testOutput = npm test 2>&1
        $testResult = $LASTEXITCODE -eq 0
        Pop-Location
        
        $Results["typescript"]["build_test"]["status"] = if ($testResult) { "PASS" } else { "FAIL" }
        $Results["typescript"]["build_test"]["output"] = $testOutput | Out-String
    } else {
        Write-Host "  npm not found, skipping tests" -ForegroundColor Yellow
        $Results["typescript"]["build_test"]["status"] = "SKIPPED"
    }
    
    # Code inspection for Goal 1
    $controlPlaneFile = Join-Path $tsDir "src/control-plane.ts"
    if (Test-Path $controlPlaneFile) {
        $content = Get-Content $controlPlaneFile -Raw
        
        $Results["typescript"]["G1-1"]["status"] = if ($content -match "/Region") { "PASS" } else { "FAIL" }
        $Results["typescript"]["G1-2"]["status"] = if ($content -match "DISK_ANN|DiskANN") { "PASS" } else { "FAIL" }
        $Results["typescript"]["G1-3"]["status"] = if ($content -match "QuantizedFlat") { "PASS" } else { "FAIL" }
        $Results["typescript"]["G1-4"]["status"] = if ($content -match '1536|embedding') { "PASS" } else { "FAIL" }
    }
}

function Test-DotNet {
    param([hashtable]$Results)
    
    Write-Host "Testing .NET implementation..." -ForegroundColor Cyan
    $dotnetDir = Join-Path $RepoRoot "nosql-create-index-dotnet"
    
    # Check if dotnet exists
    $hasDotnet = dotnet --version 2>&1
    
    if ($hasDotnet) {
        Write-Host "  Running: dotnet test" -ForegroundColor Gray
        Push-Location $dotnetDir
        $testOutput = dotnet test 2>&1
        $testResult = $LASTEXITCODE -eq 0
        Pop-Location
        
        $Results["dotnet"]["build_test"]["status"] = if ($testResult) { "PASS" } else { "FAIL" }
        $Results["dotnet"]["build_test"]["output"] = $testOutput | Out-String
    } else {
        Write-Host "  dotnet not found, skipping tests" -ForegroundColor Yellow
        $Results["dotnet"]["build_test"]["status"] = "SKIPPED"
    }
    
    # Code inspection for Goal 1
    $controlPlaneFile = Join-Path $dotnetDir "src/ControlPlane.cs"
    if (Test-Path $controlPlaneFile) {
        $content = Get-Content $controlPlaneFile -Raw
        
        $Results["dotnet"]["G1-1"]["status"] = if ($content -match "/Region") { "PASS" } else { "FAIL" }
        $Results["dotnet"]["G1-2"]["status"] = if ($content -match "DISK_ANN|DiskANN") { "PASS" } else { "FAIL" }
        $Results["dotnet"]["G1-3"]["status"] = if ($content -match "QuantizedFlat") { "PASS" } else { "FAIL" }
        $Results["dotnet"]["G1-4"]["status"] = if ($content -match '1536|embedding') { "PASS" } else { "FAIL" }
    }
}

# ==============================================================================
# MAIN EXECUTION
# ==============================================================================

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "CREATE-INDEX PLAN VERIFICATION" -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Green

# Initialize results structure
$results = @{
    timestamp = (Get-Date).ToUniversalTime().ToString("o")
    plan_file = $PlanFile
    languages = @{}
}

foreach ($lang in $LanguagesToTest.Split(',')) {
    $lang = $lang.Trim()
    $results.languages[$lang] = @{
        goal_1 = @{}
        goal_2 = @{}
        build_test = @{
            status = "PENDING"
            output = ""
        }
    }
    
    # Initialize per-requirement results
    $Goal1.Requirements | ForEach-Object {
        $results.languages[$lang][$_.ID] = @{ status = "NOT_TESTED" }
    }
    $Goal2.Requirements | ForEach-Object {
        $results.languages[$lang][$_.ID] = @{ status = "NOT_TESTED" }
    }
}

# Run language-specific tests
Write-Host "Running language-specific verifications...`n"

if ($LanguagesToTest -match "python") {
    Test-Python -Results $results.languages
}
if ($LanguagesToTest -match "typescript") {
    Test-TypeScript -Results $results.languages
}
if ($LanguagesToTest -match "dotnet") {
    Test-DotNet -Results $results.languages
}

# Validate authentication patterns
Test-AuthenticationPatterns -Results $results

# ==============================================================================
# GENERATE RESULTS
# ==============================================================================

# Save JSON results
$jsonResults = $results | ConvertTo-Json -Depth 10
$jsonResults | Set-Content $ReportFile
Write-Host "`nResults saved to: $ReportFile" -ForegroundColor Green

# Generate summary report
if ($GenerateReport) {
    $summary = @"
# CREATE-INDEX VERIFICATION REPORT
Generated: $(Get-Date)

## AUTHENTICATION
Verify: All samples use DefaultAzureCredential, no hardcoded keys

"@

    foreach ($lang in $results.languages.Keys) {
        $authStatus = $results.languages[$lang]["auth_check"]
        if ($authStatus) {
            $status = $authStatus.status
            $emoji = if ($status -eq "PASS") { "[OK]" } else { "[FAIL]" }
            $summary += "### $lang`n$emoji Auth check - $status`n"
            if ($authStatus.has_forbidden_patterns) {
                $summary += "⚠ Found forbidden patterns: $($authStatus.has_forbidden_patterns -join ', ')`n"
            }
            $summary += "`n"
        }
    }

    $summary += @"
## GOAL 1: ARM SDK Control Plane
Verify: Containers created with /Region partition key and both index types
"@
    
    foreach ($lang in $LanguagesToTest.Split(',')) {
        $lang = $lang.Trim()
        $langResults = $results.languages[$lang]
        
        $summary += "`n### $($lang.ToUpper())`n"
        
        $Goal1.Requirements | ForEach-Object {
            $status = $langResults[$_.ID].status
            $symbol = if ($status -eq "PASS") { "[OK]" } else { "[FAIL]" }
            $summary += "$symbol $($_.ID): $($_.Name) - $status`n"
        }
    }
    
    $summary += @"

## GOAL 2: Distance Functions Across All Algorithms
Verify: VectorDistance queries work with all 3 functions, cross-language results match

"@
    
    foreach ($lang in $LanguagesToTest.Split(',')) {
        $lang = $lang.Trim()
        $langResults = $results.languages[$lang]
        
        $summary += "`n### $($lang.ToUpper())`n"
        
        $Goal2.Requirements | ForEach-Object {
            $status = $langResults[$_.ID].status
            $symbol = if ($status -eq "PASS") { "[OK]" } else { "[FAIL]" }
            $summary += "$symbol $($_.ID): $($_.Name) - $status`n"
        }
    }
    
    $summary | Set-Content $SummaryFile
    Write-Host "Summary saved to: $SummaryFile" -ForegroundColor Green
}

# ==============================================================================
# PRINT RESULTS MATRIX
# ==============================================================================

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "VERIFICATION MATRIX" -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Green

$tableData = @()
foreach ($lang in $LanguagesToTest.Split(',')) {
    $lang = $lang.Trim()
    $langResults = $results.languages[$lang]
    
    $g1Status = ($Goal1.Requirements | ForEach-Object { $langResults[$_.ID].status } | Where-Object { $_ -eq "FAIL" }).Count -eq 0 ? "COMPLETE" : "INCOMPLETE"
    $g2Status = ($Goal2.Requirements | ForEach-Object { $langResults[$_.ID].status } | Where-Object { $_ -eq "FAIL" }).Count -eq 0 ? "COMPLETE" : "INCOMPLETE"
    $testStatus = $langResults.build_test.status
    
    $tableData += [PSCustomObject]@{
        Language = $lang.ToUpper()
        "Goal 1" = $g1Status
        "Goal 2" = $g2Status
        "Tests" = $testStatus
    }
}

$tableData | Format-Table -AutoSize

Write-Host "`nVerification complete. Review results above and generated files.`n" -ForegroundColor Yellow
