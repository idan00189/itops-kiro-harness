# Windows installation and update guide

This guide installs the ITOps Kiro v3 pack on a Windows PC. Kiro CLI v3 is the runtime harness; this repository supplies only the agents, skills, hooks, resources, and MCP servers that Kiro loads.

## 1. Prerequisites

Install:

- Windows 11 with PowerShell 7 recommended
- Node.js 22.12+ or Node.js 24 LTS
- Git for Windows
- Current Kiro CLI with the v3 engine enabled
- Microsoft ODBC Driver 18 for SQL Server
- a current Argo CD CLI
- Windows `curl.exe` with SSPI/SPNEGO for Splunk Kerberos

Authenticate Kiro:

```powershell
irm 'https://cli.kiro.dev/install.ps1' | iex
kiro-cli login
kiro-cli whoami
kiro-cli update --non-interactive
```

The installer checks the installed semantic version and invokes native v3 validation. The start command always uses `--v3 --tui`; legacy/classic chat is not supported for this pack.

## 2. Fresh installation

Clone the public repository and run the installer:

```powershell
git clone https://github.com/idan00189/itops-kiro-harness.git
cd itops-kiro-harness

Set-ExecutionPolicy -Scope Process Bypass
.\scripts\Install-ItOps.ps1
```

The installer:

1. verifies Node, npm, Kiro authentication, and the supported versions
2. installs dependencies from the committed lockfile
3. builds and tests the MCP servers, skills, agents, hooks, and security controls
4. creates the ignored `config\itops.env` file when it does not exist
5. validates every Kiro v3 agent profile, hook, skill, and MCP contract
6. runs Kiro v3 diagnostics without changing Kiro settings

The installer does not overwrite an existing `config\itops.env` or private `wiki\` content.

## 3. Kiro v3 permissions

Permissions are declared in the checked-in Markdown agent profiles under `.kiro\agents\`. The orchestrator allows only the six named specialists and the exact MCP tools; each specialist allows only its own MCP server. Shell, generic filesystem writes, web access, and secret-directory reads are denied.

The installer does not modify `%USERPROFILE%\.kiro`, workspace permission files, sessions, or trust state. Kiro's user/workspace permissions still apply and a local `deny` or `ask` rule overrides an agent allow rule. If approvals continue, inspect those rules rather than adding a wildcard. Never use `/tools trust-all`, `--trust-all-tools`, `mcp:*`, or `all: allow`.

## 4. Configure connections

Open the single ignored environment file:

```powershell
notepad .\config\itops.env
```

Replace only the values for the integrations you intend to enable. Leave an integration's `ITOPS_ENABLE_*` switch set to `false` until its read-only identity, TLS trust, network route, and allowlists are ready.

For Splunk, configure the host and port independently:

```dotenv
SPLUNK_BASE_URL=https://splunk-rest.example.com
SPLUNK_PORT=8089
```

Use `443` when an approved Kerberos reverse proxy terminates HTTPS on that port. The valid range is `1`–`65535`. Older files with `https://host:port` remain valid when `SPLUNK_PORT` is empty; if both are supplied, the values must match.

Detailed identity and connection instructions:

- [Authentication and Microsoft SSO](AUTHENTICATION.md)
- [Read-only vendor setup](READ_ONLY_SETUP.md)
- [README connection examples](../README.md#connect-every-system)

Never commit `config\itops.env`, private wiki content, passwords, tokens, OAuth client secrets, connection strings, or internal hostnames.

## 5. Initialize SSO and test

Initialize Microsoft/Argo CD authentication and run all enabled health checks:

```powershell
.\scripts\Initialize-ItOpsAuth.ps1
.\scripts\Test-ItOps.ps1
```

`Test-ItOps.ps1` fails closed when runtime configuration, replica proof, authentication, TLS, or an enabled connection is invalid. Fix the reported cause; do not bypass TLS or widen a production role merely to make a health check pass.

## 6. Open the orchestrator chat

Run:

```powershell
.\scripts\Start-ItOps.ps1
```

The script opens Kiro CLI v3 with `itops-orchestrator`. Always talk to this main agent. Kiro itself selects the Splunk, SQL Server, MongoDB/DocumentDB, Dynatrace, Argo CD, or source-code specialist internally as needed.

Ordinary questions are answered in chat. A Hebrew Markdown report is written only when you request a report or a full investigation; request HTML explicitly when needed.

## 7. Update an existing PC

From the existing clone:

```powershell
git switch main
git pull --ff-only origin main

Set-ExecutionPolicy -Scope Process Bypass
.\scripts\Install-ItOps.ps1
.\scripts\Test-ItOps.ps1
```

Re-running the installer is important after updates because agent names, MCP tool names, hooks, dependencies, or schemas may have changed. Your ignored `config\itops.env` and private `wiki\` files remain local.

Start a fresh v3 chat after an update:

```powershell
.\scripts\Start-ItOps.ps1
```

## 8. Repeated approval or Splunk failure

If Kiro still requests approval for a known ITOps subagent or tool, close the current chat and start a fresh v3 TUI session. If it still prompts, inspect the restrictive `ask` or `deny` rules under both:

```text
%USERPROFILE%\.kiro\settings\permissions.yaml
%USERPROFILE%\.kiro\workspace-roots\<workspace-hash>\permissions.yaml
```

Kiro resolves permissions as `deny` over `ask` over `allow`, so a restrictive workspace rule can override the exact profile allow rule. Review that rule deliberately instead of adding a wildcard.

If Splunk reports `maximum allowed nesting depth`, confirm that the repository is on version 1.3.1 or newer, rerun the installer, and open a fresh chat. The corrected harness exposes the dashboard panel collection through a flat `panelsJson` tool argument and validates the structured panels inside the MCP server.

If `report_write` reports the same nesting-depth error, confirm that the repository is on version 1.5.0 or newer, rerun the installer, and open a fresh chat. The report writer now accepts the complete structured report through a flat `reportJson` string and performs the strict incident-schema validation inside the MCP server.

If Kiro reports an invalid hook trigger after upgrading, pull version 1.4.0 or newer. The v3 standalone session hook uses the documented `SessionStart` trigger rather than the legacy embedded-hook name `agentSpawn`/`AgentSpawn`.

For Kerberos `401`/`403`, TLS, replica, OAuth, and vendor-specific failures, use the [operations troubleshooting guide](OPERATIONS.md#troubleshooting).
