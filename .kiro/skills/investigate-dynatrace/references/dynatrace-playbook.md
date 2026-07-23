# Dynatrace investigation patterns

## Evidence order

1. Data Analysis Agent question for problems and impact
2. Entity topology and health
3. Request/error/latency metrics against baseline
4. Deployment, restart, and Kubernetes events
5. Targeted DQL for logs, spans, or events

## Example DQL

```dql
fetch logs
| filter dt.system.environment == "<environment>"
| filter service.name == "<service>"
| filter timestamp >= toTimestamp("<from UTC>") and timestamp < toTimestamp("<to UTC>")
| summarize count = count(), by:{status}
| sort count desc
| limit 100
```

The confidential OAuth client needs the remote-MCP gateway read/invoke scopes, `ai:operator:execute`, and only the required Grail reads such as `storage:buckets:read`, `storage:logs:read`, `storage:spans:read`, `storage:events:read`, `storage:metrics:read`, and `storage:entities:read`. The signed-in user's permissions further restrict the result.

Use the official remote MCP only. Do not construct direct Environment API calls, scrape a Microsoft/Dynatrace browser session, or ask the orchestrator for an ad hoc API token.

Missing telemetry can mean instrumentation loss. Compare request volume and data freshness before calling a service healthy.
