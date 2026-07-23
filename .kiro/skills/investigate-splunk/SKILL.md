---
name: investigate-splunk
description: Investigate production incidents in Splunk with bounded read-only SPL, baseline comparisons, event sampling, correlation identifiers, negative-evidence checks, and offline Simple XML dashboard generation. Use for mobile/backend logs, errors, traffic changes, latency symptoms, request tracing, cohorts, and dashboard XML proposals.
---

# Investigate with Splunk

Read [splunk-playbook.md](references/splunk-playbook.md) when choosing SPL patterns or dashboard panels.

## Work from broad signals to narrow evidence

1. Confirm UTC incident and baseline windows.
2. Find the narrowest authorized index, sourcetype, service, environment, platform, app version, and region.
3. Establish volume and error-rate changes with `stats` or `timechart`.
4. Split by useful dimensions before inspecting raw events.
5. Trace representative failures using correlation, request, or trace IDs.
6. Search explicitly for expected healthy/control events and record negative evidence.
7. Expand time or scope only with a stated reason.

Use `splunk_search`. Keep `maxResults` small for raw events. Prefer aggregated queries that return counts and rates. Mask or omit tokens, credentials, user identifiers, payload bodies, and device identifiers unless explicitly necessary and authorized.

Kerberos mode uses the current Windows identity through SSPI/SPNEGO; it does not change Splunk authorization. Treat `401` as a ticket/SPN/Negotiate gap and `403` as an RBAC gap. Return the gap to the orchestrator instead of requesting a password, wider role, or alternate endpoint.

## Read-only SPL boundary

Never use `collect`, `delete`, `dump`, `into`, `map`, `outputcsv`, `outputlookup`, `run`, `script`, `sendemail`, or any custom command with side effects. Do not call REST endpoints that save searches or dashboards.

## Dashboard XML

Use `splunk_generate_dashboard_xml` only after useful panels are proven by searches. Its `panelsJson` argument is a JSON string containing an array of 3–8 panel objects; do not pass a nested array directly. Each object has `title`, `search`, optional `earliest`/`latest`, `visualization` (`table`, `chart`, `single`, or `event`), and optional `chartType` for charts. Generate panels that cover:

- traffic and error rate over time
- top error signatures
- affected app versions/platforms/regions
- latency or duration percentiles when present
- representative events or correlation IDs

Generated Simple XML is an offline proposal. Return it to the orchestrator, which may save it locally through the core artifact writer. Never upload it.

## Return the evidence package

Return:

- UTC incident and baseline intervals
- exact SPL for every conclusion
- result counts and truncation status
- quantitative delta and affected dimensions
- 1–5 redacted representative events when useful
- negative evidence and alternative explanations
- confidence and limitations
- suggested evidence IDs using `SPL-NNN`
