# Chat and Hebrew reporting policy

The default interaction is a direct answer in Kiro chat, in the operator's language. Routine questions, explanations, wiki/runbook lookups, status questions, and targeted checks do not create files.

Create an incident report only when the operator explicitly requests a report or requests a full/end-to-end investigation, formal RCA, postmortem, or clearly comprehensive multi-system incident analysis. Never create a report merely because one or more specialists were used.

When a report is required, Hebrew Markdown is the default. HTML is optional and must use `lang="he"` and `dir="rtl"`.

Every report includes:

- incident metadata, scope, impact, and executive summary
- UTC timeline
- findings by system with evidence IDs
- hypotheses, confidence, supporting evidence, and contradictory evidence
- root-cause status
- unexecuted recommendations requiring human approval
- evidence ledger with query hashes
- limitations, missing access, retention, sampling, and lag
- sanitized query appendix

Never include credentials. Minimize personal data and payload content. Never state that a recommendation was applied.
