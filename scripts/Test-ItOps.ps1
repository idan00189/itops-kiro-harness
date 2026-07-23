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
    & (Join-Path $PSScriptRoot "Initialize-ItOpsAuth.ps1") -EnvFile $EnvFile
    if ($LASTEXITCODE -ne 0) { throw "Interactive authentication initialization failed." }

    $sqlAuthMode = if ([string]::IsNullOrWhiteSpace($env:SQLSERVER_AUTH_MODE)) {
        "windows"
    } else {
        $env:SQLSERVER_AUTH_MODE.Trim().ToLowerInvariant()
    }
    if ($env:ITOPS_ENABLE_SQLSERVER -match "^(?i:true|1|yes|on)$" -and
        $sqlAuthMode -eq "windows") {
        if (-not (Get-Command "Get-OdbcDriver" -ErrorAction SilentlyContinue)) {
            throw "Get-OdbcDriver is unavailable; verify Microsoft ODBC Driver 18 for SQL Server manually."
        }
        $driver = Get-OdbcDriver -Name $env:SQLSERVER_ODBC_DRIVER -ErrorAction SilentlyContinue
        if (-not $driver) {
            throw "Required SQL ODBC driver '$($env:SQLSERVER_ODBC_DRIVER)' is not installed."
        }
    }

    & npm run health
    if ($LASTEXITCODE -ne 0) { throw "One or more read-only integration health checks failed." }
}

Write-Host "ITOps verification passed."
