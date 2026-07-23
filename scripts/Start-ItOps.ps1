[CmdletBinding()]
param(
    [string]$EnvFile = "config\itops.env"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
if (Test-Path -LiteralPath "variable:PSNativeCommandUseErrorActionPreference") {
    $PSNativeCommandUseErrorActionPreference = $false
}
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

. (Join-Path $PSScriptRoot "Import-ItOpsEnv.ps1")
if (-not (Test-Path -LiteralPath $EnvFile)) {
    throw "Environment file '$EnvFile' does not exist. Run .\scripts\Install-ItOps.ps1 first."
}
Import-ItOpsEnv -Path $EnvFile

if (-not (Test-Path -LiteralPath "dist\mcp\core.js")) {
    throw "The harness is not built. Run .\scripts\Install-ItOps.ps1 first."
}

& node "dist\cli\configure-kiro-permissions.js" "--check"
if ($LASTEXITCODE -ne 0) {
    throw "Kiro ITOps permissions are incomplete. Run .\scripts\Set-ItOpsKiroPermissions.ps1 once on this PC."
}

& node "dist\cli\validate-config.js" "--runtime"
if ($LASTEXITCODE -ne 0) { throw "Runtime configuration validation failed." }

& (Join-Path $PSScriptRoot "Initialize-ItOpsAuth.ps1") -EnvFile $EnvFile
if ($LASTEXITCODE -ne 0) { throw "Interactive authentication initialization failed." }

& kiro-cli chat --v3 --tui --agent itops-orchestrator --require-mcp-startup
exit $LASTEXITCODE
