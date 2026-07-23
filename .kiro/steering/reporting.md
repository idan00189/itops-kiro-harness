# Hebrew reporting policy

The default deliverable is a Hebrew Markdown incident report. HTML is optional and must use `lang="he"` and `dir="rtl"`.

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
