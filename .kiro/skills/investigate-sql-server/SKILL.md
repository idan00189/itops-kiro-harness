---
name: investigate-sql-server
description: Investigate incidents using a SQL Server Availability Group read-only replica with schema discovery, bounded parameterized SELECT/CTE queries, consistency checks, replica-lag caveats, and evidence summaries. Use for relational state, transaction status, aggregates, missing/duplicate records, and time-correlated database evidence.
---

# Investigate SQL Server safely

Read [sql-playbook.md](references/sql-playbook.md) before querying an unfamiliar schema.

## Form a targeted data question

Require a precise question, UTC interval, and identifiers from the orchestrator. Do not explore the entire database. Use `sql_list_schema` only to locate necessary tables and columns.

## Query safely

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

The client requests read-only routing, and the credential must have only `SELECT`. Still account for:

- availability-group routing mistakes
- replica lag or suspended data movement
- clock/timezone conversion
- transaction visibility
- retention or archival
- status transitions after the incident window

Absence on a replica is not proof of absence at the primary.

## Return the evidence package

Return:

- database and observation time
- exact parameterized SQL
- parameter names, with sensitive values redacted
- row count and truncation status
- aggregate and representative results
- replica/freshness caveat
- negative evidence and alternative explanations
- confidence and suggested evidence IDs using `SQL-NNN`
