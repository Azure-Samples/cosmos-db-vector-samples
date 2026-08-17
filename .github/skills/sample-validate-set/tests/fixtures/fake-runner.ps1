#!/usr/bin/env pwsh
param([string]$Selection = 'All')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (& git -C $PSScriptRoot rev-parse --show-toplevel).Trim()
$runDirectory = Join-Path $repoRoot (
    ".github\skills\sample-validate-set\tests\.work\sample\output\fake-run-$([guid]::NewGuid().ToString('N'))"
)
New-Item -ItemType Directory -Path $runDirectory -Force | Out-Null
Copy-Item -LiteralPath (
    Join-Path $PSScriptRoot 'valid-output.txt'
) -Destination (
    Join-Path $runDirectory 'run-sample.txt'
)
Write-Host "Fake runner selection: $Selection"
exit ([int]($env:SAMPLE_VALIDATE_SET_FAKE_EXIT_CODE ?? '0'))
