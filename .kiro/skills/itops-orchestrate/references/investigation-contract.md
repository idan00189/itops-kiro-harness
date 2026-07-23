# Incident contract

Use this compact contract for every investigation:

| Field | Required behavior |
|---|---|
| Incident ID | Stable, non-secret identifier |
| Environment | Exact production/staging scope |
| User journey | Login, checkout, feed, push, upload, and so on |
| Symptom | Observable failure, not an assumed cause |
| Incident window | UTC start/end plus source timezone |
| Baseline window | Comparable healthy period |
| Cohort | Platform, app version, region, tenant, feature flag |
| Correlation keys | Request/trace/order/session-safe identifiers |
| Authorization | Systems, projects, indexes, DB, collections allowed |
| Data handling | Fields that must be excluded or redacted |

If start time is uncertain, use a narrow initial window around detection and expand in documented increments. If environment is uncertain, do not query multiple environments silently.

Each delegated request must ask one falsifiable question and request negative evidence.
