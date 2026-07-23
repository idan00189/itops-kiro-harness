# Operating ITOps

## Start an investigation

Run:

```powershell
.\scripts\Start-ItOps.ps1
```

Provide:

- incident ID and severity
- production environment
- affected user journey and symptom
- UTC window or source timezone
- mobile platform/app version/region
- safe correlation identifiers
- desired report format

If a value is unknown, say so. Do not substitute an assumed environment silently.

## Observe and control Kiro

- `Ctrl+G` opens the subagent monitor.
- `/mcp` shows server startup and tool status.
- `/context show` shows loaded skills/resources.
- `/hooks` shows active hooks.
- `/spec itops-harness` opens the implementation spec.

Kiro v3 sessions are not resumable in v2. Keep v3 enabled for this workspace.

## Expected investigation pattern

Wave 1 runs Splunk, Dynatrace, and Argo CD in parallel. The orchestrator also searches Jira, Confluence, and `wiki/`.

Wave 2 runs targeted SQL or Mongo/DocumentDB checks. Examples:

- "For the 17 request IDs that failed in logs, what final order status exists?"
- "Did documents created by app version 8.14.2 omit field X during the incident window?"

Avoid questions like "find anything unusual in the database."

## Reports

Markdown is default. Ask explicitly for HTML:

```text
Produce the final report as HTML in Hebrew.
```

The report tool validates:

- structured fields and timestamps
- primary Hebrew content
- safe incident filename
- atomic creation without overwrite
- secret redaction
- local report directory only

The orchestrator can ask Splunk for dashboard XML and save it locally. No upload occurs.

## Disable an integration

Set its switch in `config\itops.env`, for example:

```text
ITOPS_ENABLE_MONGODB=false
```

Run `Test-ItOps.ps1` again. Disabled systems are skipped in health checks and reported as evidence gaps.

## After configuration or upgrades

Run:

```powershell
.\scripts\Test-ItOps.ps1
```

Also re-run:

```powershell
kiro-cli agent validate .\.kiro\agents\itops-orchestrator.md
kiro-cli chat --v3 --agent itops-orchestrator --require-mcp-startup
```

Kiro hot-reloads agent/MCP profile edits, but dependency or compiled server changes require `npm run build` and a session restart.

## Troubleshooting

- MCP startup failure: run `npm run build`, then `npm run health`.
- TLS failure: install/set the correct CA; never disable verification.
- HTTP 401/403: verify the read-only token and resource permission.
- Empty evidence: check window, timezone, retention, sampling, index/collection/project allowlist, and replica lag.
- Subagent fails immediately: verify its exact MCP permission rules and server startup.
- Kiro environment issue: run `kiro-cli diagnostic`; some releases expose the older `kiro-cli doctor` name.
- Windows logs: Kiro writes under `%TEMP%\kiro-log\logs\kiro-chat.log`.
