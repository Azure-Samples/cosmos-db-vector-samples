#!/usr/bin/env pwsh

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

$SkillRoot = (Get-Item $PSScriptRoot).Parent.FullName
$RepoRoot = (& git -C $PSScriptRoot rev-parse --show-toplevel).Trim()
$Validator = Join-Path $SkillRoot 'scripts\validate-sample-set.ps1'
$Manifest = Join-Path $SkillRoot 'manifests\nosql-create-index.json'
$Reference = Join-Path $PSScriptRoot 'fixtures\reference-output.txt'
$WorkRoot = Join-Path $PSScriptRoot '.work'

function Invoke-Validator {
    param(
        [string]$Name,
        [string[]]$Arguments,
        [int]$ExpectedExitCode,
        [string]$ExpectedText
    )

    $output = @(& pwsh -NoProfile -File $Validator @Arguments 2>&1)
    $actualExitCode = $LASTEXITCODE
    $text = $output -join "`n"
    if ($actualExitCode -ne $ExpectedExitCode) {
        throw "$Name expected exit code $ExpectedExitCode but found $actualExitCode.`n$text"
    }
    if ($ExpectedText -and $text -notmatch [regex]::Escape($ExpectedText)) {
        throw "$Name did not contain expected diagnostic '$ExpectedText'.`n$text"
    }
    Write-Host "PASS: $Name"
}

function Get-FileArguments {
    param(
        [string]$Actual,
        [string]$ReferencePath = $Reference,
        [string]$ManifestPath = $Manifest
    )

    return @(
        '-ManifestPath', $ManifestPath,
        '-ActualPath', $Actual,
        '-ReferencePath', $ReferencePath
    )
}

Push-Location $RepoRoot
try {
    Invoke-Validator -Name 'valid output' `
        -Arguments (Get-FileArguments (Join-Path $PSScriptRoot 'fixtures\valid-output.txt')) `
        -ExpectedExitCode 0 `
        -ExpectedText 'PASS: Output structure and semantic keys are valid.'
    Invoke-Validator -Name 'escaped pipe output' `
        -Arguments (Get-FileArguments (Join-Path $PSScriptRoot 'fixtures\escaped-pipe-output.txt')) `
        -ExpectedExitCode 0 `
        -ExpectedText 'PASS: Output structure and semantic keys are valid.'
    Invoke-Validator -Name 'fenced trailing table ignored' `
        -Arguments (Get-FileArguments (Join-Path $PSScriptRoot 'fixtures\fenced-table-output.txt')) `
        -ExpectedExitCode 0 `
        -ExpectedText 'PASS: Output structure and semantic keys are valid.'
    Invoke-Validator -Name 'missing semantic key' `
        -Arguments (Get-FileArguments (Join-Path $PSScriptRoot 'fixtures\missing-output.txt')) `
        -ExpectedExitCode 1 `
        -ExpectedText "Expected semantic key 'QuantizedFlat|Euclidean' exactly once; found 0."
    Invoke-Validator -Name 'duplicate semantic key' `
        -Arguments (Get-FileArguments (Join-Path $PSScriptRoot 'fixtures\duplicate-output.txt')) `
        -ExpectedExitCode 1 `
        -ExpectedText "Expected semantic key 'QuantizedFlat|DotProduct' exactly once; found 2."
    Invoke-Validator -Name 'unexpected semantic key' `
        -Arguments (Get-FileArguments (Join-Path $PSScriptRoot 'fixtures\unexpected-output.txt')) `
        -ExpectedExitCode 1 `
        -ExpectedText "Final table contains unexpected semantic key 'hotels_hnsw|Euclidean'."
    Invoke-Validator -Name 'header mismatch' `
        -Arguments (Get-FileArguments (Join-Path $PSScriptRoot 'fixtures\header-mismatch-output.txt')) `
        -ExpectedExitCode 1 `
        -ExpectedText 'Normalized headers differ.'
    Invoke-Validator -Name 'ragged row' `
        -Arguments (Get-FileArguments (Join-Path $PSScriptRoot 'fixtures\ragged-output.txt')) `
        -ExpectedExitCode 1 `
        -ExpectedText 'A table row has 2 cells; expected 3.'
    Invoke-Validator -Name 'missing table' `
        -Arguments (Get-FileArguments (Join-Path $PSScriptRoot 'fixtures\no-table-output.txt')) `
        -ExpectedExitCode 1 `
        -ExpectedText 'No Markdown table separator was found.'
    Invoke-Validator -Name 'invalid reference semantics' `
        -Arguments (Get-FileArguments `
            (Join-Path $PSScriptRoot 'fixtures\valid-output.txt') `
            (Join-Path $PSScriptRoot 'fixtures\invalid-reference-output.txt')) `
        -ExpectedExitCode 1 `
        -ExpectedText "Reference table must contain semantic key 'QuantizedFlat|Euclidean' exactly once; found 0."
    Invoke-Validator -Name 'repository path escape rejected' `
        -Arguments (Get-FileArguments '..\outside-repository.txt') `
        -ExpectedExitCode 1 `
        -ExpectedText 'Path must remain inside the repository'
    Invoke-Validator -Name 'invalid manifest rejected' `
        -Arguments (Get-FileArguments `
            (Join-Path $PSScriptRoot 'fixtures\valid-output.txt') `
            $Reference `
            (Join-Path $PSScriptRoot 'fixtures\invalid-version-manifest.json')) `
        -ExpectedExitCode 1 `
        -ExpectedText 'The JSON is not valid with the schema'

    $integrationManifest = Join-Path $PSScriptRoot 'fixtures\integration-manifest.json'
    $sampleWork = Join-Path $WorkRoot 'sample'
    New-Item -ItemType Directory -Path $sampleWork -Force | Out-Null
    Copy-Item -LiteralPath $Reference -Destination (
        Join-Path $sampleWork 'reference-output.txt'
    ) -Force

    Invoke-Validator -Name 'offline runner integration' `
        -Arguments @(
            '-ManifestPath', $integrationManifest,
            '-Sample', 'Sample',
            '-AllowRunnerExecution'
        ) `
        -ExpectedExitCode 0 `
        -ExpectedText 'All selected samples passed validation.'

    $env:SAMPLE_VALIDATE_SET_FAKE_EXIT_CODE = '7'
    Invoke-Validator -Name 'runner failure remains failure' `
        -Arguments @(
            '-ManifestPath', $integrationManifest,
            '-Sample', 'Sample',
            '-AllowRunnerExecution'
        ) `
        -ExpectedExitCode 1 `
        -ExpectedText 'Runner exit code: 7'
    Remove-Item Env:SAMPLE_VALIDATE_SET_FAKE_EXIT_CODE

    Invoke-Validator -Name 'unknown sample diagnostic' `
        -Arguments @(
            '-ManifestPath', $integrationManifest,
            '-Sample', 'Unknown',
            '-AllowRunnerExecution'
        ) `
        -ExpectedExitCode 1 `
        -ExpectedText "Unknown sample 'Unknown'."
}
finally {
    Remove-Item Env:SAMPLE_VALIDATE_SET_FAKE_EXIT_CODE -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $WorkRoot -Recurse -Force -ErrorAction SilentlyContinue
    Pop-Location
}
