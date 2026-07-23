# Authentication on the Windows operator workstation

The harness uses the single ignored `config\itops.env` file to select authentication modes and endpoints. It never stores a Microsoft password. Interactive Microsoft sign-in is delegated to the vendor-supported Argo CD CLI or Kiro's OAuth client.

## Authentication matrix

| System | Default mode | Operator supplies | Runtime identity |
|---|---|---|---|
| Jira / Confluence | API token | base URL, email, API token | Atlassian read-only account |
| Bitbucket Cloud | access/API token | token, optional email, repository allowlist | repository/workspace read identity |
| GitLab | project/group token | token and project allowlist | `read_api` / `read_repository` identity |
| Splunk | Windows Kerberos | Negotiate-enabled HTTPS host and port | currently logged-in Windows user |
| SQL Server | Windows integrated per named connection | AG listeners and exact database names | currently logged-in Windows user or a profile-specific read-only SQL login |
| MongoDB / DocumentDB | credential per named URI | TLS URIs and database/collection allowlists | `read` user across the authorized application databases |
| Argo CD | CLI SSO | server, context and allowlists | Microsoft/Entra user mapped through Argo CD RBAC |
| Dynatrace | Kiro OAuth | MCP URL and confidential OAuth client | Microsoft/Entra user intersected with OAuth scopes |

## First interactive sign-in

After filling `config\itops.env`, run:

```powershell
.\scripts\Initialize-ItOpsAuth.ps1
```

For Argo CD, the script first asks the CLI for `argocd account session-token`. Current Argo CD CLIs refresh an expired SSO access token from the cached refresh token. If no valid session exists, the script runs `argocd login ... --sso` and opens Microsoft login in the browser. The token is captured only in process memory and is never printed or copied to the environment file.

Dynatrace OAuth begins when Kiro starts the Dynatrace specialist for the first time. Kiro opens the configured loopback callback, launches the browser, and stores its OAuth session in Kiro's credential storage. Use `/mcp auth` to force authentication and `/mcp logout` to remove it.

`Start-ItOps.ps1` calls the authentication initializer automatically, so normally the separate command is needed only during setup or troubleshooting.

## Splunk Kerberos requirements

`SPLUNK_AUTH_MODE=kerberos` calls `curl.exe` as a fixed child process without a shell. The harness requires the Windows build to advertise both SSPI and SPNEGO and passes `--negotiate --user :`, which uses the current Windows logon ticket. No domain password is accepted or stored.

Set `SPLUNK_BASE_URL` to the HTTPS host and `SPLUNK_PORT` to the approved listener port. The usual direct Splunk management port is `8089`; an enterprise Kerberos reverse proxy may instead expose `443` or another port. The harness validates the range and rejects a conflict between a port embedded in the URL and `SPLUNK_PORT`.

The configured HTTPS endpoint must advertise HTTP `Negotiate`. Direct Splunk management REST endpoints commonly use Splunk tokens instead; in that topology, an enterprise reverse proxy must terminate Kerberos and forward an authenticated, authorized identity to Splunk. If the endpoint does not support Negotiate, use a dedicated read-only token with `SPLUNK_AUTH_MODE=token`.

Kerberos does not create authorization. The mapped Splunk role must still have only the indexes and search capabilities required by ITOps.

## SQL Server Windows authentication and replica proof

Set:

```text
SQLSERVER_CONNECTIONS=mobile,orders
SQLSERVER_ODBC_DRIVER=ODBC Driver 18 for SQL Server
SQLSERVER_MOBILE_AUTH_MODE=windows
SQLSERVER_MOBILE_HOST=your-mobile-ag-listener
SQLSERVER_MOBILE_DATABASE=MobileApp
SQLSERVER_ORDERS_AUTH_MODE=windows
SQLSERVER_ORDERS_HOST=your-orders-ag-listener
SQLSERVER_ORDERS_DATABASE=Orders
```

Connection names use lowercase letters, digits, and underscores. Each name creates an isolated pool, exact-database proof, and safe selector visible to the SQL specialist. The Windows process identity is used through `msnodesqlv8` and Microsoft ODBC Driver 18. Every generated connection string fixes:

- `Trusted_Connection=Yes`
- `Encrypt=Yes`
- `TrustServerCertificate=No`
- `ApplicationIntent=ReadOnly`
- `MultiSubnetFailover=Yes` by default

Replica state cannot be known before a network connection exists. The harness therefore connects each selected profile with read-only intent and runs only its replica-proof query first. It requires all of the following:

- the requested database name is the connected database
- Always On HADR is enabled
- `sys.fn_hadr_is_primary_replica(DB_NAME())` returns `0`
- `sys.databases.is_read_only` is `1`
- `DATABASEPROPERTYEX(..., 'Updateability')` is `READ_ONLY`

If any value is absent, unknown, primary, writable, or belongs to another database, only that profile's pool is closed. The same guard runs in the exact SQL batch before every investigation query, protecting each named connection against routing or failover changes after startup. When more than one profile exists, omission of the connection selector fails closed.

The Windows identity—or each profile-specific SQL login—needs `CONNECT` and narrowly scoped `SELECT` access plus `VIEW SERVER STATE` so the role can be proven. It does not need DML, DDL, `EXECUTE`, `ALTER`, or `CONTROL`.

## MongoDB and DocumentDB named URI authentication

Set `MONGODB_CONNECTIONS` to lowercase profile names and provide `MONGODB_<NAME>_URI`, mode, TLS CA, read preference, database allowlist, and collection allowlist for each. The agent sees only the profile name; the URI and its embedded credential remain inaccessible in `config\itops.env`.

Database discovery uses `listDatabases` with `authorizedDatabases=true`. It returns only databases visible to that URI's identity, applies `MONGODB_<NAME>_DATABASE_ALLOWLIST`, and always removes `admin`, `config`, and `local`. Grant `read` separately on every application database the profile should expose. When several profiles or databases exist, omission of either selector fails closed.

## Argo CD Microsoft SSO

Install a current Argo CD CLI that supports `account session-token` and configure:

```text
ARGOCD_AUTH_MODE=cli-sso
ARGOCD_BASE_URL=https://argocd.example.com
ARGOCD_CLI_SERVER=argocd.example.com
ARGOCD_CLI_CONTEXT=itops-readonly
```

The context server must match `ARGOCD_BASE_URL`. The MCP asks the CLI for a session token; when necessary, the CLI refreshes the cached SSO access token before returning it. The MCP uses that token only with the fixed HTTPS API origin and never invokes an Argo CD mutation command.

Microsoft group membership must map to Argo CD `get` permissions only. Do not map the user to sync, update, delete, exec, action, override, or administrative rights.

## Dynatrace Microsoft sign-in

Dynatrace's **Sign in with Microsoft** feature creates a browser session; that cookie is not a supported API credential. Programmatic API and MCP access still needs an access token or OAuth client.

For this harness, a Dynatrace administrator must create a **confidential OAuth client** with the **Authorization Code** grant, the exact redirect URI from `DYNATRACE_OAUTH_REDIRECT_URI`, and only the read scopes listed in `.kiro/agents/itops-dynatrace.md`. Put its client ID and secret in the ignored environment file.

Kiro then performs Authorization Code + PKCE in the browser. Dynatrace can federate that login to Microsoft Entra ID. Effective access is the intersection of:

1. the scopes granted to the OAuth client;
2. the permissions of the signed-in Dynatrace user; and
3. the read-only tools exposed by the official Dynatrace MCP server.

If no administrator can create that OAuth client, Microsoft browser login alone cannot make the Dynatrace API available to this harness. Browser-cookie scraping is intentionally unsupported.
