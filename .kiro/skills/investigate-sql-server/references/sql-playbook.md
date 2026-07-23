# SQL Server investigation patterns

## Connection selection

Call `sql_list_connections` before querying when runtime/deployment evidence has not already identified the target. Use the returned profile name as `connection` on `sql_list_schema` and `sql_query`. If multiple profiles exist, omission fails closed. Never fan a query across every connection merely because several are configured.

## Targeted state distribution

```sql
SELECT status, COUNT_BIG(*) AS item_count
FROM dbo.Items
WHERE created_at >= @from_utc
  AND created_at < @to_utc
GROUP BY status
ORDER BY item_count DESC
```

## Representative rows

```sql
SELECT TOP (50) item_id, status, created_at, updated_at, error_code
FROM dbo.Items
WHERE correlation_id = @correlation_id
ORDER BY created_at DESC
```

## Safety and interpretation

- Use half-open time intervals: `>= @from` and `< @to`.
- Avoid `SELECT *`.
- Check data types before comparing timestamps or IDs.
- Use a count before sampling rows.
- Do not use `NOLOCK`; it can produce missing, duplicate, or inconsistent evidence.
- Read-only routing is a connection intent, not proof by itself. For each named connection, the MCP must also observe HADR enabled, `sys.fn_hadr_is_primary_replica(DB_NAME()) = 0`, the exact configured database, and `sys.databases.is_read_only = 1`.
- Windows mode uses the Windows identity running Kiro through ODBC Driver 18; never put a Windows password in the environment file.
- Refuse access when the proof query lacks `VIEW SERVER STATE`, routes to a primary, lands on another database, or changes after failover.
- Replica proof is not a substitute for a `SELECT`-only database identity.
- Ask the database team for replica lag evidence if absence is material.
