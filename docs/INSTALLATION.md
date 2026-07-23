# Windows installation and update guide

This guide installs the ITOps harness on a Windows PC, configures Kiro CLI v3 so the reviewed ITOps agents and tools do not request approval repeatedly, and opens the user-facing orchestrator chat.

## 1. Prerequisites

Install:

- Windows 11 with PowerShell 7 recommended
- Node.js 22.12+ or Node.js 24 LTS
- Git for Windows
- Kiro CLI with the v3 engine
- Microsoft ODBC Driver 18 for SQL Server
- a current Argo CD CLI
- Windows `curl.exe` with SSPI/SPNEGO for Splunk Kerberos

Authenticate Kiro:

```powershell
irm 'https://cli.kiro.dev/install.ps1' | iex
kiro-cli login
kiro-cli whoami
```

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
5. configures this Windows user's exact Kiro permissions
6. validates every Kiro agent profile

The installer does not overwrite an existing `config\itops.env` or private `wiki\` content.

## 3. One-time Kiro permission setup

Kiro v3 stores permission decisions outside Git at:

```text
%USERPROFILE%\.kiro\settings\permissions.yaml
```

A cloned repository cannot grant itself trust. `Install-ItOps.ps1` therefore runs the local permission configurator explicitly for the signed-in Windows user.

It adds only:

- the six named internal ITOps subagents
- the exact ITOps MCP tool names
- external read operations
- the constrained local report and Splunk XML output tools

It does not allow MCP wildcards, shell commands, generic filesystem writes, or unrelated agents. Existing Kiro rules are preserved, and an existing permission file receives a timestamped backup.

Verify the setup:

```powershell
.\scripts\Set-ItOpsKiroPermissions.ps1 -Check
```

Preview the generated rules without changing anything:

```powershell
.\scripts\Set-ItOpsKiroPermissions.ps1 -DryRun
```

Remove only the rules managed by ITOps:

```powershell
.\scripts\Set-ItOpsKiroPermissions.ps1 -Remove
```

Do not use `/tools trust-all`, `mcp:*`, or a general `all: allow` rule. Those choices would grant more authority than the harness needs.

## 4. Configure connections

Open the single ignored environment file:

```powershell
notepad .\config\itops.env
```

Replace only the values for the integrations you intend to enable. Leave an integration's `ITOPS_ENABLE_*` switch set to `false` until its read-only identity, TLS trust, network route, and allowlists are ready.

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

`Test-ItOps.ps1` fails closed when permissions, runtime configuration, replica proof, authentication, TLS, or an enabled connection is invalid. Fix the reported cause; do not bypass TLS or widen a production role merely to make a health check pass.

## 6. Open the orchestrator chat

Run:

```powershell
.\scripts\Start-ItOps.ps1
```

The script opens Kiro CLI v3 with `itops-orchestrator`. Always talk to this main agent. It selects the Splunk, SQL Server, MongoDB/DocumentDB, Dynatrace, Argo CD, or source-code specialist internally as needed.

Ordinary questions are answered in chat. A Hebrew Markdown report is written only when you request a report or a full investigation; request HTML explicitly when needed.

## 7. Update an existing PC

From the existing clone:

```powershell
git switch main
git pull --ff-only origin main

Set-ExecutionPolicy -Scope Process Bypass
.\scripts\Install-ItOps.ps1
.\scripts\Set-ItOpsKiroPermissions.ps1 -Check
.\scripts\Test-ItOps.ps1
```

Re-running the installer is important after updates because agent names, MCP tool names, hooks, dependencies, or schemas may have changed. Your ignored `config\itops.env` and private `wiki\` files remain local.

Start a fresh chat after an update:

```powershell
.\scripts\Start-ItOps.ps1
```

## 8. Repeated approval or Splunk failure

If Kiro still requests approval for a known ITOps subagent or tool:

```powershell
.\scripts\Set-ItOpsKiroPermissions.ps1 -Check
```

If entries are missing, run the command without `-Check`, close the current Kiro chat, and start a new one. If the check passes but Kiro still prompts, inspect the restrictive `ask` or `deny` rules under both:

```text
%USERPROFILE%\.kiro\settings\permissions.yaml
%USERPROFILE%\.kiro\workspace-roots\<workspace-hash>\permissions.yaml
```

Kiro resolves permissions as `deny` over `ask` over `allow`, so a restrictive workspace rule can override the exact user-level allowlist. Review that rule deliberately instead of adding a wildcard.

If Splunk reports `maximum allowed nesting depth`, confirm that the repository is on version 1.3.1 or newer, rerun the installer, and open a fresh chat. The corrected harness exposes the dashboard panel collection through a flat `panelsJson` tool argument and validates the structured panels inside the MCP server.

For Kerberos `401`/`403`, TLS, replica, OAuth, and vendor-specific failures, use the [operations troubleshooting guide](OPERATIONS.md#troubleshooting).
