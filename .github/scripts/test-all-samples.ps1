#!/usr/bin/env pwsh
<#



1. .github/scripts/test-all-samples.ps1 â Main testing script

 - Iterates through all 10 samples (5 create-index + 5 vector-search languages)
 - For each sample: - Installs dependencies (npm, pip, mvn, go mod, dotnet)
 - Creates .env via azd env get-values (languages) or prepares for config update (.NET)
 - Builds (language-specific)
 - Runs and captures output
 - Saves individual log file
 - Produces summary table with pass/fail/timing
 - Exit code reflects overall result

2. .github/workflows/test-all-samples.yml â GitHub Actions workflow

 - Triggers on push/PR when samples or infra change
 - Sets up all 5 language runtimes + Azure CLI
 - Runs the test script
 - Uploads results as artifact (30-day retention)
 - Comments on PR with collapsible test output per sample

To run locally:

 .\.github\scripts\test-all-samples.ps1 -OutputDir ./test-results

.SYNOPSIS
    Test all samples (create-index and vector-search) across all languages.
    
.DESCRIPTION
    For each sample:
    1. Install dependencies
    2. Create .env file from azd env get-values (or update .NET config)
    3. Build the sample
    4. Run the sample
    5. Capture output to a log file
    
    PREREQUISITE: Populate environment variables from Azure resources
    Run this once before testing to create/update .env files:
        azd env get-values > .env
    
.PARAMETER OutputDir
    Directory to store test results. Defaults to ./test-results
    
.PARAMETER SkipCleanup
    If specified, don't clean up build artifacts after test
#>
param(
    [string]$OutputDir = './test-results',
    [switch]$SkipCleanup
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

# Create output directory
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir | Out-Null
}
$OutputDir = Convert-Path $OutputDir

Write-Host "🧪 Running all samples tests" -ForegroundColor Cyan
Write-Host "   Repo root: $repoRoot"
Write-Host "   Output dir: $OutputDir"
Write-Host ""

$startTime = Get-Date
$timestamp = $startTime.ToString('yyyyMMdd-HHmmss')
$results = @()

# Sample definitions: array of hashtables
$samples = @(
    @{ name = 'nosql-create-index-typescript'; type = 'typescript'; language = 'TypeScript'; sample = 'create-index' }
    @{ name = 'nosql-create-index-python'; type = 'python'; language = 'Python'; sample = 'create-index' }
    @{ name = 'nosql-create-index-java'; type = 'java'; language = 'Java'; sample = 'create-index' }
    @{ name = 'nosql-create-index-go'; type = 'go'; language = 'Go'; sample = 'create-index' }
    @{ name = 'nosql-create-index-dotnet'; type = 'dotnet'; language = 'C#'; sample = 'create-index' }
    @{ name = 'nosql-vector-search-typescript'; type = 'typescript'; language = 'TypeScript'; sample = 'vector-search' }
    @{ name = 'nosql-vector-search-python'; type = 'python'; language = 'Python'; sample = 'vector-search' }
    @{ name = 'nosql-vector-search-java'; type = 'java'; language = 'Java'; sample = 'vector-search' }
    @{ name = 'nosql-vector-search-go'; type = 'go'; language = 'Go'; sample = 'vector-search' }
    @{ name = 'nosql-vector-search-dotnet'; type = 'dotnet'; language = 'C#'; sample = 'vector-search' }
)

foreach ($sample in $samples) {
    $samplePath = Join-Path $repoRoot $sample.name
    $logFile = Join-Path $OutputDir "$($sample.name)-$timestamp-output.log"
    $status = 'UNKNOWN'
    $duration = $null
    $errorMsg = $null
    
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    Write-Host "📦 $($sample.language) — $($sample.sample)" -ForegroundColor Blue
    Write-Host "   Path: $samplePath"
    Write-Host ""
    
    if (-not (Test-Path $samplePath)) {
        Write-Host "   ❌ Directory not found: $samplePath" -ForegroundColor Red
        $status = 'NOT_FOUND'
        $results += @{
            name = $sample.name
            language = $sample.language
            type = $sample.type
            sample = $sample.sample
            status = $status
            error = "Directory not found"
            duration = $null
        }
        continue
    }
    
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    
    try {
        # Test output log
        $log = @("=== $($sample.name) — $($sample.language) ===")
        $log += "Start: $(Get-Date -Format 'o')"
        $log += ""
        
        # 1. Install dependencies
        Write-Host "   [1/4] Installing dependencies..." -NoNewline
        $log += "[1/4] Installing dependencies"
        
        switch ($sample.type) {
            'typescript' {
                Push-Location $samplePath
                npm install 2>&1 | Out-String | Tee-Object -Variable npmInstall | Out-Null
                $log += $npmInstall
                Pop-Location
            }
            'python' {
                Push-Location $samplePath
                # Create venv if needed
                if (-not (Test-Path '.venv')) {
                    python -m venv .venv 2>&1 | Out-String | Tee-Object -Variable venvCreate | Out-Null
                    $log += $venvCreate
                }
                # Activate venv and install
                & .\.venv\Scripts\Activate.ps1
                pip install -r requirements.txt 2>&1 | Out-String | Tee-Object -Variable pipInstall | Out-Null
                $log += $pipInstall
                Pop-Location
            }
            'java' {
                Push-Location $samplePath
                mvn clean install -q 2>&1 | Out-String | Tee-Object -Variable mvnInstall | Out-Null
                $log += $mvnInstall
                Pop-Location
            }
            'go' {
                Push-Location $samplePath
                go mod tidy 2>&1 | Out-String | Tee-Object -Variable goMod | Out-Null
                $log += $goMod
                Pop-Location
            }
            'dotnet' {
                Push-Location $samplePath
                dotnet restore 2>&1 | Out-String | Tee-Object -Variable dotnetRestore | Out-Null
                $log += $dotnetRestore
                Pop-Location
            }
        }
        Write-Host " ✓" -ForegroundColor Green
        $log += ""
        
        # 2. Setup .env or config
        Write-Host "   [2/4] Setting up environment..." -NoNewline
        $log += "[2/4] Setting up environment"
        
        if ($sample.type -eq 'dotnet') {
            # For .NET, update appsettings.json with azd env values
            Push-Location $repoRoot
            $envVals = azd env get-values 2>&1 | Out-String
            $log += "azd env get-values output:"
            $log += $envVals
            Pop-Location
            # TODO: Parse and update appsettings.json
        } else {
            # Create .env file in sample directory
            Push-Location $repoRoot
            $envOutput = azd env get-values 2>&1 | Out-String
            $log += "azd env get-values output:"
            $log += $envOutput
            
            # Write .env file to sample directory
            $envFile = Join-Path $samplePath '.env'
            $envOutput | Out-File -FilePath $envFile -Encoding UTF8 -Force
            $log += "Created .env at $envFile"
            Pop-Location
        }
        Write-Host " ✓" -ForegroundColor Green
        $log += ""
        
        # 3. Build
        Write-Host "   [3/4] Building..." -NoNewline
        $log += "[3/4] Building"
        
        switch ($sample.type) {
            'typescript' {
                Push-Location $samplePath
                npm run build 2>&1 | Out-String | Tee-Object -Variable build | Out-Null
                $log += $build
                Pop-Location
            }
            'python' {
                # Python: no build needed
                $log += "Python: skipped build step"
            }
            'java' {
                Push-Location $samplePath
                mvn clean compile package -q 2>&1 | Out-String | Tee-Object -Variable build | Out-Null
                $log += $build
                Pop-Location
            }
            'go' {
                Push-Location $samplePath
                go build -o app ./cmd/vector-search 2>&1 | Out-String | Tee-Object -Variable build | Out-Null
                $log += $build
                Pop-Location
            }
            'dotnet' {
                Push-Location $samplePath
                dotnet build 2>&1 | Out-String | Tee-Object -Variable build | Out-Null
                $log += $build
                Pop-Location
            }
        }
        Write-Host " ✓" -ForegroundColor Green
        $log += ""
        
        # 4. Run (with 8-minute timeout for Go sequential inserts)
        Write-Host "   [4/4] Running sample (timeout: 8m)..." -NoNewline
        $log += "[4/4] Running sample (timeout: 8m)"
        
        $timeoutSeconds = 480  # 8 minutes (Go vector-search needs ~7 min due to sequential inserts)
        $runOutput = $null
        $timedOut = $false
        
        # Use a script block with job to enforce timeout
        $scriptBlock = {
            param($samplePath, $sampleType)
            Push-Location $samplePath
            
            $output = @()
            
            switch ($sampleType) {
                'typescript' {
                    $output += (npm run start 2>&1)
                }
                'python' {
                    & .\.venv\Scripts\Activate.ps1 | Out-Null
                    $output += (python -m src.index 2>&1)
                }
                'java' {
                    $output += (mvn exec:java 2>&1)
                }
                'go' {
                    # Try app.exe first (Windows cross-compile), fall back to app
                    $appBinary = if (Test-Path '.\app.exe') { '.\app.exe' } else { '.\app' }
                    if (Test-Path $appBinary) {
                        $output += (& $appBinary 2>&1)
                    } else {
                        $output += "ERROR: Binary not found at $appBinary"
                    }
                }
                'dotnet' {
                    # Provide menu input: choice 5 (diskann) then 0 (exit)
                    $output += ("5`n0" | dotnet run 2>&1)
                }
            }
            Pop-Location
            return $output
        }
        
        try {
            $job = Start-Job -ScriptBlock $scriptBlock -ArgumentList $samplePath, $sample.type
            $jobResult = Wait-Job -Job $job -Timeout $timeoutSeconds
            
            if ($null -eq $jobResult) {
                # Timeout occurred
                $timedOut = $true
                Write-Host " ⏱️" -ForegroundColor Yellow
                Write-Host "   ⚠️  TIMEOUT: Sample exceeded 5 minutes" -ForegroundColor Yellow
                $log += "TIMEOUT: Sample execution exceeded 5 minutes and was terminated"
                
                # Stop the job
                Stop-Job -Job $job
                Remove-Job -Job $job -Force
                $status = 'TIMEOUT'
            } else {
                # Job completed
                $runOutput = Receive-Job -Job $job -Wait
                Remove-Job -Job $job
                
                if ($runOutput) {
                    $log += ($runOutput -join "`n")
                } else {
                    $log += "[No output captured]"
                }
                Write-Host " ✓" -ForegroundColor Green
                $log += ""
                
                $status = 'PASS'
                Write-Host "   ✅ PASSED" -ForegroundColor Green
            }
        }
        catch {
            Write-Host " ❌" -ForegroundColor Red
            Write-Host "   ❌ FAILED: $($_.Exception.Message)" -ForegroundColor Red
            $log += ""
            $log += "ERROR during execution: $($_.Exception.Message)"
            $log += $_.ScriptStackTrace
            $status = 'FAIL'
            $errorMsg = $_.Exception.Message
        }
        
        $log += ""
        
        # Save log
        $log += ""
        $log += "End: $(Get-Date -Format 'o')"
        $log | Out-File -FilePath $logFile -Encoding UTF8
        Write-Host "   Log: $logFile"
    }
    catch {
        $status = 'FAIL'
        $errorMsg = $_.Exception.Message
        Write-Host " ❌" -ForegroundColor Red
        Write-Host "   ❌ FAILED: $errorMsg" -ForegroundColor Red
        
        $log += ""
        $log += "ERROR: $errorMsg"
        $log += $_.ScriptStackTrace
        $log | Out-File -FilePath $logFile -Encoding UTF8
        Write-Host "   Log: $logFile"
    }
    finally {
        $sw.Stop()
        $duration = $sw.Elapsed
    }
    
    # Save log file if not already saved (timeout/fail paths save above)
    if ($status -ne 'FAIL') {
        $log += ""
        $log += "End: $(Get-Date -Format 'o')"
        $log | Out-File -FilePath $logFile -Encoding UTF8
        if ($status -eq 'TIMEOUT') {
            Write-Host "   Log: $logFile"
        } else {
            Write-Host "   Log: $logFile"
        }
    }
    
    Write-Host ""
    
    $results += @{
        name = $sample.name
        language = $sample.language
        type = $sample.type
        sample = $sample.sample
        status = $status
        error = $errorMsg
        duration = $duration
    }
}

# Summary
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
Write-Host "📊 Summary" -ForegroundColor Cyan
Write-Host ""

$passed = @($results | Where-Object { $_.status -eq 'PASS' }).Count
$failed = @($results | Where-Object { $_.status -eq 'FAIL' }).Count
$timedout = @($results | Where-Object { $_.status -eq 'TIMEOUT' }).Count
$other = @($results | Where-Object { $_.status -ne 'PASS' -and $_.status -ne 'FAIL' -and $_.status -ne 'TIMEOUT' }).Count

$results | ForEach-Object {
    $icon = switch ($_.status) {
        'PASS' { "✅" }
        'FAIL' { "❌" }
        'TIMEOUT' { "⏱️" }
        default { "⚠️" }
    }
    $duration = if ($_.duration) { "$($_.duration.TotalSeconds)s" } else { "—" }
    Write-Host "$icon $($_.language.PadRight(10)) | $($_.sample.PadRight(12)) | $($_.name.PadRight(30)) | $duration"
    if ($_.error) {
        Write-Host "   └─ Error: $($_.error)"
    }
}

Write-Host ""
Write-Host "Results: $passed passed, $failed failed, $timedout timeout, $other skipped" -ForegroundColor $(if ($failed -eq 0 -and $timedout -eq 0) { 'Green' } else { 'Red' })
Write-Host "Logs: $OutputDir"
Write-Host ""

$totalDuration = (Get-Date) - $startTime
Write-Host "Total time: $($totalDuration.TotalMinutes)m $($totalDuration.Seconds)s" -ForegroundColor Cyan

# Exit with appropriate code
exit $(if ($failed -eq 0 -and $timedout -eq 0) { 0 } else { 1 })
