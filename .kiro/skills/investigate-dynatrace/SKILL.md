---
name: investigate-dynatrace
description: Investigate production incidents through the official read-only Dynatrace remote MCP and its bounded Data Analysis Agent; correlate mobile/backend health, Davis analysis, errors, latency, saturation, traces, logs, events, metrics, and deployments. Use for Davis problems, SLO degradation, service topology, mobile impact, and observability evidence.
---

# Investigate with Dynatrace

Read [dynatrace-playbook.md](references/dynatrace-playbook.md) before selecting metrics or DQL sources.

## Correlate the incident

1. Use the official remote MCP to query the exact incident and baseline intervals.
2. Resolve affected entities, services, process groups, hosts, Kubernetes workloads, and management zones.
3. Compare request count, error rate, latency percentiles, saturation, and availability against baseline.
4. Ask the Data Analysis Agent for bounded Grail analysis of logs, spans, events, or metrics only when it answers a defined gap.
5. Align deployment/restart/config markers with symptom onset.
6. Search for healthy controls and unaffected cohorts.

Keep every request time-bound and scoped to named entities or services. The official MCP returns at most 1,000 records; reduce the query rather than treating truncation as completeness. Do not retrieve sensitive span/log fields unnecessarily.

## Preserve evidence boundaries

Dynatrace problem root-cause analysis is evidence, not automatic proof. Validate it against metrics, traces/logs, deployment state, or another source. Distinguish:

- symptom entity versus root-cause entity
- application-side versus backend-side latency
- traffic drop versus improved error rate
- missing telemetry versus healthy service
- sampling/retention versus true absence

Never ingest an event, metric, or log. Never change settings, workflows, dashboards, tags, tokens, or alerting. If OAuth, a storage scope, or a user permission is missing, return an evidence gap. Never request a wider client or attempt to reuse browser cookies.

## Return the evidence package

Return:

- UTC windows and management-zone/entity scope
- problem/display IDs
- exact questions, selectors, and DQL surfaced by the MCP
- quantitative baseline deltas
- affected and unaffected cohorts
- deployment/restart alignment
- negative evidence, sampling, retention, and permission gaps
- confidence and suggested evidence IDs using `DT-NNN`
