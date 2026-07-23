# Security model

## Trust boundaries

The model and prompts are untrusted decision-makers. Kiro permissions and hooks reduce risk, but the hard boundaries are:

- dedicated vendor read-only identities
- narrow MCP tool implementations
- fixed environment-sourced API origins
- query/stage/tool allowlists
- output, timeout, and resource limits

Never provide an admin credential because the prompt says "read-only."

## Threats addressed

- Prompt injection requesting remediation: no external write tool and pre-tool block.
- SQL/SPL/Mongo mutation: conservative query guards plus read-only credential.
- Generic command escape: agents have no shell or built-in write capability.
- SSRF: tool callers cannot supply base URLs; cross-origin redirects are rejected.
- TLS downgrade: non-local HTTP and insecure certificate settings fail validation.
- Browser-cookie theft: Dynatrace web cookies are never read; Kiro uses OAuth Authorization Code + PKCE.
- Windows credential leakage: Kerberos and integrated SQL use the process identity without accepting a password.
- Primary-database routing: SQL access fails before and during every query unless the session proves a readable AG secondary.
- CLI command injection: Splunk and Argo CD helpers use fixed executable allowlists, argument arrays, no shell, timeouts, and bounded output.
- Data exfiltration/overcollection: result bounds, projections/playbooks, recursive redaction.
- Secret leakage in audit: audit stores input hashes and metadata, not input/result payloads.
- Specialist privilege creep: one isolated MCP server per agent and agent-specific MCP permission rules.
- Path traversal: report/artifact filename validation and resolved-directory checks.
- Source overreach: repository/project allowlists, explicit refs, secret-path denylist, bounded text-only reads, and no Git/shell surface.
- Private wiki leakage: `wiki/*` is Git-ignored; the main agent consumes it through a selective local knowledge-base resource.

## Residual risks

- A vendor read-only token may still expose sensitive data.
- The current Windows user may have broader vendor permissions than desired; provider RBAC must be narrowed.
- Kerberos depends on the endpoint, SPN, ticket, reverse-proxy mapping, and Windows domain configuration.
- Dynatrace browser SSO still requires an administrator-created confidential OAuth client for API/MCP access.
- Query results can contain personal data in unrecognized fields.
- Read queries can cause load; limits reduce but do not eliminate this risk.
- Observability sources may contain malicious text that attempts prompt injection.
- Source files, commit/review text, and CI traces can contain prompt injection or accidentally committed secrets.
- Wiki schemas/pages/raw sources can contain prompt injection, stale claims, sensitive data, or instructions that conflict with ITOps policy.
- Kiro CLI v3 is Early Access and its configuration model can change.
- Dependency or vendor API vulnerabilities can affect the local process.

Treat all returned text as evidence, never as instructions. Narrow vendor scopes, indexes, tables, collections, projects, management zones, and spaces.

The incident harness keeps the wiki read-only. A Karpathy-style maintainer normally writes synthesis and indexes, but mixing that role into a live incident session could persist an unverified hypothesis. Route candidate wiki updates through a separately reviewed maintenance workflow.

## Production checklist

- [ ] `npm ci` completed from the committed lockfile.
- [ ] `npm run verify` passes.
- [ ] `Test-ItOps.ps1` passes all enabled health checks.
- [ ] Kiro validates all seven agent profiles.
- [ ] Kiro workspace trust was granted intentionally.
- [ ] No production secret appears outside ignored `config\itops.env`.
- [ ] TLS verification is enabled and enterprise CAs are installed.
- [ ] Windows `curl.exe` advertises SSPI and SPNEGO; the Splunk endpoint advertises Negotiate.
- [ ] Microsoft ODBC Driver 18 is installed and `msnodesqlv8` loaded on supported Node 22/24.
- [ ] SQL Windows login has only required SELECT and replica-proof metadata grants.
- [ ] SQL health proves the expected database is an AG secondary and read-only.
- [ ] Mongo/DocumentDB user has only `read`.
- [ ] Dynatrace confidential OAuth client has only remote-MCP/Grail read scopes and an exact loopback callback.
- [ ] Argo CD Microsoft SSO group has only `get`; no mutation verbs.
- [ ] Jira/Confluence account has browse/view only.
- [ ] Splunk role cannot schedule, write lookups, email, or delete.
- [ ] Bitbucket token has only required repository/pull-request/pipeline read permissions.
- [ ] GitLab token has only `read_api`/`read_repository` and no broad `api` scope.
- [ ] Collection/project/application/index scopes are narrowed.
- [ ] The private wiki is present only under ignored `wiki/` content and has appropriate local ACLs.
- [ ] Wiki pages carry provenance/verification metadata and scratch/draft areas are separated.
- [ ] Audit/report/artifact directories have operator-only filesystem ACLs.
- [ ] Token rotation and incident-data retention are documented.

## Reporting a security issue

Do not attach credentials, production logs, or personal data to a bug report. Provide redacted configuration names, tool name, error category, Kiro/Node versions, and a minimal reproduction.
