#!/usr/bin/env pwsh
param(
    [Parameter(Mandatory, ParameterSetName = 'Run')]
    [Parameter(Mandatory, ParameterSetName = 'Files')]
    [string]$ManifestPath,

    [Parameter(ParameterSetName = 'Run')]
    [string]$Sample = 'All',

    [Parameter(Mandatory, ParameterSetName = 'Files')]
    [string]$ActualPath,

    [Parameter(Mandatory, ParameterSetName = 'Files')]
    [string]$ReferencePath,

    [Parameter(ParameterSetName = 'Run')]
    [switch]$AllowRunnerExecution,

    [Parameter(ParameterSetName = 'Run')]
    [Parameter(ParameterSetName = 'Files')]
    [string]$RepoRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($PSVersionTable.PSVersion.Major -lt 7) {
    throw 'sample-validate-set requires PowerShell 7 or later (pwsh).'
}

function Get-RepositoryRoot {
    param([string]$ExplicitRoot)

    if ($ExplicitRoot) {
        $resolved = (Resolve-Path -LiteralPath $ExplicitRoot).Path
        if (-not (Test-Path -LiteralPath (Join-Path $resolved '.git'))) {
            throw "RepoRoot is not a Git repository root: $resolved"
        }
        return $resolved
    }

    $gitRoot = & git -C $PSScriptRoot rev-parse --show-toplevel 2>$null
    if ($LASTEXITCODE -eq 0 -and $gitRoot) {
        return [IO.Path]::GetFullPath(([string]$gitRoot).Trim())
    }
    throw 'Unable to discover the repository root. Pass -RepoRoot explicitly.'
}

$RepoRoot = Get-RepositoryRoot -ExplicitRoot $RepoRoot

function Assert-NoReparsePoint {
    param([string]$Path)

    $current = $Path
    $comparison = if ($IsWindows) {
        [StringComparison]::OrdinalIgnoreCase
    }
    else {
        [StringComparison]::Ordinal
    }
    while ($current -and $current.StartsWith($RepoRoot, $comparison)) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Repository paths must not traverse symbolic links or junctions: $current"
            }
        }
        if ($current -eq $RepoRoot) {
            break
        }
        $current = Split-Path -Parent $current
    }
}

function Resolve-RepositoryPath {
    param(
        [Parameter(Mandatory)]
        [string]$Path,

        [switch]$MustExist
    )

    $candidate = if ([IO.Path]::IsPathRooted($Path)) {
        [IO.Path]::GetFullPath($Path)
    }
    else {
        [IO.Path]::GetFullPath($Path, $RepoRoot)
    }

    $rootWithSeparator = $RepoRoot.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    $comparison = if ($IsWindows) {
        [StringComparison]::OrdinalIgnoreCase
    }
    else {
        [StringComparison]::Ordinal
    }
    if ($candidate -ne $RepoRoot -and
        -not $candidate.StartsWith($rootWithSeparator, $comparison)) {
        throw "Path must remain inside the repository: $Path"
    }
    Assert-NoReparsePoint -Path $candidate
    if ($MustExist -and -not (Test-Path -LiteralPath $candidate)) {
        throw "Required path does not exist: $candidate"
    }
    return $candidate
}

function Read-Manifest {
    param([string]$Path)

    $resolved = Resolve-RepositoryPath -Path $Path -MustExist
    $manifestJson = Get-Content -LiteralPath $resolved -Raw
    $schemaPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'schema\sample-set-manifest.schema.json'
    if (-not (Test-Json -Json $manifestJson -SchemaFile $schemaPath -ErrorAction Stop)) {
        throw "Manifest does not match schema: $schemaPath"
    }
    $manifest = $manifestJson | ConvertFrom-Json -Depth 20

    if ($manifest.schemaVersion -isnot [long] -or $manifest.schemaVersion -ne 1) {
        throw "Unsupported manifest schemaVersion '$($manifest.schemaVersion)'. Expected 1."
    }
    foreach ($property in @('name', 'runner', 'evidence', 'samples', 'validation')) {
        if (-not $manifest.PSObject.Properties.Name.Contains($property)) {
            throw "Manifest is missing required property '$property'."
        }
    }
    if (-not $manifest.samples -or @($manifest.samples).Count -eq 0) {
        throw 'Manifest must configure at least one sample.'
    }
    if (-not $manifest.validation.table.keyColumns -or
        @($manifest.validation.table.keyColumns).Count -eq 0) {
        throw 'Manifest must configure at least one validation.table.keyColumns value.'
    }

    foreach ($property in @('path', 'arguments', 'allSelection')) {
        if (-not $manifest.runner.PSObject.Properties.Name.Contains($property)) {
            throw "Manifest runner is missing required property '$property'."
        }
    }
    foreach ($property in @('root', 'directoryPrefix', 'runnerLog', 'summary')) {
        if (-not $manifest.evidence.PSObject.Properties.Name.Contains($property)) {
            throw "Manifest evidence is missing required property '$property'."
        }
    }
    foreach ($leafProperty in @('directoryPrefix', 'runnerLog', 'summary')) {
        $value = [string]$manifest.evidence.$leafProperty
        if ([string]::IsNullOrWhiteSpace($value) -or $value -notmatch '^[A-Za-z0-9._-]+$') {
            throw "Manifest evidence.$leafProperty must contain only letters, numbers, dot, underscore, or hyphen."
        }
    }

    $requiredSampleProperties = @(
        'name',
        'selection',
        'directory',
        'outputDirectory',
        'runDirectoryPattern',
        'runFile',
        'reference'
    )
    $names = @{}
    $selections = @{}
    foreach ($sampleConfig in @($manifest.samples)) {
        foreach ($property in $requiredSampleProperties) {
            if (-not $sampleConfig.PSObject.Properties.Name.Contains($property) -or
                [string]::IsNullOrWhiteSpace([string]$sampleConfig.$property)) {
                throw "Manifest sample is missing nonempty property '$property'."
            }
        }
        $nameKey = ([string]$sampleConfig.name).ToLowerInvariant()
        $selectionKey = ([string]$sampleConfig.selection).ToLowerInvariant()
        if ($nameKey -eq 'all' -or $selectionKey -eq 'all') {
            throw "Manifest sample names and selections must not use reserved value 'All'."
        }
        if ($names.ContainsKey($nameKey) -or $selections.ContainsKey($selectionKey) -or
            $names.ContainsKey($selectionKey) -or $selections.ContainsKey($nameKey)) {
            throw "Manifest sample names and selections must be unique and non-overlapping: '$($sampleConfig.name)'."
        }
        $names[$nameKey] = $true
        $selections[$selectionKey] = $true
    }

    $tableConfig = $manifest.validation.table
    foreach ($property in @('headerAliases', 'keyColumns', 'valueAliases', 'expectedKeys', 'exactRowCount')) {
        if (-not $tableConfig.PSObject.Properties.Name.Contains($property)) {
            throw "Manifest validation.table is missing required property '$property'."
        }
    }
    $keyColumns = @($tableConfig.keyColumns)
    $expectedKeys = @($tableConfig.expectedKeys)
    if ($tableConfig.exactRowCount -isnot [long] -or $tableConfig.exactRowCount -lt 1) {
        throw 'Manifest validation.table.exactRowCount must be a positive integer.'
    }
    if ([int]$tableConfig.exactRowCount -ne $expectedKeys.Count) {
        throw 'Manifest exactRowCount must equal the number of expectedKeys.'
    }
    $keySet = @{}
    foreach ($expectedKey in $expectedKeys) {
        $values = @($expectedKey)
        if ($values.Count -ne $keyColumns.Count) {
            throw 'Every manifest expectedKeys entry must have one value per keyColumns entry.'
        }
        $joined = ($values | ForEach-Object { [string]$_ }) -join '|'
        if ($keySet.ContainsKey($joined.ToLowerInvariant())) {
            throw "Manifest contains duplicate expected key '$joined'."
        }
        $keySet[$joined.ToLowerInvariant()] = $true
    }
    return $manifest
}

function Get-NormalizedToken {
    param([AllowEmptyString()][string]$Value)
    return ($Value.ToLowerInvariant() -replace '[^a-z0-9]', '')
}

function Split-MarkdownRow {
    param([string]$Line)

    $trimmed = $Line.Trim()
    if ($trimmed.StartsWith('|')) {
        $trimmed = $trimmed.Substring(1)
    }
    if ($trimmed.EndsWith('|') -and -not $trimmed.EndsWith('\|')) {
        $trimmed = $trimmed.Substring(0, $trimmed.Length - 1)
    }
    return @(
        [regex]::Split($trimmed, '(?<!\\)\|') |
            ForEach-Object { $_.Replace('\|', '|').Trim() }
    )
}

function Get-FinalMarkdownTable {
    param([string]$Path)

    $lines = @(Get-Content -LiteralPath $Path)
    $separatorIndexes = @()
    $inFence = $false
    for ($index = 0; $index -lt $lines.Count; $index++) {
        if ($lines[$index] -match '^\s*(?:```|~~~)') {
            $inFence = -not $inFence
            continue
        }
        if (-not $inFence -and
            $lines[$index] -match '^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$') {
            $separatorIndexes += $index
        }
    }
    if ($separatorIndexes.Count -eq 0) {
        throw 'No Markdown table separator was found.'
    }
    $separatorIndex = $separatorIndexes[-1]
    if ($separatorIndex -eq 0 -or $lines[$separatorIndex - 1] -notmatch '\|') {
        throw 'The final Markdown table has no header row.'
    }

    $header = @(Split-MarkdownRow -Line $lines[$separatorIndex - 1])
    $separator = @(Split-MarkdownRow -Line $lines[$separatorIndex])
    if ($separator.Count -ne $header.Count) {
        throw "The final Markdown table separator has $($separator.Count) cells; expected $($header.Count)."
    }

    $rows = [System.Collections.Generic.List[object]]::new()
    for ($index = $separatorIndex + 1; $index -lt $lines.Count; $index++) {
        if ($lines[$index] -notmatch '\|') {
            break
        }
        $cells = @(Split-MarkdownRow -Line $lines[$index])
        $rows.Add($cells)
    }
    if ($rows.Count -eq 0) {
        throw 'The final Markdown table has no data rows.'
    }
    return [PSCustomObject]@{ Header = $header; Rows = $rows }
}

function Get-HeaderAliasMap {
    param($TableConfig)

    $map = @{}
    foreach ($canonicalProperty in $TableConfig.headerAliases.PSObject.Properties) {
        $canonical = Get-NormalizedToken $canonicalProperty.Name
        foreach ($alias in @($canonicalProperty.Name) + @($canonicalProperty.Value)) {
            $token = Get-NormalizedToken ([string]$alias)
            if ($map.ContainsKey($token) -and $map[$token] -ne $canonical) {
                throw "Header alias '$alias' maps to multiple canonical columns."
            }
            $map[$token] = $canonical
        }
    }
    return $map
}

function ConvertTo-NormalizedHeader {
    param(
        [string[]]$Header,
        [hashtable]$AliasMap
    )

    return @(
        foreach ($cell in $Header) {
            $token = Get-NormalizedToken $cell
            if ($AliasMap.ContainsKey($token)) { $AliasMap[$token] } else { $token }
        }
    )
}

function Get-CanonicalValue {
    param(
        [string]$Column,
        [string]$Value,
        $TableConfig
    )

    $token = Get-NormalizedToken $Value
    $columnProperty = $TableConfig.valueAliases.PSObject.Properties |
        Where-Object { (Get-NormalizedToken $_.Name) -eq $Column } |
        Select-Object -First 1
    if ($columnProperty) {
        foreach ($valueProperty in $columnProperty.Value.PSObject.Properties) {
            if ((Get-NormalizedToken $valueProperty.Name) -eq $token) {
                return [string]$valueProperty.Value
            }
        }
    }
    return $Value.Trim()
}

function Get-ExpectedKeys {
    param($TableConfig)

    return @(
        foreach ($expected in @($TableConfig.expectedKeys)) {
            (@($expected) | ForEach-Object { [string]$_ }) -join '|'
        }
    )
}

function Test-OutputTable {
    param(
        [string]$Actual,
        [string]$Reference,
        $TableConfig
    )

    $issues = [System.Collections.Generic.List[string]]::new()
    try {
        $referenceTable = Get-FinalMarkdownTable -Path $Reference
        $actualTable = Get-FinalMarkdownTable -Path $Actual
    }
    catch {
        $issues.Add($_.Exception.Message)
        return $issues
    }

    $headerAliasMap = Get-HeaderAliasMap -TableConfig $TableConfig
    $referenceHeader = @(ConvertTo-NormalizedHeader $referenceTable.Header $headerAliasMap)
    $actualHeader = @(ConvertTo-NormalizedHeader $actualTable.Header $headerAliasMap)
    if (($actualHeader -join '|') -ne ($referenceHeader -join '|')) {
        $issues.Add(
            "Normalized headers differ. Expected '$($referenceHeader -join ' | ')' but found '$($actualHeader -join ' | ')'."
        )
    }

    foreach ($row in $actualTable.Rows) {
        if ($row.Count -ne $actualTable.Header.Count) {
            $issues.Add("A table row has $($row.Count) cells; expected $($actualTable.Header.Count).")
        }
    }
    foreach ($row in $referenceTable.Rows) {
        if ($row.Count -ne $referenceTable.Header.Count) {
            $issues.Add("A reference table row has $($row.Count) cells; expected $($referenceTable.Header.Count).")
        }
    }
    $keyColumns = @($TableConfig.keyColumns | ForEach-Object { Get-NormalizedToken ([string]$_) })
    $actualKeyIndexes = @()
    $referenceKeyIndexes = @()
    foreach ($column in $keyColumns) {
        $actualColumnCount = @($actualHeader | Where-Object { $_ -eq $column }).Count
        $referenceColumnCount = @($referenceHeader | Where-Object { $_ -eq $column }).Count
        $actualColumnIndex = [Array]::IndexOf($actualHeader, $column)
        $referenceColumnIndex = [Array]::IndexOf($referenceHeader, $column)
        if ($actualColumnCount -ne 1) {
            $issues.Add("Final table must contain configured key column '$column' exactly once; found $actualColumnCount.")
        }
        if ($referenceColumnCount -ne 1) {
            $issues.Add("Reference table must contain configured key column '$column' exactly once; found $referenceColumnCount.")
        }
        $actualKeyIndexes += $actualColumnIndex
        $referenceKeyIndexes += $referenceColumnIndex
    }
    if ($issues.Count -gt 0) {
        return $issues
    }

    $expectedKeys = @(Get-ExpectedKeys -TableConfig $TableConfig)
    $counts = @{}
    foreach ($key in $expectedKeys) {
        if ($counts.ContainsKey($key)) {
            $issues.Add("Manifest contains duplicate expected key '$key'.")
        }
        else {
            $counts[$key] = 0
        }
    }

    function Add-KeyCounts {
        param(
            $Rows,
            [int[]]$Indexes,
            [hashtable]$TargetCounts,
            [string]$TableName
        )

        foreach ($row in $Rows) {
            $values = for ($index = 0; $index -lt $keyColumns.Count; $index++) {
                Get-CanonicalValue -Column $keyColumns[$index] -Value $row[$Indexes[$index]] -TableConfig $TableConfig
            }
            $key = $values -join '|'
            if (-not $TargetCounts.ContainsKey($key)) {
                $issues.Add("$TableName contains unexpected semantic key '$key'.")
            }
            else {
                $TargetCounts[$key]++
            }
        }
    }

    $referenceCounts = @{}
    foreach ($key in $expectedKeys) {
        $referenceCounts[$key] = 0
    }
    Add-KeyCounts -Rows $referenceTable.Rows -Indexes $referenceKeyIndexes `
        -TargetCounts $referenceCounts -TableName 'Reference table'
    Add-KeyCounts -Rows $actualTable.Rows -Indexes $actualKeyIndexes `
        -TargetCounts $counts -TableName 'Final table'

    foreach ($key in $expectedKeys) {
        if ($referenceCounts[$key] -ne 1) {
            $issues.Add("Reference table must contain semantic key '$key' exactly once; found $($referenceCounts[$key]).")
        }
    }

    foreach ($key in $expectedKeys) {
        if ($counts[$key] -ne 1) {
            $issues.Add("Expected semantic key '$key' exactly once; found $($counts[$key]).")
        }
    }

    $expectedRowCount = [int]$TableConfig.exactRowCount
    if ($actualTable.Rows.Count -ne $expectedRowCount) {
        $issues.Add("Expected exactly $expectedRowCount result rows but found $($actualTable.Rows.Count).")
    }
    if ($referenceTable.Rows.Count -ne $expectedRowCount) {
        $issues.Add("Reference table must contain exactly $expectedRowCount result rows but found $($referenceTable.Rows.Count).")
    }
    return $issues
}

function Get-RunDirectories {
    param($SampleConfig)

    $outputDirectory = Resolve-RepositoryPath -Path (
        Join-Path ([string]$SampleConfig.directory) ([string]$SampleConfig.outputDirectory)
    )
    if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) {
        return @()
    }
    return @(
        Get-ChildItem -LiteralPath $outputDirectory -Directory -Filter ([string]$SampleConfig.runDirectoryPattern) |
            Select-Object -ExpandProperty FullName
    )
}

function Write-ValidationSummary {
    param(
        [string]$Path,
        [string[]]$Lines
    )

    $Lines | Set-Content -LiteralPath $Path -Encoding utf8
    $Lines | ForEach-Object { Write-Host $_ }
}

$manifest = Read-Manifest -Path $ManifestPath
$tableConfig = $manifest.validation.table

# Validate aliases and every manifest-controlled path before runner execution.
[void](Get-HeaderAliasMap -TableConfig $tableConfig)
[void](Resolve-RepositoryPath -Path ([string]$manifest.runner.path) -MustExist)
[void](Resolve-RepositoryPath -Path ([string]$manifest.evidence.root))
foreach ($sampleConfig in @($manifest.samples)) {
    $sampleDirectory = Resolve-RepositoryPath -Path ([string]$sampleConfig.directory) -MustExist
    [void](Resolve-RepositoryPath -Path (
        Join-Path $sampleDirectory ([string]$sampleConfig.outputDirectory)
    ))
    [void](Resolve-RepositoryPath -Path (
        Join-Path $sampleDirectory ([string]$sampleConfig.reference)
    ) -MustExist)
}

if ($PSCmdlet.ParameterSetName -eq 'Files') {
    $actual = Resolve-RepositoryPath -Path $ActualPath -MustExist
    $reference = Resolve-RepositoryPath -Path $ReferencePath -MustExist
    $issues = @(Test-OutputTable -Actual $actual -Reference $reference -TableConfig $tableConfig)
    if ($issues.Count -gt 0) {
        $issues | ForEach-Object { Write-Error $_ }
        exit 1
    }
    Write-Host 'PASS: Output structure and semantic keys are valid.' -ForegroundColor Green
    exit 0
}

$selectedSamples = @(
    if ($Sample -eq 'All') {
        @($manifest.samples)
    }
    else {
        @($manifest.samples | Where-Object {
            $_.name -eq $Sample -or $_.selection -eq $Sample
        })
    }
)
if ($selectedSamples.Count -eq 0) {
    $available = @($manifest.samples | ForEach-Object { $_.name }) -join ', '
    throw "Unknown sample '$Sample'. Available values: All, $available"
}
if ($selectedSamples.Count -ne 1 -and $Sample -ne 'All') {
    throw "Sample selection '$Sample' is ambiguous."
}
if (-not $AllowRunnerExecution) {
    throw 'Run mode executes a repository PowerShell runner. Review the manifest and pass -AllowRunnerExecution to confirm trust.'
}

$runner = Resolve-RepositoryPath -Path ([string]$manifest.runner.path) -MustExist
if ([IO.Path]::GetExtension($runner) -ne '.ps1') {
    throw 'The configured runner must be a PowerShell .ps1 file.'
}

$before = @{}
foreach ($sampleConfig in $selectedSamples) {
    $before[$sampleConfig.name] = @(Get-RunDirectories -SampleConfig $sampleConfig)
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$invocationId = "$timestamp-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
$evidenceRoot = Resolve-RepositoryPath -Path ([string]$manifest.evidence.root)
New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null
$evidenceDirectory = Resolve-RepositoryPath -Path (
    Join-Path $evidenceRoot "$($manifest.evidence.directoryPrefix)$invocationId"
)
New-Item -ItemType Directory -Path $evidenceDirectory | Out-Null
$runnerLog = Resolve-RepositoryPath -Path (
    Join-Path $evidenceDirectory ([string]$manifest.evidence.runnerLog)
)
$summaryPath = Resolve-RepositoryPath -Path (
    Join-Path $evidenceDirectory ([string]$manifest.evidence.summary)
)

$selection = if ($Sample -eq 'All') {
    [string]$manifest.runner.allSelection
}
else {
    [string]$selectedSamples[0].selection
}
$runnerArguments = @(
    foreach ($argument in @($manifest.runner.arguments)) {
        ([string]$argument).Replace('{selection}', $selection)
    }
)

Write-Host "Running configured sample set '$($manifest.name)'..."
$previousNativePreference = $PSNativeCommandUseErrorActionPreference
try {
    $PSNativeCommandUseErrorActionPreference = $false
    Push-Location $RepoRoot
    try {
        & pwsh -NoProfile -File $runner @runnerArguments 2>&1 |
            Tee-Object -FilePath $runnerLog
        $runnerExitCode = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }
}
finally {
    $PSNativeCommandUseErrorActionPreference = $previousNativePreference
}

$summary = [System.Collections.Generic.List[string]]::new()
$summary.Add("Sample-set validation: $($manifest.name)")
$summary.Add("Runner exit code: $runnerExitCode")
$summary.Add('')
$failed = $runnerExitCode -ne 0

foreach ($sampleConfig in $selectedSamples) {
    $after = @(Get-RunDirectories -SampleConfig $sampleConfig)
    $newDirectories = @($after | Where-Object { $_ -notin $before[$sampleConfig.name] })
    if ($newDirectories.Count -ne 1) {
        $failed = $true
        $summary.Add("FAIL  $($sampleConfig.name)")
        $summary.Add("  Expected one new run directory but found $($newDirectories.Count).")
        continue
    }

    $actual = Resolve-RepositoryPath -Path (
        Join-Path $newDirectories[0] ([string]$sampleConfig.runFile)
    )
    $reference = Resolve-RepositoryPath -Path (
        Join-Path ([string]$sampleConfig.directory) ([string]$sampleConfig.reference)
    )
    if (-not (Test-Path -LiteralPath $actual -PathType Leaf)) {
        $failed = $true
        $summary.Add("FAIL  $($sampleConfig.name)")
        $summary.Add("  Generated output is missing: $actual")
        continue
    }
    if (-not (Test-Path -LiteralPath $reference -PathType Leaf)) {
        $failed = $true
        $summary.Add("FAIL  $($sampleConfig.name)")
        $summary.Add("  Reference output is missing: $reference")
        continue
    }

    $issues = @(Test-OutputTable -Actual $actual -Reference $reference -TableConfig $tableConfig)
    if ($issues.Count -eq 0) {
        $summary.Add("PASS  $($sampleConfig.name)")
        $summary.Add("  Output: $actual")
    }
    else {
        $failed = $true
        $summary.Add("FAIL  $($sampleConfig.name)")
        $summary.Add("  Output: $actual")
        foreach ($issue in $issues) {
            $summary.Add("  $issue")
        }
    }
}

$summary.Add('')
if ($failed) {
    $summary.Add('One or more selected samples failed validation.')
}
else {
    $summary.Add('All selected samples passed validation.')
}
Write-ValidationSummary -Path $summaryPath -Lines $summary

if ($failed) { exit 1 }
exit 0
