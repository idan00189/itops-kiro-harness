# Evidence and confidence

## Source independence

Splunk and Dynatrace logs may originate from the same telemetry stream and are not always independent. Argo CD operation state, database state, mobile analytics, and Jira change records may provide independent evidence.

## Confidence calibration

- 90–100: direct evidence, precise timestamps, strong controls, no material contradiction
- 70–89: multiple aligned signals with a limited gap
- 40–69: plausible and partially supported; material alternatives remain
- 1–39: weak, incomplete, or mainly temporal
- 0: disproved or no supporting evidence

## Negative evidence checklist

Before concluding:

- search the healthy control path
- compare unaffected versions, platforms, regions, or tenants
- verify telemetry coverage and retention
- check source clocks and ingestion delay
- check replica/read-preference lag
- test at least one alternative hypothesis

Do not convert "not found" into "did not occur" without these checks.
