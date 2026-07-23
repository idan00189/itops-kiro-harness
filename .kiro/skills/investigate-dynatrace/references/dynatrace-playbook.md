# Dynatrace investigation patterns

## Evidence order

1. Problems and impact analysis
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

For Grail, request only the read permissions needed for allowed tables, such as `storage:buckets:read`, `storage:logs:read`, `storage:spans:read`, `storage:events:read`, and `storage:metrics:read`. For Environment API v2, use only `problems.read`, `entities.read`, `metrics.read`, and `logs.read` as needed.

Missing telemetry can mean instrumentation loss. Compare request volume and data freshness before calling a service healthy.
