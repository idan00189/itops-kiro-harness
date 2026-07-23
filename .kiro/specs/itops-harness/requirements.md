# ITOps harness requirements

## Agent architecture

WHEN Kiro CLI v3 loads the workspace  
THE SYSTEM SHALL expose one ITOps orchestrator and six specialist agents for Splunk, SQL Server, MongoDB/DocumentDB, Dynatrace, Argo CD, and Bitbucket/GitLab source code.

WHEN the orchestrator investigates an incident  
THE SYSTEM SHALL delegate observability and deployment checks before targeted database checks.

WHEN source-code analysis is justified
THE SYSTEM SHALL require an allowlisted repository/project and exact deployed revision before targeted commit, diff, review, file, or CI reads.

WHEN a specialist is spawned  
THE SYSTEM SHALL expose only that specialist's read-only MCP server and workspace reading capabilities.

## Read-only safety

WHEN any external tool is called  
THE SYSTEM SHALL enforce least privilege in credentials, MCP implementation, Kiro permissions, and a pre-tool hook.

WHEN a query attempts a mutation, side effect, unbounded result, disabled integration, unsafe URL, or disallowed scope  
THE SYSTEM SHALL reject it before external execution.

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
