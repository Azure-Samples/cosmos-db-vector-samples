#!/usr/bin/env pwsh
<#
.SYNOPSIS
Remove generated files from the create-index samples.

.DESCRIPTION
Cleans local build, dependency, runtime configuration, copied data, and run
output artifacts from the create-index samples. Committed source files,
configuration templates, README files, and package manifests are preserved.

.PARAMETER Language
Which language(s) to clean. Default: All.
Accepted values: All, Python, TypeScript, DotNet, Go, Java.

.PARAMETER WhatIf
Shows the paths that would be removed without removing them.

.PARAMETER RemoveCopiedData
Removes the region-based JSON files copied into sample data directories by
the azd postprovision hook. Use only after all testing is complete.

.EXAMPLE
.\clean-all-create-index.ps1
.\clean-all-create-index.ps1 -Language Python
.\clean-all-create-index.ps1 -Language DotNet
#>
param(
    [ValidateSet('All', 'Python', 'TypeScript', 'DotNet', 'Go', 'Java')]
    [string]$Language = 'All',

    [switch]$WhatIf,

    [switch]$RemoveCopiedData
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = (Get-Item $PSScriptRoot).Parent.Parent.FullName

function Remove-GeneratedPath([string]$Path) {
    if (Test-Path -LiteralPath $Path) {
        if ($WhatIf) {
            Write-Host "  Would remove: $Path" -ForegroundColor DarkYellow
            return
        }
        Remove-Item -LiteralPath $Path -Recurse -Force
        Write-Host "  Removed: $Path" -ForegroundColor DarkGray
    }
}

function Remove-GeneratedFiles([string]$SampleDir, [string[]]$Names) {
    foreach ($name in $Names) {
        Get-ChildItem -LiteralPath $SampleDir -Filter $name -File -Recurse -Force -ErrorAction SilentlyContinue |
            ForEach-Object { Remove-GeneratedPath $_.FullName }
    }
}

function Remove-GeneratedDirectories([string]$SampleDir, [string[]]$Names, [string[]]$ExcludedRoots) {
    $excludedPaths = $ExcludedRoots | ForEach-Object {
        [System.IO.Path]::GetFullPath((Join-Path $SampleDir $_)).TrimEnd([IO.Path]::DirectorySeparatorChar)
    }
    foreach ($name in $Names) {
        Get-ChildItem -LiteralPath $SampleDir -Directory -Recurse -Force -ErrorAction SilentlyContinue |
            Where-Object {
                $candidate = $_
                $candidate.Name -eq $name -and
                -not ($excludedPaths | Where-Object {
                    $_.Length -gt 0 -and $candidate.FullName.StartsWith($_ + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
                })
            } |
            Sort-Object FullName -Descending |
            ForEach-Object { Remove-GeneratedPath $_.FullName }
    }
}

function Clean-Sample([string]$SampleName, [string[]]$Paths, [string[]]$FilePatterns) {
    $sampleDir = Join-Path $RepoRoot "nosql-create-index-$SampleName"
    if (-not (Test-Path -LiteralPath $sampleDir -PathType Container)) {
        Write-Warning "Sample directory not found: $sampleDir"
        $script:MissingSamples += $SampleName
        return
    }

    Write-Host "Cleaning $SampleName..." -ForegroundColor Cyan
    foreach ($path in $Paths) {
        Remove-GeneratedPath (Join-Path $sampleDir $path)
    }
    Remove-GeneratedDirectories $sampleDir @('__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', 'bin', 'obj', 'target') $Paths
    Remove-GeneratedFiles $sampleDir $FilePatterns

    if ($RemoveCopiedData) {
        foreach ($copiedFile in @(
            'HotelsData_toCosmosDB_byRegion.json',
            'HotelsData_toCosmosDB_Vector_byRegion.json'
        )) {
            Remove-GeneratedPath (Join-Path $sampleDir "data\$copiedFile")
        }
    }
    else {
        Write-Host '  Preserving azd-copied data files. Use -RemoveCopiedData only after testing is complete.' -ForegroundColor DarkYellow
    }

    $outputDir = Join-Path $sampleDir 'output'
    if (Test-Path -LiteralPath $outputDir -PathType Container) {
        Get-ChildItem -LiteralPath $outputDir -File -Force -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match '^(run-|.*-run\.).*\.(txt|log)$' } |
            ForEach-Object { Remove-GeneratedPath $_.FullName }
        Get-ChildItem -LiteralPath $outputDir -Directory -Force -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match '^(?:create-index-run-|run-)\d{8}-\d{6}$|^\d{8}-\d{6}$' } |
            ForEach-Object { Remove-GeneratedPath $_.FullName }
    }
}

Write-Host 'Cleaning generated create-index artifacts...' -ForegroundColor Yellow
Write-Host "  Repo root: $RepoRoot"
Write-Host "  Language : $Language"
Write-Host "  Data     : $(if ($RemoveCopiedData) { 'remove azd-copied data' } else { 'preserve azd-copied data' })"
$MissingSamples = [System.Collections.Generic.List[string]]::new()

if ($Language -in @('All', 'Python')) {
    Clean-Sample 'python' @('.venv', 'output2') @('.env', '*.pyc', '*.pyo')
}

if ($Language -in @('All', 'TypeScript')) {
    Clean-Sample 'typescript' @('node_modules', 'dist', 'coverage', 'output2') @('.env', '*.tsbuildinfo')
}

if ($Language -in @('All', 'DotNet')) {
    Clean-Sample 'dotnet' @('bin', 'obj', 'output2') @('appsettings.json')
}

if ($Language -in @('All', 'Go')) {
    Clean-Sample 'go' @('output2') @('create-index-go.exe', 'create-index-go')
}

if ($Language -in @('All', 'Java')) {
    Clean-Sample 'java' @('target', 'output2') @('.env')
}

$validationOutputDir = Join-Path $RepoRoot '.github\scripts\output'
if (Test-Path -LiteralPath $validationOutputDir -PathType Container) {
    Get-ChildItem -LiteralPath $validationOutputDir -Directory -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^validation-\d{8}-\d{6}$' } |
        ForEach-Object { Remove-GeneratedPath $_.FullName }
}

if ($MissingSamples.Count -gt 0) {
    Write-Error "Cleanup failed because these sample directories were not found: $($MissingSamples -join ', ')"
    exit 1
}

if ($WhatIf) {
    Write-Host 'Dry run complete. No files were removed.' -ForegroundColor Green
}
else {
    Write-Host 'Cleanup complete.' -ForegroundColor Green
    if ($RemoveCopiedData) {
        Write-Host "  Copied data removed only for: $Language" -ForegroundColor Yellow
        Write-Host '  Restore copied data with: azd provision' -ForegroundColor Yellow
    }
}
