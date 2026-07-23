[CmdletBinding()]
param(
    [string]$EnvFile = "config\itops.env",
    [switch]$SkipConnections
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

. (Join-Path $PSScriptRoot "Import-ItOpsEnv.ps1")
if (-not (Test-Path -LiteralPath $EnvFile)) {
    throw "Environment file '$EnvFile' does not exist."
}
Import-ItOpsEnv -Path $EnvFile

& npm run verify
if ($LASTEXITCODE -ne 0) { throw "Static verification failed." }

& node "dist\cli\validate-config.js" "--runtime"
if ($LASTEXITCODE -ne 0) { throw "Runtime configuration validation failed." }

if (-not $SkipConnections) {
    & npm run health
    if ($LASTEXITCODE -ne 0) { throw "One or more read-only integration health checks failed." }
}

Write-Host "ITOps verification passed."
