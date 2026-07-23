# Operating ITOps

## Start ITOps chat

Run:

```powershell
.\scripts\Start-ItOps.ps1
```

This command always opens `itops-orchestrator`. Keep the conversation there. Do not run or switch to `itops-splunk`, `itops-dynatrace`, or another specialist; the orchestrator selects and coordinates them internally.

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
- Empty evidence: check window, timezone, retention, sampling, index/collection/project/repository allowlist, revision mapping, and replica lag.
- Subagent fails immediately: verify its exact MCP permission rules and server startup.
- Wiki result is missing: confirm the files are under `wiki\`, restart the Kiro session to refresh the auto-updated index, and inspect `/context show`.
- Wiki result is stale or contradictory: preserve the conflict in the report and verify against immutable source/runtime evidence; do not silently edit the wiki.
- Kiro environment issue: run `kiro-cli diagnostic`; some releases expose the older `kiro-cli doctor` name.
- Windows logs: Kiro writes under `%TEMP%\kiro-log\logs\kiro-chat.log`.
