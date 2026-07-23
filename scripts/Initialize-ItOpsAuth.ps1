[CmdletBinding()]
param(
    [string]$EnvFile = "config\itops.env"
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

function ConvertTo-ItOpsBoolean {
    param([string]$Value)
    return @("true", "1", "yes", "on") -contains $Value.Trim().ToLowerInvariant()
}

$argoAuthMode = if ([string]::IsNullOrWhiteSpace($env:ARGOCD_AUTH_MODE)) {
    "cli-sso"
} else {
    $env:ARGOCD_AUTH_MODE.Trim().ToLowerInvariant()
}

if ($env:ITOPS_ENABLE_ARGOCD -and
    (ConvertTo-ItOpsBoolean $env:ITOPS_ENABLE_ARGOCD) -and
    $argoAuthMode -eq "cli-sso") {
    $cli = if ($env:ARGOCD_CLI_PATH) { $env:ARGOCD_CLI_PATH } else { "argocd.exe" }
    if (-not (Get-Command $cli -ErrorAction SilentlyContinue)) {
        throw "Argo CD CLI '$cli' was not found. Install a current Argo CD CLI before using cli-sso."
    }

    $tokenArgs = @(
        "account", "session-token",
        "--argocd-context", $env:ARGOCD_CLI_CONTEXT
    )
    if ($env:ARGOCD_CLI_CONFIG) {
        $tokenArgs += @("--config", $env:ARGOCD_CLI_CONFIG)
    }
    if ($env:ARGOCD_CLI_GRPC_WEB -and
        (ConvertTo-ItOpsBoolean $env:ARGOCD_CLI_GRPC_WEB)) {
        $tokenArgs += "--grpc-web"
    }
    if ($env:ARGOCD_CLI_GRPC_WEB_ROOT_PATH) {
        $tokenArgs += @("--grpc-web-root-path", $env:ARGOCD_CLI_GRPC_WEB_ROOT_PATH)
    }

    $token = $null
    try {
        $token = (& $cli @tokenArgs 2>$null | Out-String).Trim()
    } catch {
        $token = $null
    }

    if (-not $token) {
        Write-Host "Argo CD SSO session is missing or expired. Opening Microsoft login..."
        $loginArgs = @(
            "login", $env:ARGOCD_CLI_SERVER,
            "--sso",
            "--name", $env:ARGOCD_CLI_CONTEXT
        )
        if ($env:ARGOCD_CLI_CONFIG) {
            $loginArgs += @("--config", $env:ARGOCD_CLI_CONFIG)
        }
        if ($env:ARGOCD_CLI_GRPC_WEB -and
            (ConvertTo-ItOpsBoolean $env:ARGOCD_CLI_GRPC_WEB)) {
            $loginArgs += "--grpc-web"
        }
        if ($env:ARGOCD_CLI_GRPC_WEB_ROOT_PATH) {
            $loginArgs += @("--grpc-web-root-path", $env:ARGOCD_CLI_GRPC_WEB_ROOT_PATH)
        }

        & $cli @loginArgs
        if ($LASTEXITCODE -ne 0) {
            throw "Argo CD SSO login failed."
        }
        $token = (& $cli @tokenArgs | Out-String).Trim()
        if ($LASTEXITCODE -ne 0 -or -not $token) {
            throw "Argo CD SSO completed but no refreshable session token is available."
        }
    }

    $token = $null
    Write-Host "Argo CD CLI SSO session is ready."
}

if ($env:ITOPS_ENABLE_DYNATRACE -and
    (ConvertTo-ItOpsBoolean $env:ITOPS_ENABLE_DYNATRACE)) {
    Write-Host "Dynatrace OAuth is managed by Kiro. The first Dynatrace subagent use may open Microsoft/Dynatrace SSO in the browser."
}
