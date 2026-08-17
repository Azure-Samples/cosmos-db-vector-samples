#!/usr/bin/env pwsh
<#
.SYNOPSIS
Build, run, and capture output for all create-index samples.

.DESCRIPTION
Assumes 'azd up' has already been run and the user is signed in via
'az login' / 'azd auth login' (DefaultAzureCredential).

For each selected sample this script:
  1. Loads all environment variables from 'azd env get-values'.
  2. Verifies the required data file exists in the sample's ./data/ directory.
  3. Builds the sample.
  4. Runs the sample program, tee-ing combined stdout+stderr to both the
    console and <sample>/output/create-index-run-<yyyyMMdd-HHmmss>/run-<language>.txt.
  5. Prints a per-language summary table (built, ran, exit code, output path).

Exits non-zero if any selected sample fails to build or run.

.PARAMETER Language
Which language(s) to run. Default: All.
Accepted values: All, Python, TypeScript, DotNet, Go, Java.

.EXAMPLE
.\run-all-create-index.ps1
.\run-all-create-index.ps1 -Language Python
.\run-all-create-index.ps1 -Language DotNet
#>
param(
    [ValidateSet('All', 'Python', 'TypeScript', 'DotNet', 'Go', 'Java')]
    [string]$Language = 'All'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot  = (Get-Item $PSScriptRoot).Parent.Parent.FullName
$Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'

# ── Helpers ──────────────────────────────────────────────────────────────────

function Write-Header([string]$Msg) {
    Write-Host ''
    Write-Host ('─' * 60) -ForegroundColor Yellow
    Write-Host "  $Msg" -ForegroundColor Yellow
    Write-Host ('─' * 60) -ForegroundColor Yellow
}

function New-Result {
    param(
        [string]$Lang,
        [bool]$Skipped    = $false,
        [string]$SkipReason = '',
        [bool]$Built      = $false,
        [bool]$Ran        = $false,
        [int]$ExitCode    = -1,
        [string]$OutFile  = ''
    )
    [PSCustomObject]@{
        Language   = $Lang
        Skipped    = $Skipped
        SkipReason = $SkipReason
        Built      = $Built
        Ran        = $Ran
        ExitCode   = $ExitCode
        OutputFile = $OutFile
    }
}

# Runs 'azd env get-values' from the repo root and exports all KEY=VALUE pairs
# into the current process environment so child processes inherit them.
function Get-AzdEnvVars {
    Write-Host 'Loading env vars via azd env get-values...' -ForegroundColor Cyan
    Push-Location $RepoRoot
    try {
        $raw = azd env get-values 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "azd env get-values failed (exit $LASTEXITCODE). Run 'azd up' first."
        }
    }
    finally {
        Pop-Location
    }
    $vars = @{}
    foreach ($line in $raw) {
        if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
            $key = $Matches[1]
            $val = $Matches[2].Trim().Trim('"').Trim("'")
            $vars[$key] = $val
            [Environment]::SetEnvironmentVariable($key, $val, 'Process')
        }
    }
    Write-Host "  Loaded $($vars.Count) env vars from azd." -ForegroundColor Green
    return $vars
}

# Returns the absolute path of the data file if it exists in the sample dir,
# or $null (with a warning) if it is missing.
function Resolve-DataFile([string]$SampleDir, [hashtable]$Vars) {
    $rel = if ($Vars.ContainsKey('DATA_FILE_WITH_VECTORS_AND_REGIONS')) { $Vars['DATA_FILE_WITH_VECTORS_AND_REGIONS'] } else { $null }
    if (-not $rel) {
        $rel = if ($Vars.ContainsKey('DATA_FILE_WITH_VECTORS')) { $Vars['DATA_FILE_WITH_VECTORS'] } else { $null }
    }
    if (-not $rel) {
        Write-Warning 'Neither DATA_FILE_WITH_VECTORS_AND_REGIONS nor DATA_FILE_WITH_VECTORS is set in the azd env.'
        return $null
    }
    $abs = [IO.Path]::GetFullPath($rel, $SampleDir)
    if (-not (Test-Path $abs)) {
        Write-Warning "Data file not found: $abs  (env='$rel', sample dir='$SampleDir'). Skipping this sample."
        return $null
    }
    return $abs
}

# ── Startup ───────────────────────────────────────────────────────────────────

Write-Header "run-all-create-index  $Timestamp"
Write-Host "  Repo root : $RepoRoot"
Write-Host "  Language  : $Language"

$Vars    = Get-AzdEnvVars
$Results = [System.Collections.Generic.List[PSCustomObject]]::new()

# ── Python ────────────────────────────────────────────────────────────────────

if ($Language -in @('All', 'Python')) {
    Write-Header 'Python'
    $dir     = Join-Path $RepoRoot 'nosql-create-index-python'
    $outFile = Join-Path $dir "output\create-index-run-$Timestamp\run-python.txt"

    if (-not (Test-Path $dir)) {
        Write-Warning "Sample directory not found: $dir"
        $Results.Add((New-Result -Lang 'Python' -Skipped $true -SkipReason 'Directory not found'))
    }
    elseif (-not (Resolve-DataFile $dir $Vars)) {
        $Results.Add((New-Result -Lang 'Python' -Skipped $true -SkipReason 'Data file missing'))
    }
    else {
        $built = $false; $ran = $false; $rc = -1
        Push-Location $dir
        try {
            # Build: create venv (if absent) and install dependencies
            if (-not (Test-Path '.venv')) {
                Write-Host '  Creating Python virtual environment...' -ForegroundColor Cyan
                python -m venv .venv
                if ($LASTEXITCODE -ne 0) { throw "python -m venv failed (exit $LASTEXITCODE)" }
            }
            Write-Host '  pip install -r requirements.txt...' -ForegroundColor Cyan
            .\.venv\Scripts\pip.exe install -q -r requirements.txt
            if ($LASTEXITCODE -ne 0) { throw "pip install failed (exit $LASTEXITCODE)" }
            $built = $true
            Write-Host '  ✅ Build succeeded.' -ForegroundColor Green

            # Run — PYTHONUTF8=1 forces UTF-8 stdout on Windows (avoids charmap errors with Unicode output)
            Write-Host "  Running: python -m src.index  →  $outFile" -ForegroundColor Cyan
            $null = New-Item -ItemType Directory -Force -Path (Split-Path $outFile)
            $env:PYTHONUTF8 = '1'
            .\.venv\Scripts\python.exe -m src.index 2>&1 | Tee-Object -FilePath $outFile
            $rc  = $LASTEXITCODE
            $ran = $true
            if ($rc -eq 0) {
                Write-Host '  ✅ Run succeeded.' -ForegroundColor Green
            }
            else {
                Write-Host "  ❌ Run failed (exit $rc). Check $outFile for details." -ForegroundColor Red
                Write-Host '     Auth errors: ensure az login / azd auth login is current.' -ForegroundColor Yellow
            }
        }
        catch {
            Write-Host "  ❌ $_" -ForegroundColor Red
        }
        finally {
            Pop-Location
        }
        $Results.Add((New-Result -Lang 'Python' -Built $built -Ran $ran -ExitCode $rc -OutFile $outFile))
    }
}

# ── TypeScript ────────────────────────────────────────────────────────────────

if ($Language -in @('All', 'TypeScript')) {
    Write-Header 'TypeScript'
    $dir     = Join-Path $RepoRoot 'nosql-create-index-typescript'
    $outFile = Join-Path $dir "output\create-index-run-$Timestamp\run-typescript.txt"

    if (-not (Test-Path $dir)) {
        Write-Warning "Sample directory not found: $dir"
        $Results.Add((New-Result -Lang 'TypeScript' -Skipped $true -SkipReason 'Directory not found'))
    }
    elseif (-not (Resolve-DataFile $dir $Vars)) {
        $Results.Add((New-Result -Lang 'TypeScript' -Skipped $true -SkipReason 'Data file missing'))
    }
    else {
        $built = $false; $ran = $false; $rc = -1
        Push-Location $dir
        try {
            # Build: install npm deps and compile TypeScript
            Write-Host '  npm install...' -ForegroundColor Cyan
            npm install --silent
            if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE)" }
            Write-Host '  npx tsc...' -ForegroundColor Cyan
            npx tsc
            if ($LASTEXITCODE -ne 0) { throw "tsc failed (exit $LASTEXITCODE)" }
            $built = $true
            Write-Host '  ✅ Build succeeded.' -ForegroundColor Green

            # Run — env vars are already in the process environment; no .env file needed
            Write-Host "  Running: node dist/index.js  →  $outFile" -ForegroundColor Cyan
            $null = New-Item -ItemType Directory -Force -Path (Split-Path $outFile)
            node dist/index.js 2>&1 | Tee-Object -FilePath $outFile
            $rc  = $LASTEXITCODE
            $ran = $true
            if ($rc -eq 0) {
                Write-Host '  ✅ Run succeeded.' -ForegroundColor Green
            }
            else {
                Write-Host "  ❌ Run failed (exit $rc). Check $outFile for details." -ForegroundColor Red
                Write-Host '     Auth errors: ensure az login / azd auth login is current.' -ForegroundColor Yellow
            }
        }
        catch {
            Write-Host "  ❌ $_" -ForegroundColor Red
        }
        finally {
            Pop-Location
        }
        $Results.Add((New-Result -Lang 'TypeScript' -Built $built -Ran $ran -ExitCode $rc -OutFile $outFile))
    }
}

# ── .NET ──────────────────────────────────────────────────────────────────────

if ($Language -in @('All', 'DotNet')) {
    Write-Header '.NET'
    $dir     = Join-Path $RepoRoot 'nosql-create-index-dotnet'
    $outFile = Join-Path $dir "output\create-index-run-$Timestamp\run-dotnet.txt"
    $csproj  = 'nosql-create-index-dotnet.csproj'

    if (-not (Test-Path $dir)) {
        Write-Warning "Sample directory not found: $dir"
        $Results.Add((New-Result -Lang 'DotNet' -Skipped $true -SkipReason 'Directory not found'))
    }
    elseif (-not (Resolve-DataFile $dir $Vars)) {
        $Results.Add((New-Result -Lang 'DotNet' -Skipped $true -SkipReason 'Data file missing'))
    }
    else {
        $built = $false; $ran = $false; $rc = -1
        Push-Location $dir
        try {
            # Build
            Write-Host '  dotnet restore...' -ForegroundColor Cyan
            dotnet restore --nologo -v quiet
            if ($LASTEXITCODE -ne 0) { throw "dotnet restore failed (exit $LASTEXITCODE)" }
            Write-Host '  dotnet build (Release)...' -ForegroundColor Cyan
            dotnet build --configuration Release --no-restore --nologo
            if ($LASTEXITCODE -ne 0) { throw "dotnet build failed (exit $LASTEXITCODE)" }
            $built = $true
            Write-Host '  ✅ Build succeeded.' -ForegroundColor Green

            # Run — appsettings.json is overridden by the env vars set above
            Write-Host "  Running: dotnet run --project $csproj  →  $outFile" -ForegroundColor Cyan
            $null = New-Item -ItemType Directory -Force -Path (Split-Path $outFile)
            dotnet run --project $csproj --configuration Release --no-build 2>&1 | Tee-Object -FilePath $outFile
            $rc  = $LASTEXITCODE
            $ran = $true
            if ($rc -eq 0) {
                Write-Host '  ✅ Run succeeded.' -ForegroundColor Green
            }
            else {
                Write-Host "  ❌ Run failed (exit $rc). Check $outFile for details." -ForegroundColor Red
                Write-Host '     Auth errors: ensure az login / azd auth login is current.' -ForegroundColor Yellow
            }
        }
        catch {
            Write-Host "  ❌ $_" -ForegroundColor Red
        }
        finally {
            Pop-Location
        }
        $Results.Add((New-Result -Lang 'DotNet' -Built $built -Ran $ran -ExitCode $rc -OutFile $outFile))
    }
}

# ── Go ────────────────────────────────────────────────────────────────────────

if ($Language -in @('All', 'Go')) {
    Write-Header 'Go'
    $dir     = Join-Path $RepoRoot 'nosql-create-index-go'
    $outFile = Join-Path $dir "output\create-index-run-$Timestamp\run-go.txt"
    $binary  = 'create-index-go.exe'

    if (-not (Test-Path $dir)) {
        Write-Warning "Sample directory not found: $dir"
        $Results.Add((New-Result -Lang 'Go' -Skipped $true -SkipReason 'Directory not found'))
    }
    elseif (-not (Resolve-DataFile $dir $Vars)) {
        $Results.Add((New-Result -Lang 'Go' -Skipped $true -SkipReason 'Data file missing'))
    }
    else {
        $built = $false; $ran = $false; $rc = -1
        Push-Location $dir
        try {
            # Build
            Write-Host '  go mod download...' -ForegroundColor Cyan
            go mod download
            if ($LASTEXITCODE -ne 0) { throw "go mod download failed (exit $LASTEXITCODE)" }
            Write-Host "  go build -o $binary ..." -ForegroundColor Cyan
            go build -o $binary .
            if ($LASTEXITCODE -ne 0) { throw "go build failed (exit $LASTEXITCODE)" }
            $built = $true
            Write-Host '  ✅ Build succeeded.' -ForegroundColor Green

            # Run
            Write-Host "  Running: .\$binary  →  $outFile" -ForegroundColor Cyan
            $null = New-Item -ItemType Directory -Force -Path (Split-Path $outFile)
            & ".\$binary" 2>&1 | Tee-Object -FilePath $outFile
            $rc  = $LASTEXITCODE
            $ran = $true
            if ($rc -eq 0) {
                Write-Host '  ✅ Run succeeded.' -ForegroundColor Green
            }
            else {
                Write-Host "  ❌ Run failed (exit $rc). Check $outFile for details." -ForegroundColor Red
                Write-Host '     Auth errors: ensure az login / azd auth login is current.' -ForegroundColor Yellow
            }
        }
        catch {
            Write-Host "  ❌ $_" -ForegroundColor Red
        }
        finally {
            Pop-Location
        }
        $Results.Add((New-Result -Lang 'Go' -Built $built -Ran $ran -ExitCode $rc -OutFile $outFile))
    }
}

# ── Java ──────────────────────────────────────────────────────────────────────

if ($Language -in @('All', 'Java')) {
    Write-Header 'Java'
    $dir     = Join-Path $RepoRoot 'nosql-create-index-java'
    $outFile = Join-Path $dir "output\create-index-run-$Timestamp\run-java.txt"

    if (-not (Test-Path $dir)) {
        Write-Warning "Sample directory not found: $dir"
        $Results.Add((New-Result -Lang 'Java' -Skipped $true -SkipReason 'Directory not found'))
    }
    elseif (-not (Resolve-DataFile $dir $Vars)) {
        $Results.Add((New-Result -Lang 'Java' -Skipped $true -SkipReason 'Data file missing'))
    }
    else {
        $built = $false; $ran = $false; $rc = -1
        Push-Location $dir
        try {
            # Build
            Write-Host '  mvn compile...' -ForegroundColor Cyan
            mvn compile -q
            if ($LASTEXITCODE -ne 0) { throw "mvn compile failed (exit $LASTEXITCODE)" }
            $built = $true
            Write-Host '  ✅ Build succeeded.' -ForegroundColor Green

            # Run (main class: com.azure.cosmos.createindex.App)
            Write-Host "  Running: mvn exec:java  →  $outFile" -ForegroundColor Cyan
            $null = New-Item -ItemType Directory -Force -Path (Split-Path $outFile)
            mvn exec:java 2>&1 | Tee-Object -FilePath $outFile
            $rc  = $LASTEXITCODE
            $ran = $true
            if ($rc -eq 0) {
                Write-Host '  ✅ Run succeeded.' -ForegroundColor Green
            }
            else {
                Write-Host "  ❌ Run failed (exit $rc). Check $outFile for details." -ForegroundColor Red
                Write-Host '     Auth errors: ensure az login / azd auth login is current.' -ForegroundColor Yellow
            }
        }
        catch {
            Write-Host "  ❌ $_" -ForegroundColor Red
        }
        finally {
            Pop-Location
        }
        $Results.Add((New-Result -Lang 'Java' -Built $built -Ran $ran -ExitCode $rc -OutFile $outFile))
    }
}

# ── Summary ───────────────────────────────────────────────────────────────────

Write-Header 'Summary'
$fmt = '{0,-12} {1,-7} {2,-7} {3,-8} {4}'
Write-Host ($fmt -f 'Language', 'Built', 'Ran', 'Exit', 'OutputFile')
Write-Host ('-' * 90)

$anyFailed = $false
foreach ($r in $Results) {
    if ($r.Skipped) {
        $builtS = 'SKIP'
        $ranS   = 'SKIP'
        $exitS  = 'FAIL'
        $fileS  = "(FAILED: skipped because $($r.SkipReason))"
        $color  = 'Red'
        $anyFailed = $true
    }
    else {
        $builtS = if ($r.Built) { 'yes' } else { 'FAIL' }
        $ranS   = if (-not $r.Ran)            { '—'    }
                  elseif ($r.ExitCode -eq 0)  { 'yes'  }
                  else                         { 'FAIL' }
        $exitS  = if ($r.Ran) { "$($r.ExitCode)" } else { '—' }
        $fileS  = if ($r.Ran) { $r.OutputFile } else { '(not run)' }
        $ok     = $r.Built -and $r.Ran -and ($r.ExitCode -eq 0)
        $color  = if ($ok) { 'Green' } else { 'Red' }
        if (-not $ok) { $anyFailed = $true }
    }
    Write-Host ($fmt -f $r.Language, $builtS, $ranS, $exitS, $fileS) -ForegroundColor $color
}

Write-Host ''
if ($anyFailed) {
    Write-Host '⚠  One or more samples failed. Review the output files listed above.' -ForegroundColor Red
    Write-Host '   Auth failures: ensure az login / azd auth login is current.' -ForegroundColor Yellow
    exit 1
}
else {
    Write-Host '✅ All selected samples completed successfully.' -ForegroundColor Green
    exit 0
}
