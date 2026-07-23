# SQL Server investigation patterns

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
- Read-only routing is a connection intent, not a substitute for a `SELECT`-only login.
- Ask the database team for replica lag evidence if absence is material.
