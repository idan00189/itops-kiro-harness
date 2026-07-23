import { createRequire } from "node:module";
import sql from "mssql";
import { z } from "zod";
import { assertReadOnlySql } from "../common/guards.js";
import {
  enabled,
  env,
  envBoolean,
  envChoice,
  envInteger,
} from "../common/env.js";
import { createServer, readOnlyAnnotations, runTool, startServer } from "../common/mcp.js";
import {
  assertReadableSecondary,
  buildWindowsReadOnlyConnectionString,
  type ReplicaProof,
} from "../common/sql-replica.js";

const SERVER = "itops-sql-server";
const server = createServer(
  SERVER,
  "Read-only SQL Server Availability Group secondary access. Windows integrated or SQL authentication is supported. Every connection requests read-only intent and every investigation query fails unless the target is proven to be a readable secondary.",
);

let poolPromise: Promise<sql.ConnectionPool> | undefined;
let replicaProof: ReplicaProof | undefined;
const require = createRequire(import.meta.url);

const REPLICA_PROOF_QUERY = `
SELECT DB_NAME() AS database_name,
       CONVERT(nvarchar(128), SERVERPROPERTY('ServerName')) AS server_name,
       CONVERT(int, SERVERPROPERTY('IsHadrEnabled')) AS is_hadr_enabled,
       CONVERT(int, sys.fn_hadr_is_primary_replica(DB_NAME())) AS is_primary_replica,
       CONVERT(int, d.is_read_only) AS is_read_only,
       CONVERT(nvarchar(60), DATABASEPROPERTYEX(DB_NAME(), 'Updateability')) AS updateability,
       CONVERT(nvarchar(60), DATABASEPROPERTYEX(DB_NAME(), 'Status')) AS database_status
FROM sys.databases AS d
WHERE d.database_id = DB_ID();`;

const PER_QUERY_REPLICA_GUARD = `
IF COALESCE(CONVERT(int, SERVERPROPERTY('IsHadrEnabled')), 0) <> 1
   OR COALESCE(CONVERT(int, sys.fn_hadr_is_primary_replica(DB_NAME())), 1) <> 0
   OR COALESCE((
        SELECT CONVERT(int, d.is_read_only)
        FROM sys.databases AS d
        WHERE d.database_id = DB_ID()
      ), 0) <> 1
BEGIN
  THROW 51000, 'ITOps refused SQL access because this session is not a readable AG secondary', 1;
END;`;

function assertEnabled(): void {
  if (!enabled("SQLSERVER")) throw new Error("SQL Server integration is disabled");
}

function authMode(): "windows" | "sql" {
  return envChoice("SQLSERVER_AUTH_MODE", ["windows", "sql"] as const, "windows");
}

function sqlDriver(): typeof sql {
  if (authMode() === "sql") return sql;
  try {
    return require("mssql/msnodesqlv8") as typeof sql;
  } catch {
    throw new Error(
      "Windows integrated SQL authentication requires the pinned msnodesqlv8 package and Microsoft ODBC Driver 18 for SQL Server",
    );
  }
}

type DriverConfig = sql.config & { connectionString?: string };

function connectionConfig(): DriverConfig {
  const host = env("SQLSERVER_HOST", { required: true });
  const port = envInteger("SQLSERVER_PORT", 1433, 1, 65_535);
  const database = env("SQLSERVER_DATABASE", { required: true });
  if (!envBoolean("SQLSERVER_ENCRYPT", true)) {
    throw new Error("SQLSERVER_ENCRYPT must remain true");
  }
  if (envBoolean("SQLSERVER_TRUST_SERVER_CERTIFICATE", false)) {
    throw new Error(
      "SQLSERVER_TRUST_SERVER_CERTIFICATE must remain false; install the issuing CA instead",
    );
  }
  const common = {
    connectionTimeout: envInteger(
      "SQLSERVER_CONNECT_TIMEOUT_MS",
      15_000,
      1_000,
      120_000,
    ),
    requestTimeout: envInteger(
      "SQLSERVER_QUERY_TIMEOUT_MS",
      30_000,
      1_000,
      300_000,
    ),
    pool: {
      min: 0,
      max: envInteger("SQLSERVER_POOL_MAX", 4, 1, 20),
      idleTimeoutMillis: 30_000,
    },
  };
  if (authMode() === "windows") {
    if (process.platform !== "win32") {
      throw new Error("SQLSERVER_AUTH_MODE=windows requires the harness to run on Windows");
    }
    return {
      ...common,
      server: host,
      database,
      connectionString: buildWindowsReadOnlyConnectionString({
        host,
        port,
        database,
        driver: env("SQLSERVER_ODBC_DRIVER", {
          defaultValue: "ODBC Driver 18 for SQL Server",
          allowPlaceholder: true,
        }),
        multiSubnetFailover: envBoolean("SQLSERVER_MULTI_SUBNET_FAILOVER", true),
      }),
      options: {
        useUTC: true,
      },
    };
  }
  return {
    ...common,
    server: host,
    port,
    database,
    user: env("SQLSERVER_USERNAME", { required: true }),
    password: env("SQLSERVER_PASSWORD", { required: true }),
    options: {
      appName: "itops-readonly",
      encrypt: true,
      trustServerCertificate: false,
      readOnlyIntent: true,
      multiSubnetFailover: envBoolean("SQLSERVER_MULTI_SUBNET_FAILOVER", true),
      enableArithAbort: true,
      useUTC: true,
      fallbackToDefaultDb: false,
    },
  };
}

async function createVerifiedPool(): Promise<sql.ConnectionPool> {
  const driver = sqlDriver();
  const pool = await new driver.ConnectionPool(connectionConfig()).connect();
  try {
    const result = await pool.request().query(REPLICA_PROOF_QUERY);
    replicaProof = assertReadableSecondary(
      (result.recordset?.[0] ?? undefined) as ReplicaProof | undefined,
      env("SQLSERVER_DATABASE", { required: true }),
    );
    return pool;
  } catch (error) {
    await pool.close().catch(() => undefined);
    throw new Error(
      `SQL Server replica verification failed before investigation access: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function getPool(): Promise<sql.ConnectionPool> {
  assertEnabled();
  if (!poolPromise) {
    poolPromise = createVerifiedPool().catch((error) => {
      poolPromise = undefined;
      replicaProof = undefined;
      throw error;
    });
  }
  return poolPromise;
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
  request.input("__itops_expected_database", env("SQLSERVER_DATABASE", { required: true }));
  bindParameters(request, parameters);
  const result = await request.query(
    `${PER_QUERY_REPLICA_GUARD}
IF UPPER(DB_NAME()) <> UPPER(@__itops_expected_database)
BEGIN
  THROW 51001, 'ITOps refused SQL access because the connected database changed', 1;
END;
SET ROWCOUNT ${maxRows};
${safeQuery};
SET ROWCOUNT 0;`,
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
      await getPool();
      return {
        status: "ok",
        authentication: authMode(),
        applicationIntent: "ReadOnly",
        replicaVerified: true,
        proof: replicaProof,
      };
    }),
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void poolPromise?.then((pool) => pool.close()).finally(() => process.exit(0));
  });
}

await startServer(server);
