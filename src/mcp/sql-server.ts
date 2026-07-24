import { createRequire } from "node:module";
import sql from "mssql";
import { z } from "zod";
import {
  loadSqlServerProfiles,
  resolveConnection,
  type SqlServerConnectionProfile,
} from "../common/database-profiles.js";
import { assertReadOnlySql } from "../common/guards.js";
import { enabled, envInteger } from "../common/env.js";
import { createServer, readOnlyAnnotations, runTool, startServer } from "../common/mcp.js";
import {
  assertReadableSecondary,
  buildWindowsReadOnlyConnectionString,
  type ReplicaProof,
} from "../common/sql-replica.js";

const SERVER = "itops-sql-server";
const server = createServer(
  SERVER,
  "Named read-only SQL Server Availability Group secondary connections. Every connection requests read-only intent and every investigation query fails unless its exact target is proven to be a readable secondary.",
);

let profilesCache: SqlServerConnectionProfile[] | undefined;
const poolPromises = new Map<string, Promise<sql.ConnectionPool>>();
const replicaProofs = new Map<string, ReplicaProof>();
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

function profiles(): SqlServerConnectionProfile[] {
  assertEnabled();
  profilesCache ??= loadSqlServerProfiles();
  return profilesCache;
}

function sqlDriver(profile: SqlServerConnectionProfile): typeof sql {
  if (profile.authMode === "sql") return sql;
  try {
    return require("mssql/msnodesqlv8") as typeof sql;
  } catch {
    throw new Error(
      "Windows integrated SQL authentication requires the pinned msnodesqlv8 package and Microsoft ODBC Driver 18 for SQL Server",
    );
  }
}

type DriverConfig = sql.config & { connectionString?: string };

function connectionConfig(profile: SqlServerConnectionProfile): DriverConfig {
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
  if (profile.authMode === "windows") {
    if (process.platform !== "win32") {
      throw new Error(
        `SQL Server connection ${profile.name} uses Windows authentication, which requires Kiro to run on Windows`,
      );
    }
    return {
      ...common,
      server: profile.host,
      database: profile.database,
      connectionString: buildWindowsReadOnlyConnectionString({
        host: profile.host,
        port: profile.port,
        database: profile.database,
        driver: profile.odbcDriver,
        multiSubnetFailover: profile.multiSubnetFailover,
      }),
      options: {
        useUTC: true,
      },
    };
  }
  return {
    ...common,
    server: profile.host,
    port: profile.port,
    database: profile.database,
    user: profile.username,
    password: profile.password,
    options: {
      appName: "itops-readonly",
      encrypt: true,
      trustServerCertificate: false,
      readOnlyIntent: true,
      multiSubnetFailover: profile.multiSubnetFailover,
      enableArithAbort: true,
      useUTC: true,
      fallbackToDefaultDb: false,
    },
  };
}

async function createVerifiedPool(
  profile: SqlServerConnectionProfile,
): Promise<sql.ConnectionPool> {
  const driver = sqlDriver(profile);
  const pool = await new driver.ConnectionPool(connectionConfig(profile)).connect();
  try {
    const result = await pool.request().query(REPLICA_PROOF_QUERY);
    const proof = assertReadableSecondary(
      (result.recordset?.[0] ?? undefined) as ReplicaProof | undefined,
      profile.database,
    );
    replicaProofs.set(profile.name, proof);
    return pool;
  } catch (error) {
    await pool.close().catch(() => undefined);
    throw new Error(
      `SQL Server connection ${profile.name} replica verification failed before investigation access: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function getPool(profile: SqlServerConnectionProfile): Promise<sql.ConnectionPool> {
  let poolPromise = poolPromises.get(profile.name);
  if (!poolPromise) {
    poolPromise = createVerifiedPool(profile).catch((error) => {
      poolPromises.delete(profile.name);
      replicaProofs.delete(profile.name);
      throw error;
    });
    poolPromises.set(profile.name, poolPromise);
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
  connection: string | undefined,
  query: string,
  parameters: Record<string, Scalar>,
  requestedRows: number,
): Promise<{
  connection: string;
  database: string;
  rows: unknown[];
  rowCount: number;
  truncated: boolean;
}> {
  const safeQuery = assertReadOnlySql(query);
  const maxRows = Math.min(
    requestedRows,
    envInteger("SQLSERVER_MAX_ROWS", 500, 1, 10_000),
  );
  const profile = resolveConnection(profiles(), connection, "SQL Server");
  const pool = await getPool(profile);
  const request = pool.request();
  request.input("__itops_expected_database", profile.database);
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
  return {
    connection: profile.name,
    database: profile.database,
    rows,
    rowCount: rows.length,
    truncated: rows.length >= maxRows,
  };
}

server.registerTool(
  "sql_list_connections",
  {
    title: "List configured SQL Server connections",
    description:
      "List safe metadata for named SQL Server connections. Credentials and listener hostnames are never returned.",
    inputSchema: z.object({}),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "sql_list_connections", input, async () => ({
      connections: profiles().map((profile) => ({
        name: profile.name,
        database: profile.database,
        authentication: profile.authMode,
      })),
    })),
);

server.registerTool(
  "sql_query",
  {
    title: "Query SQL Server replica (read-only)",
    description:
      "Execute one bounded parameterized SELECT or CTE query on a named connection. DML, DDL, procedures, SELECT INTO, and cross-database identifiers are rejected.",
    inputSchema: z.object({
      connection: z.string().min(1).max(32).optional(),
      query: z.string().min(1).max(20_000),
      parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
      maxRows: z.number().int().min(1).max(10_000).default(500),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "sql_query", {
      connection: input.connection,
      query: input.query,
      parameterNames: Object.keys(input.parameters),
    }, () =>
      executeBounded(input.connection, input.query, input.parameters, input.maxRows),
    ),
);

server.registerTool(
  "sql_list_schema",
  {
    title: "Inspect SQL Server schema (read-only)",
    description:
      "List visible tables, columns, and data types from INFORMATION_SCHEMA on a named connection.",
    inputSchema: z.object({
      connection: z.string().min(1).max(32).optional(),
      schema: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/).optional(),
      maxRows: z.number().int().min(1).max(2_000).default(500),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "sql_list_schema", input, () => {
      const filter = input.schema ? "WHERE c.TABLE_SCHEMA = @schema" : "";
      return executeBounded(
        input.connection,
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
      "Verify one or every named SQL connection, database identity, read-only intent, and replica role.",
    inputSchema: z.object({
      connection: z.string().min(1).max(32).optional(),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "sql_health", input, async () => {
      if (!enabled("SQLSERVER")) return { status: "disabled", integration: "sqlserver" };
      const selected = input.connection
        ? [resolveConnection(profiles(), input.connection, "SQL Server")]
        : profiles();
      const connections = [];
      for (const profile of selected) {
        await getPool(profile);
        connections.push({
          name: profile.name,
          database: profile.database,
          authentication: profile.authMode,
          applicationIntent: "ReadOnly",
          replicaVerified: true,
          proof: replicaProofs.get(profile.name),
        });
      }
      return {
        status: "ok",
        connections,
      };
    }),
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void Promise.all(
      [...poolPromises.values()].map((poolPromise) =>
        poolPromise.then((pool) => pool.close()).catch(() => undefined),
      ),
    ).finally(() => process.exit(0));
  });
}

await startServer(server);
