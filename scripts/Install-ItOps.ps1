[CmdletBinding()]
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
if (Test-Path -LiteralPath "variable:PSNativeCommandUseErrorActionPreference") {
    $PSNativeCommandUseErrorActionPreference = $false
}
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

$kiroVersionOutput = (& kiro-cli --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $kiroVersionOutput -notmatch "(\d+\.\d+\.\d+)") {
    throw "Could not determine the installed Kiro CLI version."
}
$kiroVersion = [Version]$Matches[1]
$minimumV3KiroVersion = [Version]"2.12.0"
if ($kiroVersion -lt $minimumV3KiroVersion) {
    throw "Kiro CLI $minimumV3KiroVersion or newer is required for the v3 agent format and confidential-client MCP OAuth. Found $kiroVersion. Run 'kiro-cli update --non-interactive' and rerun this installer."
}

$chatHelp = (& kiro-cli chat --help | Out-String)
if ($LASTEXITCODE -ne 0 -or $chatHelp -notmatch "--v3" -or $chatHelp -notmatch "--tui") {
    throw "The installed Kiro CLI does not expose the v3 engine and TUI flags. Update Kiro and rerun this installer."
}

$nodeVersion = (& node -p "process.versions.node").Trim()
$nodeCommandExitCode = $LASTEXITCODE
if ($nodeCommandExitCode -ne 0) {
    throw "Could not determine the installed Node.js version."
}
$nodeParts = $nodeVersion.Split(".")
$nodeMajor = [int]$nodeParts[0]
$nodeMinor = [int]$nodeParts[1]
$supportedNode = (($nodeMajor -eq 22 -and $nodeMinor -ge 12) -or
    $nodeMajor -eq 24)
if (-not $supportedNode) {
    throw "Node.js 22.12 or Node.js 24 LTS is required. Found $nodeVersion."
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
if ($LASTEXITCODE -ne 0) { throw "Kiro v3 pack verification failed." }

Get-ChildItem -LiteralPath ".kiro\agents" -Filter "*.md" | ForEach-Object {
    & kiro-cli --v3 agent validate --path $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "Kiro v3 rejected agent profile $($_.Name)." }
}

& kiro-cli diagnostic --force --format json
if ($LASTEXITCODE -ne 0) {
    Write-Warning "Kiro v3 diagnostics reported one or more environment warnings. Review them before starting ITOps."
}

Write-Host ""
Write-Host "Installation complete."
Write-Host "Validated Kiro CLI $kiroVersion using its v3 agent, permission, hook, subagent, and MCP configuration."
Write-Host "Kiro v3 receives exact subagent/MCP permissions from the checked-in agent profiles; no machine-wide trust file is modified."
Write-Host "1. Edit config\itops.env with read-only credentials."
Write-Host "2. Run .\scripts\Initialize-ItOpsAuth.ps1 for Microsoft/Argo CD SSO."
Write-Host "3. Run .\scripts\Test-ItOps.ps1."
Write-Host "4. Run .\scripts\Start-ItOps.ps1."
