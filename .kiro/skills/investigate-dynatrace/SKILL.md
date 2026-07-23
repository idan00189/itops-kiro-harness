---
name: investigate-dynatrace
description: Investigate production incidents in Dynatrace using read-only Problems API, entity data, Metrics API, and bounded Grail DQL; correlate mobile/backend health, errors, latency, saturation, traces, logs, and deployments. Use for Davis problems, SLO degradation, service topology, mobile impact, and observability evidence.
---

# Investigate with Dynatrace

Read [dynatrace-playbook.md](references/dynatrace-playbook.md) before selecting metrics or DQL sources.

## Correlate the incident

1. Query problems for the exact incident and baseline intervals.
2. Resolve affected entities, services, process groups, hosts, Kubernetes workloads, and management zones.
3. Compare request count, error rate, latency percentiles, saturation, and availability against baseline.
4. Use Grail DQL for allowlisted logs, spans, events, business events, or metrics only when it answers a defined gap.
5. Align deployment/restart/config markers with symptom onset.
6. Search for healthy controls and unaffected cohorts.

Use bounded records and bytes. Do not retrieve sensitive span/log fields unnecessarily.

## Preserve evidence boundaries

Dynatrace problem root-cause analysis is evidence, not automatic proof. Validate it against metrics, traces/logs, deployment state, or another source. Distinguish:

- symptom entity versus root-cause entity
- application-side versus backend-side latency
- traffic drop versus improved error rate
- missing telemetry versus healthy service
- sampling/retention versus true absence

Never ingest an event, metric, or log. Never change settings, dashboards, tags, tokens, or alerting.

## Return the evidence package

Return:

- UTC windows and management-zone/entity scope
- problem/display IDs
- exact selectors and DQL
- quantitative baseline deltas
- affected and unaffected cohorts
- deployment/restart alignment
- negative evidence, sampling, retention, and permission gaps
- confidence and suggested evidence IDs using `DT-NNN`
