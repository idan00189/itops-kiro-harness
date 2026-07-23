[CmdletBinding()]
param(
    [switch]$Check,
    [switch]$DryRun,
    [switch]$Remove
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
if (Test-Path -LiteralPath "variable:PSNativeCommandUseErrorActionPreference") {
    $PSNativeCommandUseErrorActionPreference = $false
}
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

if (-not (Test-Path -LiteralPath "dist\cli\configure-kiro-permissions.js")) {
    throw "The harness is not built. Run 'npm ci' and 'npm run build' first."
}

$arguments = @("dist\cli\configure-kiro-permissions.js")
if ($Check) { $arguments += "--check" }
if ($DryRun) { $arguments += "--dry-run" }
if ($Remove) { $arguments += "--remove" }

& node @arguments
if ($LASTEXITCODE -ne 0) {
    throw "Kiro ITOps permission configuration failed."
}
