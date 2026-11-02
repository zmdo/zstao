#Requires -Version 5.1
<#
.SYNOPSIS
    Repository self-check: required files, markdown links, index entries.
.DESCRIPTION
    Checks:
    1. Required files exist.
    2. Relative markdown links resolve (code fences, anchors and external URLs are skipped).
    3. Documents under docs/, prompts/, agents/ and templates/ are registered in their README.
    Exits 0 when everything passes, otherwise prints the problems and exits 1.
    Works on both Windows PowerShell 5.1 and PowerShell 7+.
.EXAMPLE
    powershell -File scripts/Test-Repo.ps1
.EXAMPLE
    pwsh -File scripts/Test-Repo.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$failures = New-Object 'System.Collections.Generic.List[string]'
$utf8 = New-Object System.Text.UTF8Encoding($false)

$requiredPaths = @(
    'README.md'
    'AGENTS.md'
    'LICENSE'
    '.gitignore'
    '.gitattributes'
    'docs/README.md'
    'docs/principles.md'
    'docs/workflow.md'
    'docs/prompt-style.md'
    'prompts/README.md'
    'agents/README.md'
    'scripts/README.md'
    'scripts/Test-Repo.ps1'
    'scripts/New-WorkItem.ps1'
    'templates/README.md'
    'templates/task.md'
    'templates/decision.md'
)

$missingRequired = 0
foreach ($item in $requiredPaths) {
    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot $item))) {
        $failures.Add("Missing required file: $item")
        $missingRequired++
    }
}

$markdownFiles = Get-ChildItem -LiteralPath $repoRoot -Filter '*.md' -Recurse -File |
    Where-Object { $_.FullName -notmatch '[\\/]\.git[\\/]' }

$linkPattern = [regex]'\[[^\]]*\]\(\s*<?([^)>]+?)>?\s*\)'
$linkCount = 0
$brokenLinks = 0

foreach ($file in $markdownFiles) {
    $relative = $file.FullName.Substring($repoRoot.Length + 1).Replace('\', '/')
    $inFence = $false
    $lineNumber = 0

    foreach ($line in [System.IO.File]::ReadAllLines($file.FullName, [System.Text.Encoding]::UTF8)) {
        $lineNumber++
        if ($line.TrimStart().StartsWith('```')) {
            $inFence = -not $inFence
            continue
        }
        if ($inFence) { continue }

        foreach ($match in $linkPattern.Matches($line)) {
            $target = $match.Groups[1].Value.Trim()
            if ([string]::IsNullOrWhiteSpace($target)) { continue }
            if ($target -match '^(https?:|mailto:|ftp:|#)') { continue }
            if ($target -match '^[a-zA-Z][a-zA-Z0-9+.-]*:') { continue }

            $linkCount++
            $pathPart = ($target -split '#', 2)[0]
            if ([string]::IsNullOrWhiteSpace($pathPart)) { continue }

            $pathPart = [System.Uri]::UnescapeDataString($pathPart.Trim('<', '>'))
            $resolved = if ($pathPart.StartsWith('/')) {
                Join-Path $repoRoot $pathPart.TrimStart('/')
            } else {
                Join-Path $file.DirectoryName $pathPart
            }

            if (-not (Test-Path -LiteralPath $resolved)) {
                $failures.Add("Broken link: ${relative}:${lineNumber} -> $target")
                $brokenLinks++
            }
        }
    }
}

$indexGroups = @(
    @{ Dir = 'docs'; Index = 'docs/README.md'; Label = 'doc' }
    @{ Dir = 'prompts'; Index = 'prompts/README.md'; Label = 'prompt' }
    @{ Dir = 'agents'; Index = 'agents/README.md'; Label = 'agent role' }
    @{ Dir = 'templates'; Index = 'templates/README.md'; Label = 'template' }
)

$indexChecked = 0
$unregistered = 0

foreach ($group in $indexGroups) {
    $indexPath = Join-Path $repoRoot $group.Index
    if (-not (Test-Path -LiteralPath $indexPath)) { continue }

    $indexContent = [System.IO.File]::ReadAllText($indexPath, [System.Text.Encoding]::UTF8)
    $docs = Get-ChildItem -LiteralPath (Join-Path $repoRoot $group.Dir) -Filter '*.md' -File |
        Where-Object { $_.Name -ne 'README.md' }

    foreach ($doc in $docs) {
        $indexChecked++
        if ($indexContent -notmatch [regex]::Escape($doc.Name)) {
            $failures.Add("Unregistered $($group.Label): $($group.Dir)/$($doc.Name) is not listed in $($group.Index)")
            $unregistered++
        }
    }
}

Write-Output "Repository check . $repoRoot"
Write-Output ''
Write-Output ("  required files : {0}/{1}" -f ($requiredPaths.Count - $missingRequired), $requiredPaths.Count)
Write-Output ("  markdown links : {0} checked, {1} broken" -f $linkCount, $brokenLinks)
Write-Output ("  index entries  : {0} checked, {1} unregistered" -f $indexChecked, $unregistered)
Write-Output ''

if ($failures.Count -eq 0) {
    Write-Output '[OK] all checks passed'
    exit 0
}

Write-Output "[FAIL] $($failures.Count) problem(s) found:"
foreach ($failure in $failures) {
    Write-Output "  - $failure"
}
exit 1
