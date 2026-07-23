---
name: investigate-sql-server
description: Investigate incidents across named SQL Server Availability Group read-only replica connections with explicit target selection, schema discovery, bounded parameterized SELECT/CTE queries, consistency checks, replica-lag caveats, and evidence summaries. Use for relational state, transaction status, aggregates, missing/duplicate records, and time-correlated database evidence.
---

# Investigate SQL Server safely

Read [sql-playbook.md](references/sql-playbook.md) before querying an unfamiliar schema.

## Form a targeted data question

Require a precise question, UTC interval, and identifiers from the orchestrator. Call `sql_list_connections` when the connection is not already established by evidence. If several connections exist, select one explicitly in every subsequent call; never infer it from a similar database name. Do not explore every connection or the entire database. Use `sql_list_schema` only to locate necessary tables and columns.

## Query safely

The MCP maintains a separate pool and proof for each named target. It connects with `ApplicationIntent=ReadOnly` and fails closed unless SQL Server proves that target's exact database is a read-only Availability Group secondary. It repeats that proof inside every investigation batch. Never bypass a replica-proof failure, switch connection names silently, or substitute a primary/default database.

Use `sql_query` with:

- one `SELECT` or `WITH` statement
- bound parameters for all values
- explicit column lists
- selective predicates on indexed identifiers and time
- deterministic ordering
- aggregates before representative rows
- a small `maxRows`

Never use DML, DDL, procedures, dynamic SQL, `SELECT INTO`, cross-database names, locking hints, `WAITFOR`, or administrative functions. Do not request sensitive columns when counts or status fields answer the question.

## Interpret replica evidence

The client requests read-only routing, proves the connected role, and the credential must still have only `SELECT` plus the minimum server-state visibility needed for that proof. Account for:

- availability-group routing mistakes
- replica lag or suspended data movement
- clock/timezone conversion
- transaction visibility
- retention or archival
- status transitions after the incident window

Absence on a replica is not proof of absence at the primary.

## Return the evidence package

Return:

- named connection, database, and observation time
- verified replica server, role, and proof time when available
- exact parameterized SQL
- parameter names, with sensitive values redacted
- row count and truncation status
- aggregate and representative results
- replica/freshness caveat
- negative evidence and alternative explanations
- confidence and suggested evidence IDs using `SQL-NNN`
