# ITOps harness QA report

Date: 2026-07-23

Release candidate: 1.5.0

Scope: repository implementation, Kiro CLI v3 configuration, local MCP protocol, read-only controls, report/artifact generation, mocked vendor HTTP contracts, dependency security, and Windows automation.

## Result

The release candidate passes every credential-independent QA gate. Production vendor acceptance remains intentionally pending until an operator supplies the ignored environment file, network routes, vendor identities, and Microsoft/SSO access on the target Windows PC.

This distinction is important: mocked and fail-closed tests establish harness behavior, but they cannot prove a production credential's RBAC, a SQL listener's current replica routing, a Kerberos SPN, or a vendor tenant's API compatibility.

## Automated evidence

| Area | Result | Evidence |
| --- | --- | --- |
| TypeScript build | PASS | Clean Node 24.14 build with strict TypeScript settings |
| Unit and guard behavior | PASS | SQL, SPL, MongoDB, source, URL, redaction, replica, report, XML, permission, hook, and profile tests |
| Compiled MCP protocol | PASS | All six local stdio servers launched through the MCP SDK; public tool lists exactly matched the trusted allowlist |
| Tool annotations | PASS | External/local read tools are non-destructive and read-only; only the two constrained local writers have `readOnlyHint=false` |
| Local artifacts | PASS | Markdown, RTL HTML, and safe Splunk Simple XML were generated and persisted inside workspace-confined directories |
| Jira/Confluence | PASS (isolated) | Every exposed read tool and both health requests exercised against a loopback HTTP server with Basic authentication |
| Splunk | PASS (isolated) | Read-only export POST, index GET, health GET, Bearer authentication, selected API port, and offline XML generation exercised |
| Argo CD | PASS (isolated) | Every exposed application/resource/event read and allowlist filter exercised; all vendor requests remained GET |
| Bitbucket/GitLab | PASS (isolated) | Every source, review, diff, pipeline, job-trace, and health tool exercised at a full immutable commit SHA |
| SQL Server | PASS (pre-network) | Multiple named profiles enumerated without secrets; mutation and ambiguous-selection requests rejected before connection |
| MongoDB/DocumentDB | PASS (pre-network) | Multiple URI profiles enumerated without URIs/secrets; system databases, write stages, server-side code, and ambiguity rejected pre-network |
| Kiro v3 hooks | PASS | Standalone v1/PascalCase format validated; command hooks executed; malformed input failed closed; audit omitted payloads |
| Kiro v3 skills | PASS | All seven skill folders passed the skill validator and repository structural validation |
| Kiro permission reconciliation | PASS | Merge, backup/state, exact trust, restrictive-rule detection, and removal behavior covered |
| Static security | PASS | Tracked operational outputs, private wiki pages, credential file types, and high-confidence secret signatures rejected |
| Dependency security | PASS | `npm audit --omit=dev --audit-level=high` returned zero vulnerabilities |
| Dependency currency | PASS | All production dependencies were current on the QA date; newer TypeScript/Node type packages were major versions outside the supported Node 22/24 line |

## Defects found and corrected

1. The pre-tool hook interpreted the official Dynatrace `execute-dql` read tool as mutation-shaped. The exact namespaced tool is now an explicit read-only exception.
2. The same hook allowed local writers by substring. Exemptions now require the exact `itops-core/report_write` or `itops-core/artifact_write_splunk_dashboard` name, preventing suffix/prefix bypasses.
3. Source tools accepted branch names, tags, `HEAD`, and abbreviated hashes even though the investigation contract required the exact deployed revision. Every source and CI tool now requires a full 40- or 64-character commit SHA.
4. Review, specific pipeline, and job-trace reads accepted a deployed SHA as context without verifying vendor metadata. They now fail closed unless returned commit metadata matches that SHA.
5. `report_write` exposed the deeply nested incident object directly in its MCP function schema. It now accepts a flat `reportJson` string and performs full strict validation inside the server, matching the existing `panelsJson` compatibility pattern.
6. Design/task documentation still referenced the legacy `AgentSpawn` name. It now consistently specifies the v3 `SessionStart` trigger.
7. The repository lacked protocol-level MCP tests and a tracked-file secret/output gate. Both are now part of `npm run verify`, and production dependency audit is part of GitHub CI.

## Current Kiro v3 compatibility

The configuration was reconciled against the official Kiro CLI v3 documentation updated through 2026-07-23:

- Markdown agent profiles and tag-based tools
- inline stdio and HTTP MCP servers
- capability-based permissions with exact `server/tool` matches
- standalone `.kiro/hooks/*.json` v1 files and PascalCase triggers
- custom subagent allow/trust lists
- workspace Agent Skills and indexed knowledge-base resources
- `--v3 --tui --agent itops-orchestrator --require-mcp-startup`

The local Kiro CLI binary was version 2.12.1 and exposed the v3 engine and native agent validator. Native profile validation requires an authenticated Kiro session, so the installer runs it after `kiro-cli whoami` succeeds on the target PC.

## Required production acceptance

Run these commands from the repository in Windows PowerShell after completing `config\itops.env`:

```powershell
.\scripts\Install-ItOps.ps1
.\scripts\Test-ItOps.ps1
.\scripts\Start-ItOps.ps1
```

`Test-ItOps.ps1` must pass all enabled health checks. Specifically verify:

1. Splunk Kerberos Negotiate or token auth, selected port, index visibility, and bounded search.
2. Every named SQL connection routes to the exact configured readable Availability Group secondary; standalone, primary, wrong-database, or writable sessions must fail.
3. Every MongoDB/DocumentDB URI discovers only authorized non-system databases and allowlisted collections.
4. Dynatrace opens Kiro-managed confidential-client OAuth and only the declared read scopes are granted.
5. Argo CD CLI SSO/session token has read-only RBAC for the configured projects/applications.
6. Jira, Confluence, Bitbucket, and GitLab tokens can read only the configured scopes.
7. A fresh Kiro v3 chat can delegate to each of the six specialists without repeated prompts and cannot call mutation tools.
8. Direct questions return chat answers without files; an explicit full investigation creates Hebrew Markdown by default and RTL HTML only when requested.

Do not mark production acceptance complete if any enabled integration is skipped, if Kiro's native profile validation fails, or if the SQL replica proof is unavailable.
