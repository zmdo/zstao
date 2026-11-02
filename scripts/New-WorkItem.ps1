#Requires -Version 5.1
<#
.SYNOPSIS
    Create a new work item from a template.
.DESCRIPTION
    Creates work/<year>/<date>-<slug>.md and fills in the title and date placeholders.
    Never overwrites an existing file: a numeric suffix is appended instead.
    Works on both Windows PowerShell 5.1 and PowerShell 7+.
.PARAMETER Title
    Work item title. Required.
.PARAMETER Type
    Template to use: task (default) or decision.
.PARAMETER Date
    Date the work item belongs to. Defaults to today.
.EXAMPLE
    powershell -File scripts/New-WorkItem.ps1 -Title "Route review through sub-agents"
.EXAMPLE
    pwsh -File scripts/New-WorkItem.ps1 -Title "Adopt trunk-based branching" -Type decision
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory, Position = 0)]
    [ValidateNotNullOrEmpty()]
    [string]$Title,

    [ValidateSet('task', 'decision')]
    [string]$Type = 'task',

    [datetime]$Date = (Get-Date)
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$templatePath = Join-Path $repoRoot (Join-Path 'templates' "$Type.md")

if (-not (Test-Path -LiteralPath $templatePath)) {
    throw "Template not found: $templatePath"
}

$slug = $Title.ToLowerInvariant()
$slug = [regex]::Replace($slug, '[^\p{L}\p{Nd}]+', '-').Trim('-')
if ([string]::IsNullOrWhiteSpace($slug)) { $slug = 'item' }
if ($slug.Length -gt 60) { $slug = $slug.Substring(0, 60).Trim('-') }

$year = $Date.ToString('yyyy')
$directory = Join-Path $repoRoot (Join-Path 'work' $year)
if (-not (Test-Path -LiteralPath $directory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
}

$stem = '{0}-{1}' -f $Date.ToString('yyyy-MM-dd'), $slug
$path = Join-Path $directory "$stem.md"
$counter = 1
while (Test-Path -LiteralPath $path) {
    $counter++
    $path = Join-Path $directory ('{0}-{1}.md' -f $stem, $counter)
}

$content = [System.IO.File]::ReadAllText($templatePath, [System.Text.Encoding]::UTF8)
$content = $content.Replace('{{title}}', $Title)
$content = $content.Replace('{{date}}', $Date.ToString('yyyy-MM-dd'))
$content = $content.Replace('{{slug}}', $slug)

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($path, $content, $utf8NoBom)

$relative = $path.Substring($repoRoot.Length + 1).Replace('\', '/')
Write-Output "Created work item: $relative"
Write-Output 'Next: fill in the delivery definition and acceptance criteria, then run powershell -File scripts/Test-Repo.ps1'
