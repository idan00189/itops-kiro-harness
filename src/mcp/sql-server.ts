import sql from "mssql";
import { z } from "zod";
import { assertReadOnlySql } from "../common/guards.js";
import { enabled, env, envBoolean, envInteger } from "../common/env.js";
import { createServer, readOnlyAnnotations, runTool, startServer } from "../common/mcp.js";

const SERVER = "itops-sql-server";
const server = createServer(
  SERVER,
  "Read-only SQL Server replica access. Only one SELECT/CTE statement is accepted, parameters are bound, row count and timeout are bounded, and the connection requests Availability Group read-only intent.",
);

let poolPromise: Promise<sql.ConnectionPool> | undefined;

function assertEnabled(): void {
  if (!enabled("SQLSERVER")) throw new Error("SQL Server integration is disabled");
}

function getPool(): Promise<sql.ConnectionPool> {
  assertEnabled();
  const pool = poolPromise ??= new sql.ConnectionPool({
    server: env("SQLSERVER_HOST", { required: true }),
    port: envInteger("SQLSERVER_PORT", 1433, 1, 65_535),
    database: env("SQLSERVER_DATABASE", { required: true }),
    user: env("SQLSERVER_USERNAME", { required: true }),
    password: env("SQLSERVER_PASSWORD", { required: true }),
    connectionTimeout: envInteger("SQLSERVER_CONNECT_TIMEOUT_MS", 15_000, 1_000, 120_000),
    requestTimeout: envInteger("SQLSERVER_QUERY_TIMEOUT_MS", 30_000, 1_000, 300_000),
    pool: {
      min: 0,
      max: envInteger("SQLSERVER_POOL_MAX", 4, 1, 20),
      idleTimeoutMillis: 30_000,
    },
    options: {
      appName: "itops-readonly",
      encrypt: envBoolean("SQLSERVER_ENCRYPT", true),
      trustServerCertificate: envBoolean("SQLSERVER_TRUST_SERVER_CERTIFICATE", false),
      readOnlyIntent: true,
      enableArithAbort: true,
      useUTC: true,
      fallbackToDefaultDb: false,
    },
  }).connect();
  return pool;
}

type Scalar = string | number | boolean | null;

function bindParameters(request: sql.Request, parameters: Record<string, Scalar>): void {
  for (const [name, value] of Object.entries(parameters)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) || name.startsWith("__itops")) {
      throw new Error(`Invalid SQL parameter name: ${name}`);
    }
    request.input(name, value);
  }
}

async function executeBounded(
  query: string,
  parameters: Record<string, Scalar>,
  requestedRows: number,
): Promise<{ rows: unknown[]; rowCount: number; truncated: boolean }> {
  const safeQuery = assertReadOnlySql(query);
  const maxRows = Math.min(
    requestedRows,
    envInteger("SQLSERVER_MAX_ROWS", 500, 1, 10_000),
  );
  const pool = await getPool();
  const request = pool.request();
  bindParameters(request, parameters);
  const result = await request.query(
    `SET ROWCOUNT ${maxRows};\n${safeQuery};\nSET ROWCOUNT 0;`,
  );
  const rows = (result.recordset ?? []).slice(0, maxRows) as unknown[];
  return { rows, rowCount: rows.length, truncated: rows.length >= maxRows };
}

server.registerTool(
  "sql_query",
  {
    title: "Query SQL Server replica (read-only)",
    description:
      "Execute one bounded parameterized SELECT or CTE query. DML, DDL, procedures, SELECT INTO, and cross-database identifiers are rejected.",
    inputSchema: z.object({
      query: z.string().min(1).max(20_000),
      parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
      maxRows: z.number().int().min(1).max(10_000).default(500),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "sql_query", { query: input.query, parameterNames: Object.keys(input.parameters) }, () =>
      executeBounded(input.query, input.parameters, input.maxRows),
    ),
);

server.registerTool(
  "sql_list_schema",
  {
    title: "Inspect SQL Server schema (read-only)",
    description: "List visible tables, columns, and data types from INFORMATION_SCHEMA.",
    inputSchema: z.object({
      schema: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/).optional(),
      maxRows: z.number().int().min(1).max(2_000).default(500),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "sql_list_schema", input, () => {
      const filter = input.schema ? "WHERE c.TABLE_SCHEMA = @schema" : "";
      return executeBounded(
        `SELECT c.TABLE_SCHEMA, c.TABLE_NAME, c.COLUMN_NAME, c.DATA_TYPE,
                c.IS_NULLABLE, c.ORDINAL_POSITION
         FROM INFORMATION_SCHEMA.COLUMNS AS c
         ${filter}
         ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION`,
        input.schema ? { schema: input.schema } : {},
        input.maxRows,
      );
    }),
);

server.registerTool(
  "sql_health",
  {
    title: "Check SQL Server replica",
    description:
      "Verify the SQL connection, database identity, encryption intent, and database updateability using a read-only query.",
    inputSchema: z.object({}),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "sql_health", input, async () => {
      if (!enabled("SQLSERVER")) return { status: "disabled", integration: "sqlserver" };
      const result = await executeBounded(
        `SELECT DB_NAME() AS database_name,
                CONVERT(nvarchar(128), SERVERPROPERTY('ServerName')) AS server_name,
                CONVERT(nvarchar(128), SERVERPROPERTY('ProductVersion')) AS product_version,
                CONVERT(nvarchar(60), DATABASEPROPERTYEX(DB_NAME(), 'Updateability')) AS updateability`,
        {},
        5,
      );
      return { status: "ok", ...result };
    }),
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void poolPromise?.then((pool) => pool.close()).finally(() => process.exit(0));
  });
}

await startServer(server);
