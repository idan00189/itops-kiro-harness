# MongoDB and DocumentDB investigation patterns

## Connection and database selection

Use `mongodb_list_connections` to identify the named URI, then `mongodb_list_databases` to discover the non-system databases that identity can read. Pass `connection` and `database` to every collection, schema, find, and aggregation call. The MCP always blocks `admin`, `config`, and `local`, even when a database allowlist contains `*`.

## Targeted find

```json
{
  "filter": {
    "correlationId": "<id>",
    "createdAt": { "$gte": "<from UTC>", "$lt": "<to UTC>" }
  },
  "projection": {
    "_id": 1,
    "status": 1,
    "createdAt": 1,
    "updatedAt": 1,
    "errorCode": 1
  },
  "sort": { "createdAt": -1 },
  "limit": 50
}
```

## State distribution

```json
[
  { "$match": { "createdAt": { "$gte": "<from UTC>", "$lt": "<to UTC>" } } },
  { "$group": { "_id": "$status", "count": { "$sum": 1 } } },
  { "$sort": { "count": -1 } }
]
```

Use the actual BSON type for dates and identifiers. A string timestamp and BSON Date do not compare the same way. DocumentDB supports a MongoDB-compatible subset; treat unsupported-stage errors as compatibility gaps, not empty evidence.

The credential behind each URI must have only the `read` role on every application database it is intended to expose. `authorizedDatabases=true` limits discovery to databases visible to the identity; the configured database allowlist narrows that result further. `readPreference=secondaryPreferred` can return stale data and may fall back to the primary.
