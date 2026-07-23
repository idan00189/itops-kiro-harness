# MongoDB and DocumentDB investigation patterns

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

The database credential must have only the database-level `read` role. `readPreference=secondaryPreferred` can return stale data and may fall back to the primary.
