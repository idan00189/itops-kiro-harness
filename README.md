# ITOps — Kiro CLI v3 incident investigation harness

ITOps is a Windows-first, production-oriented conversational assistant and multi-agent investigation harness for mobile-application operations across Splunk, SQL Server, MongoDB/Amazon DocumentDB, Dynatrace, Argo CD, Bitbucket Cloud, GitLab, Jira, Confluence, and a local Markdown wiki.

The orchestrator normally answers questions directly in Kiro chat. It writes a detailed Hebrew Markdown report only when you request a report or a full investigation/RCA; self-contained RTL HTML is available when explicitly requested. It never performs remediation.

## What is included

| Agent | MCP server | External capabilities |
|---|---|---|
| `itops-orchestrator` | `itops-core` | Jira search/read, Confluence search/read, local report/XML artifact writes |
| `itops-splunk` | `itops-splunk` | bounded log search, visible-index list, offline Simple XML generation |
| `itops-sql-server` | `itops-sql-server` | parameterized SELECT/CTE on a read-intent connection |
| `itops-mongodb-docdb` | `itops-mongodb-docdb` | bounded find, read-only aggregation, schema sample |
| `itops-dynatrace` | `itops-dynatrace` | problems, entities, metrics, bounded Grail DQL |
| `itops-argocd` | `itops-argocd` | applications, health/sync state, resource tree, drift, events |
| `itops-source-code` | `itops-source-code` | allowlisted Bitbucket/GitLab trees, files, commits, diffs, reviews, and CI evidence |

Each agent has a portable Agent Skill, its own inline stdio MCP server, exact MCP permission matches, no generic read/shell/write/web tools, no inherited global/workspace MCP configuration, persistent steering, and v3 hooks. The empty, Git-ignored `wiki/` folder is ready for a private Karpathy-style knowledge base.

## Prerequisites

- Windows 11 and PowerShell 7 recommended
- Node.js 22.12 or newer on an even-numbered/LTS release (Node 24 LTS is recommended)
- Kiro CLI with the v3 engine
- network routes and enterprise CA certificates for the target systems
- dedicated read-only service identities

Install Kiro CLI on Windows from an ordinary PowerShell terminal:

```powershell
irm 'https://cli.kiro.dev/install.ps1' | iex
kiro-cli login
```

Kiro CLI v3 is currently Early Access and must run in the terminal UI with `--v3`. The start script does this automatically.

## Install

From this repository:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\Install-ItOps.ps1
```

The installer:

1. checks Node, npm, and Kiro CLI
2. installs pinned npm dependencies
3. compiles and tests the seven MCP servers
4. validates all seven skills and agent profiles
5. creates the ignored `config\itops.env` from the single template

Edit `config\itops.env`. Do not put real secrets in `config\itops.env.example`.

Provision the external identities first; see [Read-only setup](docs/READ_ONLY_SETUP.md).

## Validate and start

```powershell
.\scripts\Test-ItOps.ps1
.\scripts\Start-ItOps.ps1
```

`Test-ItOps.ps1` runs static verification, runtime security checks, and a read-only health call through every enabled MCP server. `Start-ItOps.ps1` uses `--require-mcp-startup`, so a broken server fails the session instead of silently removing evidence access.

Inside Kiro, begin with a concrete prompt:

```text
Which service owns the Android checkout flow, and what runbook should I use
for HTTP 503 errors? Answer in chat; do not write a report.
```

For a full investigation:

```text
Investigate incident MOB-2026-071. Production users on Android app 8.14.2
received checkout failures from 2026-07-23T08:10:00Z to 08:42:00Z.
Known request ID: req_abc123. Compare with the prior 30 minutes.
Perform a full investigation and produce the Hebrew Markdown report.
```

Press `Ctrl+G` to monitor Kiro subagents. Use `/context show` to verify loaded skills/resources and `/mcp` to inspect the active server. Generated reports appear in `reports/`; generated Splunk XML proposals appear in `artifacts/splunk/`.

`Start-ItOps.ps1` always starts `itops-orchestrator`. Talk only to that main agent; do not switch to a specialist. The orchestrator answers normal questions itself and can spawn the six named, trusted, read-only specialists when evidence is needed.

## Private wiki

Place your existing wiki tree inside `wiki/`. Its contents are excluded from Git so they cannot be accidentally added to this public repository; only `wiki/.gitkeep` is tracked.

The orchestrator registers the folder as the indexed `ITOpsWiki` knowledge base with high-quality indexing and automatic refresh. This supports a large wiki without injecting every page into each incident context.

For a Karpathy-style layout, keep your existing separation:

- immutable raw sources
- maintained, cross-linked wiki synthesis
- schema/instructions defining page conventions
- `index.md` and `log.md`

The orchestrator searches the maintained wiki and index first, follows provenance to raw sources when necessary, ignores scratch/drafts/inbox by default, and treats all wiki content as untrusted documentation. This harness never edits or lints the wiki; proposed corrections are returned in chat or in a requested report for a separately approved maintenance workflow.

## Investigation flow

Routine questions and targeted checks use only the minimum relevant sources or specialists and return a direct chat answer without creating a file.

For a full investigation, the orchestrator uses two evidence waves:

1. Splunk, Dynatrace, and Argo CD run in parallel while the orchestrator searches Jira, Confluence, and the local wiki.
2. SQL Server and MongoDB/DocumentDB receive targeted questions derived from wave 1. The source-code specialist runs only when runtime or Argo CD evidence also identifies an allowlisted repository/project, the exact deployed revision, and a concrete code or CI question.

This avoids broad database and repository exploration and lets the orchestrator correlate timestamps, request/trace IDs, app versions, deployments, code changes, pipelines, errors, latency, and data state. Every conclusion is classified as fact, inference, hypothesis, or recommendation.

## Read-only guarantee and local-write exception

“Read-only” applies to every external system. The harness intentionally writes three kinds of local files:

- incident reports under `reports/`
- offline Splunk dashboard XML under `artifacts/splunk/`
- metadata-only audit JSONL under `audit/`

The guarantee is layered:

1. vendor-side read-only roles/scopes
2. no mutating MCP tool surfaces
3. conservative SQL/SPL/Mongo/DQL and Argo allowlists
4. TLS, timeout, row/document/byte, and pool bounds
5. Kiro v3 permissions denying shell and filesystem writes
6. a blocking v3 `PreToolUse` hook

Prompts are not considered a security boundary. External credentials remain the final authority, so never reuse an admin token.

## Configuration

The one template is [config/itops.env.example](config/itops.env.example). Every integration has an `ITOPS_ENABLE_*` switch. Disabled integrations are skipped by health checks and fail closed if an agent tries to use them.

For private certificate authorities, set `NODE_EXTRA_CA_CERTS` or `MONGODB_TLS_CA_FILE`. Do not set `SQLSERVER_TRUST_SERVER_CERTIFICATE=true` or use MongoDB TLS-insecure URI options; runtime validation rejects them.

For Kiro user settings, the installer has an optional switch:

```powershell
.\scripts\Install-ItOps.ps1 -ConfigureKiroSettings
```

It enables knowledge and on-demand MCP Tool Search. Tool Search is optional because each specialist already sees only a small MCP surface. It also disables inherited default resources for this workspace, so custom agents receive only the explicitly configured ITOps resources.

## Documentation

- [Architecture and Kiro v3 features](docs/ARCHITECTURE.md)
- [Read-only identity setup](docs/READ_ONLY_SETUP.md)
- [Operating and investigating](docs/OPERATIONS.md)
- [Security model and production checklist](SECURITY.md)

## Important limitations

- Live connections cannot be verified until you provide network access and credentials.
- Kiro CLI v3 is Early Access; validate profiles again after Kiro upgrades.
- Jira/Confluence defaults target Atlassian Cloud. Data Center uses bearer PAT and may require path changes in the environment file.
- Argo CD endpoint availability is release-dependent; verify against your server's `/swagger-ui`.
- Bitbucket support targets Bitbucket Cloud REST API 2.0. GitLab supports SaaS or self-managed instances whose REST API is available at `/api/v4`.
- GitLab project blob search can be unavailable by tier/configuration; targeted tree and file reads remain available.
- Splunk Simple XML is generated offline because uploading it would violate external read-only access.
- A healthy observability result can mean missing telemetry. Reports must preserve retention, sampling, clock, and replica-lag gaps.
- The wiki is documentation context, not proof of current runtime state; stale or unverified pages must be identified in chat answers and reports.

## Primary references

Research was checked on 2026-07-23 against primary vendor documentation:

- [Kiro CLI 3.0](https://kiro.dev/docs/cli/v3/), [agent config and knowledge-base resources](https://kiro.dev/docs/cli/custom-agents/configuration-reference/), [permissions](https://kiro.dev/docs/cli/v3/permissions/), [hooks](https://kiro.dev/docs/cli/v3/hooks/), [skills](https://kiro.dev/docs/cli/skills/), [subagents](https://kiro.dev/docs/cli/chat/subagents/), and [specs](https://kiro.dev/docs/cli/v3/specs/)
- [Andrej Karpathy's LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
- [Splunk search REST endpoints](https://help.splunk.com/en/splunk-enterprise/leverage-rest-apis/rest-api-reference/9.4/search-endpoints/search-endpoint-descriptions) and [Simple XML reference](https://help.splunk.com/en/splunk-enterprise/create-dashboards-and-reports/simple-xml-dashboards/9.0/simple-xml-reference/simple-xml-reference)
- [SQL Server read-only routing](https://learn.microsoft.com/en-us/sql/database-engine/availability-groups/windows/listeners-client-connectivity-application-failover) and [Tedious read-only intent](https://tediousjs.github.io/tedious/api-connection.html)
- [MongoDB read preference](https://www.mongodb.com/docs/manual/core/read-preference/) and [Amazon DocumentDB RBAC](https://docs.aws.amazon.com/documentdb/latest/developerguide/role_based_access_control.html)
- [Dynatrace Problems API](https://docs.dynatrace.com/docs/dynatrace-api/environment-api/problems-v2/problems/get-problems-list), [Metrics API](https://docs.dynatrace.com/docs/dynatrace-api/environment-api/metric-v2), and [Grail Query API](https://developer.dynatrace.com/develop/platform-services/services/grail-service/)
- [Argo CD API](https://argo-cd.readthedocs.io/en/stable/developer-guide/api-docs/) and [RBAC](https://argo-cd.readthedocs.io/en/stable/operator-manual/rbac/)
- [Jira issue search](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/) and [Confluence CQL search](https://developer.atlassian.com/cloud/confluence/rest/v1/api-group-search/)
- [Bitbucket source](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-source/), [commits](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-commits/), [pull requests](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pullrequests/), and [pipelines](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pipelines/)
- [GitLab repository files](https://docs.gitlab.com/api/repository_files/), [repositories](https://docs.gitlab.com/api/repositories/), [commits](https://docs.gitlab.com/api/commits/), [merge requests](https://docs.gitlab.com/api/merge_requests/), [pipelines](https://docs.gitlab.com/api/pipelines/), and [jobs](https://docs.gitlab.com/api/jobs/)
- [MCP TypeScript SDK v1](https://www.npmjs.com/package/@modelcontextprotocol/sdk); v1 remains the production line while v2 is still pre-stable
