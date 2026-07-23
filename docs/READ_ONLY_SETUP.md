# Read-only identity setup

Use a unique identity per environment and harness. Store credentials only in the ignored `config\itops.env` or a process-level secret injection mechanism.

## Splunk

Create a role with:

- `search` capability only as required
- search access restricted to the relevant indexes
- no `edit_*`, `admin_*`, `delete_by_keyword`, scheduling, email, lookup-write, or output capabilities
- a token for a dedicated service user

The harness dispatches searches through `search/v2/jobs/export`; dispatching a query is allowed, but it exposes no saved-search or dashboard write endpoint. Validate the role by confirming a benign search works and an `outputlookup` search is denied by both the MCP guard and Splunk.

## SQL Server

Point `SQLSERVER_HOST` to an Availability Group listener configured for read-only routing. The driver sets `readOnlyIntent=true`.

Create a dedicated SQL login/user and grant only the required tables or schemas. A database administrator can adapt this example:

```sql
CREATE LOGIN itops_reader WITH PASSWORD = '<generated secret>';
USE MobileApp;
CREATE USER itops_reader FOR LOGIN itops_reader;
GRANT SELECT ON SCHEMA::dbo TO itops_reader;
DENY INSERT, UPDATE, DELETE, EXECUTE, ALTER, CONTROL TO itops_reader;
```

Prefer grants on specific schemas/tables over `db_datareader` when the database contains unrelated sensitive data. Do not grant `VIEW SERVER STATE` unless a documented investigation need justifies it. Keep TLS encryption on and install the SQL Server issuing CA rather than trusting the server certificate.

Verify the health output reports the expected database and updateability. Read-only intent helps routing; the SELECT-only login is the authorization boundary.

## MongoDB / Amazon DocumentDB

Create a database-scoped user with the built-in `read` role:

```javascript
use admin
db.createUser({
  user: "itops_reader",
  pwd: "<generated secret>",
  roles: [{ role: "read", db: "mobileapp" }]
})
```

Do not grant `readWrite`, `dbAdmin`, `clusterManager`, or `root`. For monitoring metadata, add only separately justified read actions.

DocumentDB requires TLS and commonly uses:

```text
tls=true&replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false
```

Set `MONGODB_TLS_CA_FILE` to the AWS/global CA bundle. Never use `tlsAllowInvalidCertificates=true` or `tlsInsecure=true`.

Narrow `MONGODB_COLLECTION_ALLOWLIST`; credential scope remains the primary control.

## Dynatrace

For Environment API v2, create a token with only the scopes used:

- `problems.read`
- `entities.read`
- `metrics.read`
- `logs.read` only if classic log queries are needed

For Grail DQL, create an OAuth client with read scopes only:

- `storage:buckets:read`
- `storage:logs:read`
- `storage:spans:read`
- `storage:events:read`
- `storage:metrics:read`

Use permission conditions to restrict buckets, security context, management zone, entity, or fields where possible. The runtime rejects OAuth scope strings containing write/admin/manage/delete terms.

Set `DYNATRACE_DQL_ENABLED=false` if the environment has only classic APIs.

## Argo CD

Use `role:readonly` or a narrower custom role. A project-scoped example:

```text
p, role:itops-readonly, applications, get, mobile-prod/*, allow
p, role:itops-readonly, projects, get, mobile-prod, allow
```

The harness does not expose pod logs or exec. Do not grant `sync`, `override`, `action/*`, `create`, `update`, `delete`, or `exec`. Bind the token to the read-only role and narrow `ARGOCD_PROJECT_ALLOWLIST` and `ARGOCD_APPLICATION_ALLOWLIST`.

Verify endpoints against the Argo CD server's `/swagger-ui`.

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
