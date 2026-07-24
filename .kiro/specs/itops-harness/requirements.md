# ITOps harness requirements

## Agent architecture

WHEN Kiro CLI v3 loads the workspace  
THE SYSTEM SHALL expose one ITOps orchestrator and six specialist agents for Splunk, SQL Server, MongoDB/DocumentDB, Dynatrace, Argo CD, and Bitbucket/GitLab source code.

WHEN the orchestrator investigates an incident
THE SYSTEM SHALL delegate observability and deployment checks before targeted database checks.

WHEN the operator starts ITOps
THE SYSTEM SHALL expose the orchestrator as the sole conversational front door and restrict internal delegation to the six named custom specialists.

WHEN the operator asks a routine question, explanation, lookup, status question, or targeted diagnostic question
THE SYSTEM SHALL answer directly in chat and SHALL NOT create a report file.

WHEN tools or specialist subagents are needed for a targeted answer
THE SYSTEM SHALL use the minimum relevant evidence sources and SHALL NOT promote the request to report mode solely because delegation occurred.

WHEN the operator explicitly requests a report, full/end-to-end investigation, formal RCA, postmortem, or comprehensive multi-system incident analysis
THE SYSTEM SHALL run the full investigation workflow and create the Hebrew Markdown report by default.

WHEN a private wiki is present
THE SYSTEM SHALL index it selectively, search maintained synthesis before immutable sources, keep it read-only, and prevent its contents from entering Git.

WHEN source-code analysis is justified
THE SYSTEM SHALL require an allowlisted repository/project and exact deployed revision before targeted commit, diff, review, file, or CI reads.

WHEN a specialist is spawned  
THE SYSTEM SHALL expose only that specialist's read-only MCP server and workspace reading capabilities.

WHEN the pack is installed or updated on a Windows PC
THE SYSTEM SHALL validate the checked-in Kiro v3 agent permission rules for exact ITOps subagent and MCP tool names; external tools SHALL remain reads, output tools SHALL remain constrained local report/XML writes, and the installer SHALL NOT modify Kiro settings, sessions, or trust files.

WHEN Splunk Kerberos, SQL Server Windows authentication, or Argo CD CLI SSO is selected
THE SYSTEM SHALL reuse the current Windows identity or vendor-supported cached SSO session without storing a Microsoft or Windows password.

WHEN Dynatrace is enabled
THE SYSTEM SHALL use Kiro-managed browser OAuth against the official remote Dynatrace MCP with a confidential client and read-only scopes; Microsoft browser login alone SHALL NOT be treated as an API credential.

## Read-only safety

WHEN any external tool is called  
THE SYSTEM SHALL enforce least privilege in credentials, MCP implementation, Kiro permissions, and a pre-tool hook.

WHEN a query attempts a mutation, side effect, unbounded result, disabled integration, unsafe URL, or disallowed scope  
THE SYSTEM SHALL reject it before external execution.

WHEN SQL Server is enabled
THE SYSTEM SHALL support bounded named connection profiles, require explicit selection when several exist, request `ApplicationIntent=ReadOnly` for each, and refuse a profile's investigation access unless its connected database is proven to be the exact configured readable Availability Group secondary before use and within every query batch.

WHEN multiple MongoDB or DocumentDB URIs are configured
THE SYSTEM SHALL expose only their safe profile names, discover only non-system databases visible to each read-only identity using `authorizedDatabases=true`, apply per-profile database/collection allowlists, and require explicit connection/database selection when ambiguous.

WHEN a source request targets a disallowed repository, unsafe ref, secret-bearing path, binary file, oversized response, or cross-origin link
THE SYSTEM SHALL reject it before returning repository content.

WHEN reports, XML proposals, or audit records are created  
THE SYSTEM SHALL write only to their dedicated local directories.

## Evidence and reporting

WHEN evidence is returned  
THE SYSTEM SHALL redact configured secret fields and bound output bytes.

WHEN a final report is requested  
THE SYSTEM SHALL produce structured Hebrew Markdown by default and RTL HTML only on request.

WHEN root cause is not proven  
THE SYSTEM SHALL label it probable or unresolved and preserve contradictory evidence.

## Operations

WHEN installed on Windows  
THE SYSTEM SHALL provide PowerShell install, environment import, validation, connection test, and v3 start commands.

WHEN configuration is incomplete or insecure  
THE SYSTEM SHALL fail validation with actionable errors.

WHEN an MCP tool accepts rich nested data
THE SYSTEM SHALL keep its public function-declaration schema within supported model-provider depth limits and validate the rich representation inside the MCP server.
