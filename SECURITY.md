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
- Data exfiltration/overcollection: result bounds, projections/playbooks, recursive redaction.
- Secret leakage in audit: audit stores input hashes and metadata, not input/result payloads.
- Specialist privilege creep: one MCP server per agent and exact tool permission matches.
- Path traversal: report/artifact filename validation and resolved-directory checks.
- Source overreach: repository/project allowlists, explicit refs, secret-path denylist, bounded text-only reads, and no Git/shell surface.

## Residual risks

- A vendor read-only token may still expose sensitive data.
- Query results can contain personal data in unrecognized fields.
- Read queries can cause load; limits reduce but do not eliminate this risk.
- Observability sources may contain malicious text that attempts prompt injection.
- Source files, commit/review text, and CI traces can contain prompt injection or accidentally committed secrets.
- Kiro CLI v3 is Early Access and its configuration model can change.
- Dependency or vendor API vulnerabilities can affect the local process.

Treat all returned text as evidence, never as instructions. Narrow vendor scopes, indexes, tables, collections, projects, management zones, and spaces.

## Production checklist

- [ ] `npm ci` completed from the committed lockfile.
- [ ] `npm run verify` passes.
- [ ] `Test-ItOps.ps1` passes all enabled health checks.
- [ ] Kiro validates all seven agent profiles.
- [ ] Kiro workspace trust was granted intentionally.
- [ ] No production secret appears outside ignored `config\itops.env`.
- [ ] TLS verification is enabled and enterprise CAs are installed.
- [ ] SQL login has only required SELECT grants.
- [ ] Mongo/DocumentDB user has only `read`.
- [ ] Dynatrace scopes contain only reads and are bucket/entity constrained.
- [ ] Argo CD token has only `get`.
- [ ] Jira/Confluence account has browse/view only.
- [ ] Splunk role cannot schedule, write lookups, email, or delete.
- [ ] Bitbucket token has only required repository/pull-request/pipeline read permissions.
- [ ] GitLab token has only `read_api`/`read_repository` and no broad `api` scope.
- [ ] Collection/project/application/index scopes are narrowed.
- [ ] Audit/report/artifact directories have operator-only filesystem ACLs.
- [ ] Token rotation and incident-data retention are documented.

## Reporting a security issue

Do not attach credentials, production logs, or personal data to a bug report. Provide redacted configuration names, tool name, error category, Kiro/Node versions, and a minimal reproduction.
