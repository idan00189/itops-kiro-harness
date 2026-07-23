# Splunk investigation patterns

Use field names from the environment; these are patterns, not assumptions.

Before searching in Kerberos mode, confirm the health tool succeeds through the configured HTTPS Negotiate endpoint. A reverse proxy may perform Kerberos authentication before forwarding the authorized identity to Splunk. Never assume a direct Splunk management endpoint supports Kerberos.

## Rate and baseline

```spl
index=<index> service=<service> environment=<env>
| timechart span=5m count AS requests count(eval(status>=500)) AS errors
| eval error_rate=round(100*errors/requests,2)
```

## Error signatures

```spl
index=<index> service=<service> environment=<env> level IN (ERROR,FATAL)
| stats count min(_time) AS first max(_time) AS last by error_code message_template
| sort - count
| head 20
```

## Cohort split

```spl
index=<index> service=<service> environment=<env>
| stats count count(eval(is_error=1)) AS errors by app_version platform region
| eval error_rate=round(100*errors/count,2)
| sort - error_rate
```

Use indexed fields early. Avoid leading wildcards. Use `fields` to reduce returned data. For raw events, return a few representatives after aggregation.

Simple XML uses `<dashboard version="1.1">`, rows, panels, visualization elements, and inline search elements. Prefer proven searches and bounded time ranges.

Pass dashboard panels through the flat `panelsJson` string argument. Example:

```json
[{"title":"Errors over time","search":"index=mobile service=api | timechart count by level","earliest":"-24h@h","latest":"now","visualization":"chart","chartType":"line"}]
```

The MCP server parses and strictly validates this JSON before generating XML. This flat public tool schema stays within model-provider function-declaration depth limits while retaining structured validation inside the server.
