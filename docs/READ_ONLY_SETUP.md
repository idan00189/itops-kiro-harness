# Read-only identity setup

Use a unique identity per environment and harness. Store credentials only in the ignored `config\itops.env` or a process-level secret injection mechanism.

## Splunk

`SPLUNK_AUTH_MODE=kerberos` uses the current Windows logon through `curl.exe` SSPI/SPNEGO. Confirm the configured HTTPS REST endpoint advertises HTTP `Negotiate`; this may require an enterprise reverse proxy because a direct Splunk management endpoint can still require Splunk-native token authentication.

Map the Kerberos identity to a role with:

- `search` capability only as required
- search access restricted to the relevant indexes
- no `edit_*`, `admin_*`, `delete_by_keyword`, scheduling, email, lookup-write, or output capabilities
- no API token when Kerberos is used; otherwise a token for a dedicated service user

The harness dispatches searches through `search/v2/jobs/export`; dispatching a query is allowed, but it exposes no saved-search or dashboard write endpoint. Validate the role by confirming a benign search works and an `outputlookup` search is denied by both the MCP guard and Splunk.

## SQL Server

For each name in `SQLSERVER_CONNECTIONS`, point `SQLSERVER_<NAME>_HOST` to an Availability Group listener configured for read-only routing and provide `SQLSERVER_<NAME>_DATABASE`. With a profile's `AUTH_MODE=windows`, the harness uses the Windows identity running Kiro through Microsoft ODBC Driver 18. Every profile gets an isolated pool, fixes `ApplicationIntent=ReadOnly`, and verifies its exact database is a readable secondary before the pool is exposed and before every query.

Grant the Windows account only the required tables or schemas. It also needs `VIEW SERVER STATE` to prove the local AG role. A database administrator can adapt this example:

```sql
CREATE LOGIN [CORP\itops-user] FROM WINDOWS;
USE MobileApp;
CREATE USER [CORP\itops-user] FOR LOGIN [CORP\itops-user];
GRANT SELECT ON SCHEMA::dbo TO [CORP\itops-user];
DENY INSERT, UPDATE, DELETE, EXECUTE, ALTER TO [CORP\itops-user];
USE master;
GRANT VIEW SERVER STATE TO [CORP\itops-user];
```

Prefer grants on specific schemas/tables over `db_datareader` when the database contains unrelated sensitive data. Do not add the identity to an owner or write-capable role. The `VIEW SERVER STATE` grant is used only for the fail-closed replica proof; if policy forbids it, this harness intentionally cannot claim or use replica-only access. Keep TLS encryption on and install the SQL Server issuing CA rather than trusting the server certificate.

Repeat the user/grant setup for each configured database or use one Windows identity with equivalent narrow grants. A profile using SQL authentication must have its own read-only login variables. Verify health reports every connection name with `replicaVerified: true`, the expected database, `is_primary_replica: 0`, and `READ_ONLY`. Read-only intent helps routing, the database state prevents writes, and narrow authorization remains the identity boundary.

## MongoDB / Amazon DocumentDB

Create a user with the built-in `read` role on every application database that one named URI may expose:

```javascript
use admin
db.createUser({
  user: "itops_reader",
  pwd: "<generated secret>",
  roles: [
    { role: "read", db: "mobileapp" },
    { role: "read", db: "orders" }
  ]
})
```

Do not grant `readWrite`, `dbAdmin`, `clusterManager`, or `root`. For monitoring metadata, add only separately justified read actions.

Set `MONGODB_CONNECTIONS` to the URI profile names. For each profile, `DATABASE_ALLOWLIST=*` permits all non-system databases returned by `authorizedDatabases=true`; use exact names or patterns to narrow it. `admin`, `config`, and `local` are always blocked. The agent must explicitly select a connection and database when several exist.

DocumentDB requires TLS and commonly uses:

```text
tls=true&replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false
```

Set the profile's `MONGODB_<NAME>_TLS_CA_FILE` to the AWS/global CA bundle. Never use `tlsAllowInvalidCertificates=true`, `tlsAllowInvalidHostnames=true`, or `tlsInsecure=true`.

Narrow each profile's `MONGODB_<NAME>_COLLECTION_ALLOWLIST`; credential scope remains the primary control.

## Dynatrace

Microsoft/Dynatrace browser sign-in is not itself API authentication. Ask a Dynatrace administrator to create a confidential OAuth client using the Authorization Code grant and the exact loopback redirect URI from the environment template. Grant only the remote MCP and Grail read scopes listed in `.kiro/agents/itops-dynatrace.md`, including:

- `mcp-gateway:servers:invoke`
- `mcp-gateway:servers:read`
- `ai:operator:execute`
- `storage:buckets:read`
- `storage:system:read`
- `storage:logs:read`
- `storage:spans:read`
- `storage:events:read`
- `storage:metrics:read`
- `storage:entities:read`

Use permission conditions to restrict buckets, security context, management zone, entity, or fields where possible. Kiro performs browser OAuth and refreshes the access token; effective permissions are intersected with the signed-in user.

## Argo CD

Use Microsoft/Entra SSO mapped to `role:readonly` or a narrower custom role. A project-scoped example:

```text
p, role:itops-readonly, applications, get, mobile-prod/*, allow
p, role:itops-readonly, projects, get, mobile-prod, allow
```

The harness does not expose pod logs or exec. Do not grant `sync`, `override`, `action/*`, `create`, `update`, `delete`, or `exec`. Bind the SSO group to the read-only role and narrow `ARGOCD_PROJECT_ALLOWLIST` and `ARGOCD_APPLICATION_ALLOWLIST`.

Install a current Argo CD CLI, run `scripts\Initialize-ItOpsAuth.ps1`, and verify endpoints against the server's `/swagger-ui`.

## Jira and Confluence

Create a dedicated Atlassian user that has:

- Jira Browse Projects only for incident/change projects
- issue-level security access only where necessary
- Confluence View only for relevant spaces
- no edit, transition, comment, attachment, admin, or delete permissions

For Cloud, use the user's email and API token with `ATLASSIAN_AUTH_MODE=basic`. For Data Center, use a read-only PAT with `bearer` and adjust API paths.

If using OAuth instead of an API token, request only classic read scopes such as `read:jira-work` and Confluence read scopes required by the chosen endpoints.

## Bitbucket Cloud

Prefer a dedicated repository or workspace access token restricted to the allowlisted repositories. The tools need only the read permissions used by the enabled evidence types:

- repository read (`read:repository:bitbucket`) for trees, files, commits, and diffs
- pull-request read (`read:pullrequest:bitbucket`) for review metadata and diffs
- pipeline read (`read:pipeline:bitbucket`) for pipeline and step metadata

For an Atlassian API token, set `BITBUCKET_AUTH_MODE=basic`, the Atlassian account email, and the token. For a repository/workspace access token, use `bearer`. Do not grant repository write/admin, pull-request write, webhook, runner, variable, or pipeline-control permissions.

Some vendor read permissions cover more behavior than this harness needs. The source MCP therefore exposes only bounded HTTP GET operations and has no tools for clone, comment, approve, merge, trigger, retry, stop, or variable access. Set `BITBUCKET_REPOSITORY_ALLOWLIST` to explicit `workspace/repository` values and configure one included repository for the health check.

## GitLab

Use a dedicated project or group access token where possible, restricted to the allowlisted projects. Grant `read_api` and `read_repository` only; do not grant `api`, `write_repository`, runner administration, or owner/maintainer privileges.

Set `GITLAB_BASE_URL` to the GitLab instance root, `GITLAB_AUTH_MODE=private-token`, and `GITLAB_TOKEN`. Bearer mode is available for an OAuth token with equivalent read-only authorization. Set `GITLAB_PROJECT_ALLOWLIST` to explicit numeric project IDs or `group/project` paths.

The MCP exposes only bounded repository, commit, merge-request, pipeline, job, and trace reads. It cannot comment, approve, merge, trigger, retry, cancel, erase, or modify repository content. GitLab project blob search may require a particular tier/configuration; if unavailable, the investigation must use exact tree/file paths and record the gap.

## Rotation and revocation

- rotate every token on your normal service-credential schedule
- revoke immediately when a machine or operator is decommissioned
- keep separate production and non-production credentials
- review vendor audit logs and local `audit/*.jsonl`
- test denied write behavior after RBAC changes
