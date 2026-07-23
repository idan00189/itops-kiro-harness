# Technology and integration context

- Kiro CLI v3 unified agent harness
- seven Markdown custom agent profiles
- six local TypeScript MCP servers over stdio plus the official remote Dynatrace MCP
- Node.js 20.19 or newer
- stable Model Context Protocol TypeScript SDK v1
- Splunk REST API through Windows Kerberos/SPNEGO or token authentication, plus Simple XML 1.1 generation
- SQL Server through Windows integrated ODBC or SQL authentication with read-only intent and fail-closed secondary proof
- MongoDB/DocumentDB via the official MongoDB Node.js driver
- official Dynatrace remote MCP with Kiro-managed confidential OAuth
- Argo CD REST API with CLI Microsoft/Entra SSO or token authentication
- Jira and Confluence REST APIs
- Bitbucket Cloud and GitLab REST APIs
- PowerShell entry points for Windows

TLS certificate verification must remain enabled. Use `NODE_EXTRA_CA_CERTS` or vendor-specific CA files for private PKI.
