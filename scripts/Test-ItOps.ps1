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

    $sqlUsesWindows = $false
    if ($env:ITOPS_ENABLE_SQLSERVER -match "^(?i:true|1|yes|on)$") {
        $sqlProfiles = @()
        if (-not [string]::IsNullOrWhiteSpace($env:SQLSERVER_CONNECTIONS)) {
            $sqlProfiles = $env:SQLSERVER_CONNECTIONS.Split(",") |
                ForEach-Object { $_.Trim().ToUpperInvariant() } |
                Where-Object { $_ }
        }
        if ($sqlProfiles.Count -eq 0) {
            $sqlAuthMode = [Environment]::GetEnvironmentVariable(
                "SQLSERVER_AUTH_MODE",
                "Process"
            )
            $sqlUsesWindows = [string]::IsNullOrWhiteSpace($sqlAuthMode) -or
                $sqlAuthMode.Trim().ToLowerInvariant() -eq "windows"
        } else {
            foreach ($profile in $sqlProfiles) {
                $modeName = "SQLSERVER_{0}_AUTH_MODE" -f $profile
                $sqlAuthMode = [Environment]::GetEnvironmentVariable($modeName, "Process")
                if ([string]::IsNullOrWhiteSpace($sqlAuthMode) -or
                    $sqlAuthMode.Trim().ToLowerInvariant() -eq "windows") {
                    $sqlUsesWindows = $true
                    break
                }
            }
        }
    }
    if ($sqlUsesWindows) {
        if (-not (Get-Command "Get-OdbcDriver" -ErrorAction SilentlyContinue)) {
            throw "Get-OdbcDriver is unavailable; verify Microsoft ODBC Driver 18 for SQL Server manually."
        }
        $driverName = if ([string]::IsNullOrWhiteSpace($env:SQLSERVER_ODBC_DRIVER)) {
            "ODBC Driver 18 for SQL Server"
        } else {
            $env:SQLSERVER_ODBC_DRIVER
        }
        $driver = Get-OdbcDriver -Name $driverName -ErrorAction SilentlyContinue
        if (-not $driver) {
            throw "Required SQL ODBC driver '$driverName' is not installed."
        }
    }

    & npm run health
    if ($LASTEXITCODE -ne 0) { throw "One or more read-only integration health checks failed." }
}

Write-Host "ITOps verification passed."
