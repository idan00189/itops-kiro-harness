---
name: investigate-mongodb-docdb
description: Investigate incidents across named MongoDB or Amazon DocumentDB URI connections with authorized-database discovery, explicit target selection, bounded read-only find and aggregation operations, database/collection allowlists, secondary-read caveats, and safe schema sampling. Use for document state, event records, session/order state, missing/duplicate documents, TTL behavior, and time-correlated evidence.
---

# Investigate MongoDB or DocumentDB safely

Read [mongodb-docdb-playbook.md](references/mongodb-docdb-playbook.md) before using aggregation stages or interpreting missing data.

## Narrow the question

Require a connection, database, collection, UTC window, and targeted identifier or status question. Call `mongodb_list_connections`, then `mongodb_list_databases` when runtime evidence has not already established the target. Database discovery returns only non-system databases visible to the URI identity and allowed by configuration. Include both target values explicitly when there is more than one choice. Never fan out across all URIs or databases without a concrete incident reason.

Use `mongodb_list_collections` and `mongodb_sample_schema` only when the shape is unknown and the database and collection are allowlisted.

## Query safely

Use `mongodb_find` for targeted retrieval:

- selective filter
- projection containing only needed fields
- stable sort
- small limit

Use `mongodb_aggregate` for counts, grouping, and state distribution. Only read-only allowlisted stages are available. Never attempt `$out`, `$merge`, `$where`, `$function`, `$accumulator`, map-reduce, eval, change-stream modification, or a write command.

Avoid returning payload bodies, tokens, email, phone, address, or device identifiers when a count, hash, or status is sufficient.

## Interpret results

Account for:

- `secondaryPreferred` staleness or primary fallback
- TTL deletion and retention
- eventual consistency and asynchronous writers
- schema/version differences
- DocumentDB operator compatibility
- ObjectId and timestamp timezone semantics

Do not treat an empty result as definitive without coverage and freshness evidence.

## Return the evidence package

Return:

- connection, database, collection, and observation time
- exact redacted filter/projection or aggregation pipeline
- result count and truncation
- aggregates and minimal representative documents
- negative evidence, lag/TTL caveats, and alternatives
- confidence and suggested evidence IDs using `MDB-NNN`
