# ITOps — Kiro CLI v3 incident investigation harness

ITOps is a Windows-first, production-oriented conversational assistant and multi-agent investigation harness for mobile-application operations across Splunk, SQL Server, MongoDB/Amazon DocumentDB, Dynatrace, Argo CD, Bitbucket Cloud, GitLab, Jira, Confluence, and a local Markdown wiki.

The orchestrator normally answers questions directly in Kiro chat. It writes a detailed Hebrew Markdown report only when you request a report or a full investigation/RCA; self-contained RTL HTML is available when explicitly requested. It never performs remediation.

## What is included

| Agent | MCP server | External capabilities |
|---|---|---|
| `itops-orchestrator` | `itops-core` | Jira search/read, Confluence search/read, local report/XML artifact writes |
| `itops-splunk` | `itops-splunk` | bounded log search, visible-index list, offline Simple XML generation |
| `itops-sql-server` | `itops-sql-server` | parameterized SELECT/CTE after exact-database readable-secondary proof |
| `itops-mongodb-docdb` | `itops-mongodb-docdb` | bounded find, read-only aggregation, schema sample |
| `itops-dynatrace` | official remote `dynatrace-platform` | Kiro OAuth + Microsoft SSO, bounded Grail analysis |
| `itops-argocd` | `itops-argocd` | CLI SSO, applications, health/sync state, resource tree, drift, events |
| `itops-source-code` | `itops-source-code` | allowlisted Bitbucket/GitLab trees, files, commits, diffs, reviews, and CI evidence |

Each agent has a portable Agent Skill and exactly one isolated inline MCP server. Six are local stdio servers; Dynatrace uses the official remote MCP with Kiro-managed OAuth. Profiles have narrow permissions, no generic read/shell/write/web tools, no inherited global/workspace MCP configuration, persistent steering, and v3 hooks. The empty, Git-ignored `wiki/` folder is ready for a private Karpathy-style knowledge base.

## Prerequisites

- Windows 11 and PowerShell 7 recommended
- Node.js 22.12 or newer on an even-numbered/LTS release (Node 24 LTS is recommended)
- Kiro CLI with the v3 engine
- Microsoft ODBC Driver 18 for SQL Server
- a current `argocd` CLI with `account session-token`
- Windows `curl.exe` with SSPI and SPNEGO for Splunk Kerberos
- network routes and enterprise CA certificates for the target systems
- read-only API identities plus correctly scoped Microsoft/Windows user access

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
3. compiles and tests the six local MCP servers and validates the remote Dynatrace profile
4. validates all seven skills and agent profiles
5. creates the ignored `config\itops.env` from the single template

Edit `config\itops.env`. Do not put real secrets in `config\itops.env.example`.

Provision the external identities first; see [Authentication](docs/AUTHENTICATION.md) and [Read-only setup](docs/READ_ONLY_SETUP.md).

## Connect every system

All connection settings live in the ignored `config\itops.env` file. If the installer did not create it, copy the template:

```powershell
Copy-Item .\config\itops.env.example .\config\itops.env
notepad .\config\itops.env
```

Keep real passwords, tokens, client secrets, connection strings, and internal hostnames only in `config\itops.env`. Never put them in `config\itops.env.example`, an agent file, the wiki, a report, or Git. Set an integration's `ITOPS_ENABLE_*` value to `false` until its identity, network route, TLS trust, and allowlists are ready; enabled but incomplete integrations intentionally fail validation.

Use production hostnames with HTTPS and your enterprise CA. Do not weaken certificate verification to make a connection pass. The service-side identity is the final security boundary, so each identity must be read-only even though the harness also removes mutating tools.

### Jira and Confluence

For Atlassian Cloud, create an API token for a dedicated account that has only Jira **Browse Projects** and Confluence **View** access to the required projects and spaces. The token replaces the password in HTTP Basic authentication; it is not a Jira password. See Atlassian's [Jira](https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/) and [Confluence](https://developer.atlassian.com/cloud/confluence/basic-auth-for-rest-apis/) authentication documentation.

```dotenv
ITOPS_ENABLE_ATLASSIAN=true
ATLASSIAN_BASE_URL=https://YOUR_SITE.atlassian.net
ATLASSIAN_AUTH_MODE=basic
ATLASSIAN_EMAIL=itops-reader@example.com
ATLASSIAN_API_TOKEN=REPLACE_ME
ATLASSIAN_JIRA_SEARCH_PATH=/rest/api/3/search/jql
ATLASSIAN_CONFLUENCE_SEARCH_PATH=/wiki/rest/api/search
```

The token must be valid for direct REST requests to `YOUR_SITE.atlassian.net`. If your organization issues only scoped tokens that require Atlassian's `api.atlassian.com/ex/...` gateway URLs, verify the URLs with your Atlassian administrator before enabling this shared-base connector.

For Jira/Confluence Data Center, use a read-only personal access token and set `ATLASSIAN_AUTH_MODE=bearer`, the Data Center base URL, and the REST paths used by that installation. A `401` means the credential or authentication mode is wrong; a `403` normally means the account is authenticated but lacks access to the requested project or space.

### Splunk

The Windows default uses the current signed-in user through `curl.exe`, SSPI, and SPNEGO:

```dotenv
ITOPS_ENABLE_SPLUNK=true
SPLUNK_AUTH_MODE=kerberos
SPLUNK_BASE_URL=https://splunk-rest.example.com:8089
SPLUNK_CURL_PATH=curl.exe
SPLUNK_CURL_CA_BUNDLE=
```

Before enabling it, run:

```powershell
curl.exe --version
klist
```

`curl.exe --version` must list `SSPI` and `SPNEGO`, and `klist` must show a valid Windows Kerberos ticket. The configured endpoint must advertise HTTP `Negotiate`; in many enterprises this is a Kerberos-enabled reverse proxy in front of Splunk because a direct Splunk management endpoint may use token authentication instead. The Splunk role needs search access only to the required indexes. Do not grant search scheduling, lookup writes, delete, alert actions, or email capabilities.

If Kerberos is unavailable, use a read-only Splunk token:

```dotenv
SPLUNK_AUTH_MODE=token
SPLUNK_TOKEN=REPLACE_ME
SPLUNK_AUTH_SCHEME=Bearer
```

Some Splunk deployments expect `SPLUNK_AUTH_SCHEME=Splunk`; use the scheme configured by your administrator. The harness bounds the time range and result count, blocks dangerous SPL commands, and generates dashboard XML only as a local offline artifact—it never uploads a dashboard.

### SQL Server readable replica

Windows Integrated Authentication is the preferred mode:

```dotenv
ITOPS_ENABLE_SQLSERVER=true
SQLSERVER_AUTH_MODE=windows
SQLSERVER_HOST=ag-listener.example.com
SQLSERVER_PORT=1433
SQLSERVER_DATABASE=ExactMobileDatabaseName
SQLSERVER_ODBC_DRIVER=ODBC Driver 18 for SQL Server
SQLSERVER_MULTI_SUBNET_FAILOVER=true
SQLSERVER_ENCRYPT=true
SQLSERVER_TRUST_SERVER_CERTIFICATE=false
```

Install Microsoft ODBC Driver 18 and grant the current Windows user only `CONNECT`, `SELECT` on the required schemas/tables or views, and the minimum permission needed to read availability-group state (`VIEW SERVER STATE`, or the version-specific equivalent your DBA approves). Point `SQLSERVER_HOST` at the availability-group listener configured for read-only routing, and provide the exact database name.

It is impossible to prove a server's replica role before opening a network connection. The harness therefore connects with `ApplicationIntent=ReadOnly`, immediately performs only its role proof, and closes/refuses the connection unless all of these are true:

- the connected database name exactly matches `SQLSERVER_DATABASE`
- the database participates in an availability group
- the replica is not primary
- the database is not writable

The same proof is repeated in every query batch before the bounded, parameterized `SELECT` or CTE is executed. This follows Microsoft's [read-only routing and `ApplicationIntent`](https://learn.microsoft.com/en-us/sql/database-engine/availability-groups/windows/listeners-client-connectivity-application-failover) model. The harness cannot make an incorrectly privileged SQL login safe, so the login must still be read-only.

If Windows authentication is not possible, a dedicated SQL login is supported:

```dotenv
SQLSERVER_AUTH_MODE=sql
SQLSERVER_USERNAME=itops_reader
SQLSERVER_PASSWORD=REPLACE_ME
```

The replica proof remains mandatory in either mode. Do not enable the integration against a standalone database, a primary replica, a writable secondary, or an unknown database name.

### MongoDB

Create a database user with a read-only role on the one required database, restrict its network source, require TLS, and keep the collection allowlist narrow:

```dotenv
ITOPS_ENABLE_MONGODB=true
MONGODB_MODE=mongodb
MONGODB_URI=mongodb://itops_reader:REPLACE_ME@mongo.example.com:27017/?tls=true
MONGODB_DATABASE=mobile
MONGODB_READ_PREFERENCE=secondaryPreferred
MONGODB_COLLECTION_ALLOWLIST=orders,transactions,users
MONGODB_TLS_CA_FILE=C:\certificates\enterprise-ca.pem
```

The driver disables retryable writes, applies the configured read preference, and exposes only bounded find, safe aggregation, and schema-sampling tools. Review MongoDB's [connection-string and read-preference options](https://www.mongodb.com/docs/manual/reference/connection-string-options/). Percent-encode reserved characters in URI usernames and passwords.

### Amazon DocumentDB

The DocumentDB cluster must be reachable from the Windows PC through the approved VPN/VPC route, security groups, and DNS. Download the current AWS CA bundle and configure a read-only database user:

```dotenv
ITOPS_ENABLE_MONGODB=true
MONGODB_MODE=documentdb
MONGODB_URI=mongodb://itops_reader:REPLACE_ME@cluster.cluster-xxxxxxxxxxxx.eu-west-1.docdb.amazonaws.com:27017/?tls=true&replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false
MONGODB_DATABASE=mobile
MONGODB_READ_PREFERENCE=secondaryPreferred
MONGODB_COLLECTION_ALLOWLIST=orders,transactions,users
MONGODB_TLS_CA_FILE=C:\certificates\global-bundle.pem
```

Use the cluster endpoint and AWS's documented [TLS, replica-set, and read-preference parameters](https://docs.aws.amazon.com/documentdb/latest/devguide/connect_programmatically.html). Percent-encode reserved credential characters. Do not add TLS-insecure options; runtime validation rejects them.

### Dynatrace with Microsoft login

Microsoft login authenticates the human user, but it is not by itself an MCP/API credential. A Dynatrace administrator must create a confidential OAuth client using the Authorization Code grant, allow the exact loopback redirect URI below, assign only the read scopes listed in `.kiro\agents\itops-dynatrace.md`, and give the Microsoft user access to that client and environment. Follow Dynatrace's [MCP](https://docs.dynatrace.com/docs/dynatrace-intelligence/dynatrace-mcp) and [OAuth client](https://docs.dynatrace.com/docs/manage/identity-access-management/access-tokens-and-oauth-clients/oauth-clients) setup.

```dotenv
ITOPS_ENABLE_DYNATRACE=true
DYNATRACE_MCP_URL=https://YOUR_ENV.apps.dynatrace.com/platform-reserved/mcp-gateway/v0.1/servers/dynatrace-mcp/mcp
DYNATRACE_OAUTH_CLIENT_ID=REPLACE_ME
DYNATRACE_OAUTH_CLIENT_SECRET=REPLACE_ME
DYNATRACE_OAUTH_REDIRECT_URI=http://127.0.0.1:7778/oauth/callback
```

The client ID and secret identify the OAuth application; the interactive Microsoft browser login identifies the user. Effective access is the intersection of the OAuth client's scopes and the user's Dynatrace permissions. Do not grant write/configuration scopes. If a future Dynatrace tool needs another read scope, review that scope and update the Dynatrace agent profile explicitly instead of granting broad access.

Kiro opens the browser when the Dynatrace specialist is first needed. Inside Kiro, `/mcp auth` can start authentication manually and `/mcp logout` clears the cached session. `Test-ItOps.ps1` reports this remote check as deferred because the OAuth lifecycle belongs to Kiro.

### Argo CD with Microsoft login

Ask the Argo CD administrator to configure Microsoft Entra ID SSO and the CLI callback, then create an Argo CD RBAC role that can only `get` the allowlisted applications/projects and their read-only status resources. It must not allow sync, update, delete, action, exec, override, or repository-secret access. See Argo CD's [Microsoft SSO](https://argo-cd.readthedocs.io/en/stable/operator-manual/user-management/microsoft/), [RBAC](https://argo-cd.readthedocs.io/en/stable/operator-manual/rbac/), and [session-token](https://argo-cd.readthedocs.io/en/latest/user-guide/commands/argocd_account_session-token/) documentation.

```dotenv
ITOPS_ENABLE_ARGOCD=true
ARGOCD_AUTH_MODE=cli-sso
ARGOCD_BASE_URL=https://argocd.example.com
ARGOCD_CLI_PATH=argocd.exe
ARGOCD_CLI_SERVER=argocd.example.com
ARGOCD_CLI_CONTEXT=itops-readonly
ARGOCD_CLI_CONFIG=
ARGOCD_CLI_GRPC_WEB=false
ARGOCD_CLI_GRPC_WEB_ROOT_PATH=
ARGOCD_PROJECT_ALLOWLIST=mobile-production
ARGOCD_APPLICATION_ALLOWLIST=mobile-api,mobile-worker
```

Run the authentication helper from an interactive Windows session:

```powershell
.\scripts\Initialize-ItOpsAuth.ps1
```

It runs `argocd login ... --sso` and opens the Microsoft browser flow. The normal Argo CD authentication context stays in the current Windows user's CLI config—not in `itops.env`—and the MCP process captures the derived session token in memory when it starts. Protect the user's CLI config with normal Windows profile permissions. If your ingress requires gRPC-Web, set `ARGOCD_CLI_GRPC_WEB=true` and, when applicable, its root path.

A dedicated read-only token is an alternative:

```dotenv
ARGOCD_AUTH_MODE=token
ARGOCD_TOKEN=REPLACE_ME
```

Use one authentication mode, not both. The project and application allowlists are mandatory defense-in-depth and should contain only the mobile application resources that the agent may inspect.

### Bitbucket Cloud

Create a dedicated repository/workspace API or access token with repository read, pull-request read, and pipeline read permissions only. The provider may bundle extra permissions with a read scope, but the harness exposes no comment, merge, pipeline-run, or write tool.

```dotenv
ITOPS_ENABLE_SOURCE_CODE=true
ITOPS_ENABLE_BITBUCKET=true
BITBUCKET_BASE_URL=https://api.bitbucket.org
BITBUCKET_AUTH_MODE=bearer
BITBUCKET_API_TOKEN=REPLACE_ME
BITBUCKET_REPOSITORY_ALLOWLIST=mobile/mobile-api,mobile/mobile-app
BITBUCKET_HEALTH_REPOSITORY=mobile/mobile-api
```

Each allowlist entry is `workspace/repository`. `BITBUCKET_HEALTH_REPOSITORY` must be one accessible allowlisted repository. For a user API token, follow Bitbucket's [API authentication instructions](https://support.atlassian.com/bitbucket-cloud/docs/using-api-tokens/) and use Basic authentication with the Atlassian account email:

```dotenv
BITBUCKET_AUTH_MODE=basic
BITBUCKET_EMAIL=itops-reader@example.com
BITBUCKET_API_TOKEN=REPLACE_ME
```

Confirm the exact permissions against Bitbucket's [API-token permissions](https://support.atlassian.com/bitbucket-cloud/docs/api-token-permissions/). Do not use an app password or token that can administer repositories, merge pull requests, or run pipelines.

### GitLab

Prefer a project or group access token over a personal token. Give it the lowest role that can read the required projects—normally Reporter—and only `read_api` and `read_repository`; do not grant the broad `api` scope.

```dotenv
ITOPS_ENABLE_SOURCE_CODE=true
ITOPS_ENABLE_GITLAB=true
GITLAB_BASE_URL=https://gitlab.example.com
GITLAB_AUTH_MODE=private-token
GITLAB_TOKEN=REPLACE_ME
GITLAB_PROJECT_ALLOWLIST=mobile/mobile-api,mobile/mobile-app
GITLAB_HEALTH_PROJECT=mobile/mobile-api
```

Each project entry uses its full namespace path. `GITLAB_HEALTH_PROJECT` must be accessible and allowlisted. `private-token` sends GitLab's `PRIVATE-TOKEN` header; an OAuth access token can instead use `GITLAB_AUTH_MODE=bearer`. Review GitLab's [REST authentication](https://docs.gitlab.com/api/rest/authentication/) and [token scopes](https://docs.gitlab.com/security/tokens/access_token_scopes/).

If only one source-code provider is used, leave `ITOPS_ENABLE_SOURCE_CODE=true` and disable the unused provider with `ITOPS_ENABLE_BITBUCKET=false` or `ITOPS_ENABLE_GITLAB=false`.

### Private wiki

The wiki does not need a credential or remote connection. Copy the private Markdown tree under `wiki\`:

```powershell
Copy-Item -Recurse C:\path\to\your\wiki\* .\wiki\
```

The folder contents are ignored by Git. Restart the harness after a large initial copy so Kiro indexes the complete knowledge base. Keep credentials and secret values out of wiki pages because retrieved text can be included in the agent's working context.

### Authenticate, verify, and troubleshoot

After all enabled integrations are configured:

```powershell
.\scripts\Initialize-ItOpsAuth.ps1
.\scripts\Test-ItOps.ps1
.\scripts\Start-ItOps.ps1
```

For configuration-only validation before the PC has network access:

```powershell
.\scripts\Test-ItOps.ps1 -SkipConnections
```

The full test checks local configuration, dependencies, TLS/security invariants, the SQL ODBC driver, Argo CD authentication, and a read-only health operation for each enabled local MCP server. Dynatrace remains `DEFER` until Kiro performs OAuth. When a check fails:

1. verify DNS, VPN/firewall access, proxy rules, system time, and the enterprise CA
2. verify the base URL and exact database/repository/project allowlist entry
3. treat `401` as an authentication/token problem and `403` as a role/scope/access problem
4. disable integrations that are intentionally not available instead of inserting dummy credentials
5. rerun `Test-ItOps.ps1`; do not bypass TLS or expand permissions just to obtain a successful health check

Once Kiro starts, talk only to `itops-orchestrator`. Ask it a narrow question for each enabled source—for example, to identify an allowlisted Argo CD application or GitLab commit—before relying on a full incident investigation.

## Validate and start

```powershell
.\scripts\Initialize-ItOpsAuth.ps1
.\scripts\Test-ItOps.ps1
.\scripts\Start-ItOps.ps1
```

`Initialize-ItOpsAuth.ps1` reuses or opens Microsoft-backed Argo CD CLI SSO. Dynatrace browser OAuth is handled by Kiro when that specialist first starts. `Test-ItOps.ps1` runs static verification, runtime security checks, read-only health calls for enabled local servers, and defers the remote Dynatrace OAuth check to Kiro. `Start-ItOps.ps1` uses `--require-mcp-startup`, so a broken server fails instead of silently removing evidence access.

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

1. vendor-side read-only roles/scopes, Windows access, and OAuth scope intersection
2. no mutating MCP tool surfaces
3. Kerberos/SSO helpers without a shell, SQL replica proof, and conservative SQL/SPL/Mongo/Argo allowlists
4. TLS, timeout, row/document/byte, and pool bounds
5. Kiro v3 permissions denying shell and filesystem writes
6. a blocking v3 `PreToolUse` hook

Prompts are not considered a security boundary. External credentials remain the final authority, so never reuse an admin token.

## Configuration

The one template is [config/itops.env.example](config/itops.env.example). Every integration has an `ITOPS_ENABLE_*` switch. Disabled integrations are skipped by health checks and fail closed if an agent tries to use them.

Authentication is also selected in this file. Defaults are Windows Kerberos for Splunk, Windows Integrated Authentication for SQL Server, Argo CD CLI SSO, and Kiro-managed Dynatrace OAuth. Jira, Confluence, Bitbucket, and GitLab use their configured read-only API/access tokens.

For private certificate authorities, set `NODE_EXTRA_CA_CERTS` or `MONGODB_TLS_CA_FILE`. Do not set `SQLSERVER_TRUST_SERVER_CERTIFICATE=true` or use MongoDB TLS-insecure URI options; runtime validation rejects them.

For Kiro user settings, the installer has an optional switch:

```powershell
.\scripts\Install-ItOps.ps1 -ConfigureKiroSettings
```

It enables knowledge and on-demand MCP Tool Search. Tool Search is optional because each specialist already sees only a small MCP surface. It also disables inherited default resources for this workspace, so custom agents receive only the explicitly configured ITOps resources.

## Documentation

- [Architecture and Kiro v3 features](docs/ARCHITECTURE.md)
- [Windows authentication and Microsoft SSO](docs/AUTHENTICATION.md)
- [Read-only identity setup](docs/READ_ONLY_SETUP.md)
- [Operating and investigating](docs/OPERATIONS.md)
- [Security model and production checklist](SECURITY.md)

## Important limitations

- Live connections cannot be verified until you provide network access and credentials.
- Splunk Kerberos works only when the configured HTTPS endpoint advertises HTTP Negotiate; direct Splunk REST may still require a token or Kerberos-capable reverse proxy.
- SQL replica state can be proven only immediately after connection. The harness requests read-only routing and fails before every investigation query unless the session is a readable AG secondary.
- Dynatrace Microsoft web login is not an API credential. A confidential Authorization Code OAuth client is still required for Kiro-managed browser OAuth.
- Argo CD CLI SSO requires a current CLI and an SSO context whose user/group has read-only RBAC.
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
- [SQL Server read-only routing](https://learn.microsoft.com/en-us/sql/database-engine/availability-groups/windows/listeners-client-connectivity-application-failover), [`sys.fn_hadr_is_primary_replica`](https://learn.microsoft.com/en-us/sql/relational-databases/system-functions/sys-fn-hadr-is-primary-replica-transact-sql), and [node-mssql Windows authentication](https://tediousjs.github.io/node-mssql/)
- [MongoDB read preference](https://www.mongodb.com/docs/manual/core/read-preference/) and [Amazon DocumentDB RBAC](https://docs.aws.amazon.com/documentdb/latest/developerguide/role_based_access_control.html)
- [Dynatrace MCP](https://docs.dynatrace.com/docs/dynatrace-intelligence/dynatrace-mcp), [OAuth clients](https://docs.dynatrace.com/docs/manage/identity-access-management/access-tokens-and-oauth-clients/oauth-clients), and [Microsoft sign-in](https://docs.dynatrace.com/docs/manage/identity-access-management/user-and-group-management/sign-in-with-microsoft)
- [Argo CD API](https://argo-cd.readthedocs.io/en/stable/developer-guide/api-docs/), [Microsoft SSO](https://argo-cd.readthedocs.io/en/stable/operator-manual/user-management/microsoft/), [`account session-token`](https://argo-cd.readthedocs.io/en/latest/user-guide/commands/argocd_account_session-token/), and [RBAC](https://argo-cd.readthedocs.io/en/stable/operator-manual/rbac/)
- [Jira issue search](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/) and [Confluence CQL search](https://developer.atlassian.com/cloud/confluence/rest/v1/api-group-search/)
- [Bitbucket source](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-source/), [commits](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-commits/), [pull requests](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pullrequests/), and [pipelines](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pipelines/)
- [GitLab repository files](https://docs.gitlab.com/api/repository_files/), [repositories](https://docs.gitlab.com/api/repositories/), [commits](https://docs.gitlab.com/api/commits/), [merge requests](https://docs.gitlab.com/api/merge_requests/), [pipelines](https://docs.gitlab.com/api/pipelines/), and [jobs](https://docs.gitlab.com/api/jobs/)
- [MCP TypeScript SDK v1](https://www.npmjs.com/package/@modelcontextprotocol/sdk); v1 remains the production line while v2 is still pre-stable
