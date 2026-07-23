# Investigation policy

Use two evidence waves:

1. Splunk, Dynatrace, and Argo CD in parallel, plus Jira/Confluence/wiki context.
2. SQL Server, MongoDB/DocumentDB, and Bitbucket/GitLab source only for targeted questions derived from wave 1. Source inspection also requires the exact deployed revision and repository mapping.

Do not run broad database or repository exploration as a default incident step.

Normalize timestamps to UTC during correlation. Preserve original source timezone when material. Consider clock skew, telemetry ingestion delay, sampling, retention, replica lag, and cache freshness before interpreting absence.

Root-cause labels:

- `מאומת` — definitive direct evidence or at least two independent aligned sources
- `סביר` — strong evidence with one material gap
- `לא הוכרע` — incomplete, contradictory, or primarily temporal evidence
