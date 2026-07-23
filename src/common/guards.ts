import { assertNoControlCharacters } from "./env.js";

function stripSqlLiteralsAndComments(sql: string): string {
  let output = "";
  let index = 0;
  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];
    if (char === "'" || char === '"' || char === "[") {
      const close = char === "[" ? "]" : char;
      output += " ";
      index += 1;
      while (index < sql.length) {
        if (sql[index] === close) {
          if (sql[index + 1] === close && close !== "]") {
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }
    if (char === "-" && next === "-") {
      while (index < sql.length && sql[index] !== "\n") index += 1;
      output += "\n";
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index < sql.length && !(sql[index] === "*" && sql[index + 1] === "/")) index += 1;
      index += 2;
      output += " ";
      continue;
    }
    output += char;
    index += 1;
  }
  return output;
}

const SQL_DENY = [
  "alter",
  "backup",
  "bulk",
  "create",
  "dbcc",
  "delete",
  "deny",
  "drop",
  "execute",
  "exec",
  "grant",
  "insert",
  "kill",
  "merge",
  "openquery",
  "opendatasource",
  "openrowset",
  "reconfigure",
  "restore",
  "revoke",
  "shutdown",
  "truncate",
  "update",
  "use",
  "waitfor",
];

export function assertReadOnlySql(query: string, maxLength = 20_000): string {
  assertNoControlCharacters(query, "SQL query");
  if (!query.trim() || query.length > maxLength) throw new Error("SQL query is empty or too long");
  const stripped = stripSqlLiteralsAndComments(query).trim().toLowerCase();
  const semicolons = [...stripped.matchAll(/;/g)].map((match) => match.index ?? -1);
  if (semicolons.length > 1 || (semicolons.length === 1 && !/;\s*$/.test(stripped))) {
    throw new Error("Only one SQL statement is allowed");
  }
  const normalized = stripped.replace(/;\s*$/, "").trim();
  if (!/^(select|with)\b/.test(normalized)) {
    throw new Error("SQL must start with SELECT or WITH");
  }
  for (const keyword of SQL_DENY) {
    if (new RegExp(`\\b${keyword}\\b`, "i").test(normalized)) {
      throw new Error(`SQL keyword ${keyword.toUpperCase()} is blocked`);
    }
  }
  if (/\binto\b/i.test(normalized) || /\b(?:xp|sp)_[a-z0-9_]+\b/i.test(normalized)) {
    throw new Error("SELECT INTO and stored procedure calls are blocked");
  }
  if (/\bnext\s+value\s+for\b/i.test(normalized)) {
    throw new Error("SQL sequence advancement is blocked");
  }
  if (/\b(?:holdlock|tablockx|updlock|xlock)\b/i.test(normalized)) {
    throw new Error("SQL update or exclusive locking hints are blocked");
  }
  if (/\b[a-z0-9_]+\s*\.\s*[a-z0-9_]+\s*\.\s*[a-z0-9_]+\b/i.test(normalized)) {
    throw new Error("Cross-database three-part identifiers are blocked");
  }
  return query.trim().replace(/;\s*$/, "");
}

const SPLUNK_MUTATING_COMMANDS = [
  "collect",
  "createrss",
  "delete",
  "dump",
  "into",
  "map",
  "mcollect",
  "meventcollect",
  "outputcsv",
  "outputlookup",
  "run",
  "runshellscript",
  "script",
  "sendalert",
  "sendemail",
  "sendresults",
  "tscollect",
];

const SPLUNK_OPAQUE_COMMANDS = [
  "dbxquery",
  "loadjob",
  "rest",
  "savedsearch",
];

export function assertReadOnlySpl(search: string, maxLength = 20_000): string {
  assertNoControlCharacters(search, "SPL query");
  const normalized = search.trim();
  if (!normalized || normalized.length > maxLength) throw new Error("SPL query is empty or too long");
  if (/`[^`]+`/.test(normalized)) {
    throw new Error("SPL macros are blocked because their expanded commands cannot be inspected");
  }
  for (const command of SPLUNK_MUTATING_COMMANDS) {
    if (new RegExp(`\\|\\s*${command}\\b`, "i").test(normalized)) {
      throw new Error(`SPL command ${command} is blocked by read-only policy`);
    }
  }
  for (const command of SPLUNK_OPAQUE_COMMANDS) {
    if (new RegExp(`(?:^|\\|)\\s*${command}\\b`, "i").test(normalized)) {
      throw new Error(`SPL command ${command} is blocked because its effective scope is opaque`);
    }
  }
  return normalized.replace(/^search\s+/i, "");
}

export function assertSafeDql(query: string, maxLength = 20_000): string {
  assertNoControlCharacters(query, "DQL query");
  const normalized = query.trim();
  if (!normalized || normalized.length > maxLength) throw new Error("DQL query is empty or too long");
  if (/;\s*\S/.test(normalized)) throw new Error("Multiple DQL statements are not allowed");
  return normalized;
}

const MONGO_BLOCKED_KEYS = new Set([
  "$accumulator",
  "$eval",
  "$function",
  "$merge",
  "$out",
  "$where",
]);

export function assertSafeMongoValue(value: unknown, depth = 0): void {
  if (depth > 30) throw new Error("MongoDB query nesting is too deep");
  if (Array.isArray(value)) {
    for (const item of value) assertSafeMongoValue(item, depth + 1);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (MONGO_BLOCKED_KEYS.has(key.toLowerCase())) {
        throw new Error(`MongoDB operator ${key} is blocked`);
      }
      assertSafeMongoValue(nested, depth + 1);
    }
  }
}

const READ_ONLY_STAGES = new Set([
  "$addFields",
  "$bucket",
  "$bucketAuto",
  "$collStats",
  "$count",
  "$densify",
  "$documents",
  "$facet",
  "$fill",
  "$geoNear",
  "$group",
  "$indexStats",
  "$limit",
  "$lookup",
  "$match",
  "$project",
  "$redact",
  "$replaceRoot",
  "$replaceWith",
  "$sample",
  "$set",
  "$setWindowFields",
  "$skip",
  "$sort",
  "$sortByCount",
  "$unionWith",
  "$unset",
  "$unwind",
]);

export function assertReadOnlyPipeline(pipeline: unknown[]): void {
  if (pipeline.length === 0 || pipeline.length > 50) {
    throw new Error("Aggregation pipeline must contain 1 to 50 stages");
  }
  for (const stage of pipeline) {
    if (!stage || typeof stage !== "object" || Array.isArray(stage)) {
      throw new Error("Each aggregation stage must be an object");
    }
    const keys = Object.keys(stage);
    if (keys.length !== 1 || !READ_ONLY_STAGES.has(keys[0] ?? "")) {
      throw new Error(`Aggregation stage ${keys[0] ?? "(unknown)"} is not allowlisted`);
    }
    assertSafeMongoValue(stage);
  }
}

export function assertSafeIdentifier(value: string, label: string): string {
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(value) || value.startsWith("system.")) {
    throw new Error(`${label} is invalid or reserved`);
  }
  return value;
}

export function assertMongoCollectionScopes(
  value: unknown,
  collectionPatterns: string[],
  depth = 0,
): void {
  if (depth > 30) throw new Error("MongoDB pipeline nesting is too deep");
  if (Array.isArray(value)) {
    for (const item of value) {
      assertMongoCollectionScopes(item, collectionPatterns, depth + 1);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    let referencedCollection: unknown;
    if (key === "$lookup" && nested && typeof nested === "object" && !Array.isArray(nested)) {
      referencedCollection = (nested as Record<string, unknown>).from;
    }
    if (key === "$unionWith") {
      referencedCollection =
        typeof nested === "string"
          ? nested
          : nested && typeof nested === "object" && !Array.isArray(nested)
            ? (nested as Record<string, unknown>).coll
            : undefined;
    }
    if (typeof referencedCollection === "string") {
      const safe = assertSafeIdentifier(referencedCollection, "MongoDB referenced collection");
      if (!matchesAllowlist(safe, collectionPatterns)) {
        throw new Error(`Collection ${safe} is outside the configured MongoDB collection allowlist`);
      }
    }
    assertMongoCollectionScopes(nested, collectionPatterns, depth + 1);
  }
}

export function matchesAllowlist(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
    return new RegExp(`^${escaped}$`, "i").test(value);
  });
}
