# Operating ITOps

## Start ITOps chat

Run:

```powershell
.\scripts\Initialize-ItOpsAuth.ps1
.\scripts\Start-ItOps.ps1
```

The authentication initializer reuses or opens Argo CD Microsoft SSO. Dynatrace OAuth opens in the browser when Kiro first starts that specialist. `Start-ItOps.ps1` runs the initializer automatically and always opens `itops-orchestrator`. Keep the conversation there. Do not run or switch to a specialist; the orchestrator selects and coordinates them internally.

`Start-ItOps.ps1` first checks the current Windows user's exact Kiro permission allowlist. If it is missing or stale, the script stops before chat and tells you to run `.\scripts\Set-ItOpsKiroPermissions.ps1`. The installer normally performs this once per PC.

The default interaction is an ordinary operational question. Examples:

```text
What does error MOB-PAY-104 mean?
Which team owns checkout-api?
Check whether this request ID appears in Splunk during the last 15 minutes.
Explain the current Argo CD revision for mobile-prod.
```

The orchestrator answers in chat and may use the wiki, Jira, Confluence, or a minimal specialist delegation. It does not write a report.

For a full investigation, provide:

- incident ID and severity
- production environment
- affected user journey and symptom
- UTC window or source timezone
- mobile platform/app version/region
- safe correlation identifiers
- desired report format, if HTML is required

If a value is unknown, say so. Do not substitute an assumed environment silently.

## Observe and control Kiro

- `Ctrl+G` opens the subagent monitor.
- `/mcp` shows server startup and tool status.
- `/mcp auth` forces browser OAuth for the remote Dynatrace server.
- `/mcp logout` removes Kiro's stored Dynatrace OAuth credentials.
- `/context show` shows loaded skills/resources.
- `/hooks` shows active hooks.
- `/spec itops-harness` opens the implementation spec.

Kiro v3 sessions are not resumable in v2. Keep v3 enabled for this workspace.

## Add the private wiki

Copy your existing Karpathy-style wiki under `wiki\`:

```text
wiki\
  sources\          immutable originals
  wiki\             maintained synthesis, if your layout nests it
  index.md          or wiki\index.md
  log.md
  AGENTS.md         or another wiki schema
```

Keep your existing paths and schema; the harness does not require renaming pages. Wiki contents are Git-ignored and are indexed locally as `ITOpsWiki` when the orchestrator starts.

The wiki workflow is query-only. It searches maintained/index pages before raw sources, records `WIKI-NNN` citations, ignores scratch/drafts/inbox by default, and does not ingest or update the wiki. Review proposed corrections from the chat answer or full investigation report in your separate maintenance workflow.

## Expected investigation pattern

For a normal question or targeted check, the orchestrator uses only the smallest relevant source set and answers in chat.

For a full investigation, wave 1 runs Splunk, Dynatrace, and Argo CD in parallel. The orchestrator also searches Jira, Confluence, and `wiki/`.

Wave 2 runs targeted SQL, Mongo/DocumentDB, or source-code checks. Examples:

- "For the 17 request IDs that failed in logs, what final order status exists?"
- "Did documents created by app version 8.14.2 omit field X during the incident window?"
- "Argo deployed GitLab commit `abc123` at 08:07Z and `DT-004` points to `CheckoutMapper.map`; did that commit change the implicated path, and did its pipeline test it?"

Avoid questions like "find anything unusual in the database" or "search the repository for the bug." Source work requires the provider, allowlisted repository/project, exact deployed SHA, motivating evidence IDs, and a precise question.

When several database connections are configured, runtime/deployment evidence should identify the expected connection first. The SQL specialist lists named profiles and queries exactly one. The Mongo/DocumentDB specialist lists named URIs, discovers the authorized application databases for the selected URI, and passes both selectors to every data call. Neither specialist broadcasts an investigation across all configured databases.

## Reports

Reports are not created for routine chat questions or targeted checks, even when a specialist is used.

A report is created when you explicitly request one or ask for a full/end-to-end investigation, formal RCA, postmortem, or comprehensive multi-system analysis. Hebrew Markdown is the default. Ask explicitly for HTML:

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

To enable source investigation for only one provider:

```text
ITOPS_ENABLE_SOURCE_CODE=true
ITOPS_ENABLE_BITBUCKET=false
ITOPS_ENABLE_GITLAB=true
```

Run `Test-ItOps.ps1` again. Disabled systems are skipped in health checks and reported as evidence gaps.

## After configuration or upgrades

Run:

```powershell
.\scripts\Set-ItOpsKiroPermissions.ps1
.\scripts\Test-ItOps.ps1
```

Also re-run:

```powershell
kiro-cli agent validate --path .\.kiro\agents\itops-orchestrator.md
kiro-cli chat --v3 --tui --agent itops-orchestrator --require-mcp-startup
```

Kiro hot-reloads agent/MCP profile edits, but dependency or compiled server changes require `npm run build` and a session restart.

Kiro keeps permissions in `%USERPROFILE%\.kiro\settings\permissions.yaml`, outside Git. Run the permission configurator after pulling a harness release that adds or renames tools. It preserves user rules and writes a timestamped backup before changing an existing file. `-Check`, `-DryRun`, and `-Remove` provide non-mutating validation, preview, and removal of only ITOps-managed rules.

## Troubleshooting

- MCP startup failure: run `npm run build`, then `npm run health`.
- Repeated subagent/tool approval: close the current chat, run `.\scripts\Set-ItOpsKiroPermissions.ps1 -Check`; if it reports missing entries, run the command without `-Check` and start a fresh chat. Do not solve this with `mcp:*`, shell, or filesystem wildcards.
- `maximum allowed nesting depth` while calling Splunk: pull the current `main`, rerun `Install-ItOps.ps1`, and start a fresh chat. Version 1.3.1 exposes dashboard panels through the flat `panelsJson` argument so the entire Splunk MCP tool set stays inside provider schema-depth limits.
- Splunk Kerberos failure: verify `curl.exe --version` lists SSPI/SPNEGO, the Windows ticket/SPN is valid, and the HTTPS endpoint returns `WWW-Authenticate: Negotiate`.
- Splunk port failure: set `SPLUNK_BASE_URL=https://host` and `SPLUNK_PORT=1..65535`; if the URL already embeds a port, leave `SPLUNK_PORT` empty or make both values identical.
- SQL replica refusal: verify the named profile, its host is the correct AG listener, its exact database participates in the AG, read-only routing is configured, and that profile's identity can execute the replica proof.
- SQL connection required: call `sql_list_connections` and select the profile identified by the incident evidence.
- Mongo database discovery failure: confirm the URI identity has `read` on at least one application database and the server supports `authorizedDatabases=true`.
- Mongo connection/database required: list connections and authorized databases, then pass both selectors explicitly.
- Argo CD SSO failure: run `scripts\Initialize-ItOpsAuth.ps1`, verify the context name, and confirm your CLI supports `account session-token`.
- Dynatrace OAuth failure: verify the confidential client, exact loopback callback, remote MCP URL, read scopes, and `/mcp auth`.
- TLS failure: install/set the correct CA; never disable verification.
- HTTP 401/403: verify the read-only token and resource permission.
- Empty evidence: check connection/profile selection, database, window, timezone, retention, sampling, database/collection/project/repository allowlist, revision mapping, and replica lag.
- Subagent fails immediately: run the machine-local permission check, inspect `/mcp`, and verify that specialist's server startup.
- Wiki result is missing: confirm the files are under `wiki\`, restart the Kiro session to refresh the auto-updated index, and inspect `/context show`.
- Wiki result is stale or contradictory: preserve the conflict in the report and verify against immutable source/runtime evidence; do not silently edit the wiki.
- Kiro environment issue: run `kiro-cli doctor --all` for installation/configuration checks or `kiro-cli diagnostic --force` for a standalone diagnostic report.
- Windows logs: Kiro writes under `%TEMP%\kiro-log\logs\kiro-chat.log`.
