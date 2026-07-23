import { assertNoControlCharacters, ConfigError } from "./env.js";

export type ReplicaProof = {
  database_name?: unknown;
  server_name?: unknown;
  is_hadr_enabled?: unknown;
  is_primary_replica?: unknown;
  is_read_only?: unknown;
  updateability?: unknown;
};

function bit(value: unknown): number | undefined {
  if (value === true) return 1;
  if (value === false) return 0;
  if (value === 0 || value === 1) return value;
  if (value === "0" || value === "1") return Number(value);
  return undefined;
}

export function assertReadableSecondary(
  proof: ReplicaProof | undefined,
  expectedDatabase: string,
): ReplicaProof {
  if (!proof) throw new Error("SQL Server replica proof returned no row");
  const database = String(proof.database_name ?? "");
  const updateability = String(proof.updateability ?? "").toUpperCase();
  if (database.toUpperCase() !== expectedDatabase.toUpperCase()) {
    throw new Error(
      `SQL Server connected to unexpected database ${database || "[unknown]"} instead of ${expectedDatabase}`,
    );
  }
  if (
    bit(proof.is_hadr_enabled) !== 1 ||
    bit(proof.is_primary_replica) !== 0 ||
    bit(proof.is_read_only) !== 1 ||
    updateability !== "READ_ONLY"
  ) {
    throw new Error(
      "SQL Server connection is not proven to be a readable Availability Group secondary; access was refused",
    );
  }
  return proof;
}

function odbcValue(value: string, label: string): string {
  assertNoControlCharacters(value, label);
  return `{${value.replaceAll("}", "}}")}}`;
}

export function buildWindowsReadOnlyConnectionString(input: {
  host: string;
  port: number;
  database: string;
  driver: string;
  multiSubnetFailover: boolean;
}): string {
  if (!/^[A-Za-z0-9._:-]+$/.test(input.host)) {
    throw new ConfigError(
      "SQLSERVER_HOST must be an Availability Group listener DNS name or IP address",
    );
  }
  return [
    `Driver=${odbcValue(input.driver, "SQLSERVER_ODBC_DRIVER")}`,
    `Server=${odbcValue(`tcp:${input.host},${input.port}`, "SQLSERVER_HOST")}`,
    `Database=${odbcValue(input.database, "SQLSERVER_DATABASE")}`,
    "Trusted_Connection=Yes",
    "Encrypt=Yes",
    "TrustServerCertificate=No",
    "ApplicationIntent=ReadOnly",
    `MultiSubnetFailover=${input.multiSubnetFailover ? "Yes" : "No"}`,
    "APP=itops-readonly",
  ].join(";");
}
