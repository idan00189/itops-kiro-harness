# Technology and integration context

- Kiro CLI v3 unified agent harness
- six Markdown custom agent profiles
- six local TypeScript MCP servers over stdio
- Node.js 20.19 or newer
- stable Model Context Protocol TypeScript SDK v1
- Splunk REST API and Simple XML 1.1 generation
- SQL Server via the Tedious-backed `mssql` driver with read-only intent
- MongoDB/DocumentDB via the official MongoDB Node.js driver
- Dynatrace Environment API v2 and Grail DQL Query API
- Argo CD REST API
- Jira and Confluence REST APIs
- PowerShell entry points for Windows

TLS certificate verification must remain enabled. Use `NODE_EXTRA_CA_CERTS` or vendor-specific CA files for private PKI.
