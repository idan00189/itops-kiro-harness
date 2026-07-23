[CmdletBinding()]
param(
    [switch]$ConfigureKiroSettings
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

function Require-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found in PATH."
    }
}

Require-Command "node"
Require-Command "npm"
Require-Command "kiro-cli"

$nodeVersion = (& node -p "process.versions.node").Trim()
$nodeParts = $nodeVersion.Split(".")
$nodeMajor = [int]$nodeParts[0]
$nodeMinor = [int]$nodeParts[1]
if ($nodeMajor -lt 22 -or
    ($nodeMajor -eq 22 -and $nodeMinor -lt 12) -or
    ($nodeMajor % 2 -ne 0)) {
    throw "Node.js 22.12+ or 24+ on an even-numbered/LTS release is required. Found $nodeVersion."
}

& kiro-cli whoami
if ($LASTEXITCODE -ne 0) {
    throw "Kiro CLI is not authenticated. Run 'kiro-cli login' and rerun this installer."
}

$environmentPath = Join-Path $projectRoot "config\itops.env"
$examplePath = Join-Path $projectRoot "config\itops.env.example"
if (-not (Test-Path -LiteralPath $environmentPath)) {
    Copy-Item -LiteralPath $examplePath -Destination $environmentPath
    Write-Host "Created config\itops.env from the safe template. Fill its CHANGE_ME/YOUR_* values before starting."
}

& npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci failed." }

& npm run verify
if ($LASTEXITCODE -ne 0) { throw "Harness verification failed." }

Get-ChildItem -LiteralPath ".kiro\agents" -Filter "*.md" | ForEach-Object {
    & kiro-cli agent validate $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "Kiro rejected agent profile $($_.Name)." }
}

if ($ConfigureKiroSettings) {
    & kiro-cli settings chat.enableKnowledge true
    & kiro-cli settings toolSearch.enabled true
    & kiro-cli settings --workspace chat.disableInheritingDefaultResources true
    Write-Host "Enabled Kiro knowledge, on-demand MCP Tool Search, and isolated custom-agent resources."
}

try {
    & kiro-cli diagnostic
} catch {
    Write-Warning "kiro-cli diagnostic did not complete. Run 'kiro-cli doctor' if your installed release uses the older command name."
}

Write-Host ""
Write-Host "Installation complete."
Write-Host "1. Edit config\itops.env with read-only credentials."
Write-Host "2. Run .\scripts\Test-ItOps.ps1."
Write-Host "3. Run .\scripts\Start-ItOps.ps1."
