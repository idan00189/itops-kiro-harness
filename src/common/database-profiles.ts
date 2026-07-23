import {
  ConfigError,
  assertNoControlCharacters,
  env,
  envBoolean,
  envChoice,
  envCsv,
  envInteger,
} from "./env.js";
import { assertSafeIdentifier, matchesAllowlist } from "./guards.js";

const PROFILE_NAME = /^[a-z][a-z0-9_]{0,31}$/;
const ALLOWLIST_PATTERN = /^[A-Za-z0-9_.\-*]{1,128}$/;
const MAX_CONNECTIONS = 16;
const SYSTEM_MONGODB_DATABASES = new Set(["admin", "config", "local"]);

type ProfileSet = {
  names: string[];
  named: boolean;
};

export type SqlServerConnectionProfile = {
  name: string;
  authMode: "windows" | "sql";
  host: string;
  port: number;
  database: string;
  odbcDriver: string;
  multiSubnetFailover: boolean;
  username?: string;
  password?: string;
};

export type MongoConnectionProfile = {
  name: string;
  mode: "mongodb" | "documentdb";
  uri: string;
  tlsCaFile: string;
  readPreference:
    | "primary"
    | "primaryPreferred"
    | "secondary"
    | "secondaryPreferred"
    | "nearest";
  databaseAllowlist: string[];
  collectionAllowlist: string[];
};

function profileSet(base: "SQLSERVER" | "MONGODB"): ProfileSet {
  const configured = envCsv(`${base}_CONNECTIONS`);
  if (configured.length === 0) return { names: ["default"], named: false };
  if (configured.length > MAX_CONNECTIONS) {
    throw new ConfigError(`${base}_CONNECTIONS supports at most ${MAX_CONNECTIONS} profiles`);
  }
  const names = configured.map((name) => name.toLowerCase());
  for (const [index, name] of names.entries()) {
    if (configured[index] !== name || !PROFILE_NAME.test(name)) {
      throw new ConfigError(
        `${base}_CONNECTIONS profile ${name} must match ${PROFILE_NAME.source}`,
      );
    }
  }
  if (new Set(names).size !== names.length) {
    throw new ConfigError(`${base}_CONNECTIONS contains a duplicate profile name`);
  }
  return { names, named: true };
}

function scopedName(
  base: "SQLSERVER" | "MONGODB",
  profile: string,
  suffix: string,
  named: boolean,
): string {
  return named ? `${base}_${profile.toUpperCase()}_${suffix}` : `${base}_${suffix}`;
}

function rejectMixedLegacyConfiguration(
  base: "SQLSERVER" | "MONGODB",
  set: ProfileSet,
  legacySuffixes: string[],
): void {
  if (!set.named) return;
  const mixed = legacySuffixes
    .map((suffix) => `${base}_${suffix}`)
    .filter((name) => Boolean(process.env[name]?.trim()));
  if (mixed.length > 0) {
    throw new ConfigError(
      `${base}_CONNECTIONS cannot be mixed with legacy connection variables: ${mixed.join(", ")}`,
    );
  }
}

function validateAllowlist(name: string, values: string[]): string[] {
  if (values.length === 0) throw new ConfigError(`${name} must not be empty`);
  for (const value of values) {
    if (!ALLOWLIST_PATTERN.test(value)) {
      throw new ConfigError(`${name} contains invalid pattern ${value}`);
    }
  }
  return values;
}

function mongoReadPreference(
  name: string,
): MongoConnectionProfile["readPreference"] {
  const choices: Record<string, MongoConnectionProfile["readPreference"]> = {
    primary: "primary",
    primarypreferred: "primaryPreferred",
    secondary: "secondary",
    secondarypreferred: "secondaryPreferred",
    nearest: "nearest",
  };
  const value = env(name, {
    defaultValue: "secondaryPreferred",
    allowPlaceholder: true,
  }).toLowerCase();
  const selected = choices[value];
  if (!selected) {
    throw new ConfigError(
      `${name} must be one of: ${Object.values(choices).join(", ")}`,
    );
  }
  return selected;
}

export function loadSqlServerProfiles(): SqlServerConnectionProfile[] {
  if (!envBoolean("SQLSERVER_ENCRYPT", true)) {
    throw new ConfigError("SQLSERVER_ENCRYPT must remain true");
  }
  if (envBoolean("SQLSERVER_TRUST_SERVER_CERTIFICATE", false)) {
    throw new ConfigError(
      "SQLSERVER_TRUST_SERVER_CERTIFICATE must remain false; install the issuing CA instead",
    );
  }
  const set = profileSet("SQLSERVER");
  rejectMixedLegacyConfiguration("SQLSERVER", set, [
    "AUTH_MODE",
    "HOST",
    "PORT",
    "DATABASE",
    "MULTI_SUBNET_FAILOVER",
    "USERNAME",
    "PASSWORD",
  ]);
  const odbcDriver = env("SQLSERVER_ODBC_DRIVER", {
    defaultValue: "ODBC Driver 18 for SQL Server",
    allowPlaceholder: true,
  });
  return set.names.map((name) => {
    const key = (suffix: string): string =>
      scopedName("SQLSERVER", name, suffix, set.named);
    const authMode = envChoice(key("AUTH_MODE"), ["windows", "sql"] as const, "windows");
    const host = env(key("HOST"), { required: true });
    assertNoControlCharacters(host, key("HOST"));
    const database = env(key("DATABASE"), { required: true });
    assertNoControlCharacters(database, key("DATABASE"));
    const common = {
      name,
      authMode,
      host,
      port: envInteger(key("PORT"), 1433, 1, 65_535),
      database,
      odbcDriver,
      multiSubnetFailover: envBoolean(key("MULTI_SUBNET_FAILOVER"), true),
    };
    if (authMode === "sql") {
      return {
        ...common,
        username: env(key("USERNAME"), { required: true }),
        password: env(key("PASSWORD"), { required: true }),
      };
    }
    return common;
  });
}

export function loadMongoProfiles(): MongoConnectionProfile[] {
  const set = profileSet("MONGODB");
  rejectMixedLegacyConfiguration("MONGODB", set, [
    "MODE",
    "URI",
    "DATABASE",
    "DATABASE_ALLOWLIST",
    "TLS_CA_FILE",
    "READ_PREFERENCE",
    "COLLECTION_ALLOWLIST",
  ]);
  return set.names.map((name) => {
    const key = (suffix: string): string =>
      scopedName("MONGODB", name, suffix, set.named);
    const uri = env(key("URI"), { required: true });
    assertNoControlCharacters(uri, key("URI"));
    if (!/^mongodb(?:\+srv)?:\/\//i.test(uri)) {
      throw new ConfigError(`${key("URI")} must use mongodb:// or mongodb+srv://`);
    }
    if (/tls(?:allowinvalidcertificates|allowinvalidhostnames|insecure)=true/i.test(uri)) {
      throw new ConfigError(`${key("URI")} disables TLS certificate validation`);
    }
    const mode = envChoice(key("MODE"), ["mongodb", "documentdb"] as const, "mongodb");
    const databaseFallback = set.named
      ? "*"
      : env("MONGODB_DATABASE", { required: true });
    return {
      name,
      mode,
      uri,
      tlsCaFile: env(key("TLS_CA_FILE"), { allowPlaceholder: true }),
      readPreference: mongoReadPreference(key("READ_PREFERENCE")),
      databaseAllowlist: validateAllowlist(
        key("DATABASE_ALLOWLIST"),
        envCsv(key("DATABASE_ALLOWLIST"), databaseFallback),
      ),
      collectionAllowlist: validateAllowlist(
        key("COLLECTION_ALLOWLIST"),
        envCsv(key("COLLECTION_ALLOWLIST"), "*"),
      ),
    };
  });
}

export function resolveConnection<T extends { name: string }>(
  profiles: T[],
  requested: string | undefined,
  integration: string,
): T {
  if (requested) {
    const normalized = requested.toLowerCase();
    const profile = profiles.find((candidate) => candidate.name === normalized);
    if (!profile) {
      throw new ConfigError(
        `Unknown ${integration} connection ${requested}; choose one of: ${profiles
          .map((candidate) => candidate.name)
          .join(", ")}`,
      );
    }
    return profile;
  }
  const only = profiles[0];
  if (profiles.length === 1 && only) return only;
  throw new ConfigError(
    `${integration} connection is required; choose one of: ${profiles
      .map((profile) => profile.name)
      .join(", ")}`,
  );
}

export function resolveMongoDatabase(
  profile: MongoConnectionProfile,
  requested: string | undefined,
): string {
  if (requested) return assertMongoDatabaseAllowed(profile, requested);
  if (
    profile.databaseAllowlist.length === 1 &&
    profile.databaseAllowlist[0] &&
    !profile.databaseAllowlist[0].includes("*")
  ) {
    return assertMongoDatabaseAllowed(profile, profile.databaseAllowlist[0]);
  }
  throw new ConfigError(
    `MongoDB database is required for connection ${profile.name}; call mongodb_list_databases first`,
  );
}

export function assertMongoDatabaseAllowed(
  profile: MongoConnectionProfile,
  database: string,
): string {
  const safe = assertSafeIdentifier(database, "MongoDB database");
  if (SYSTEM_MONGODB_DATABASES.has(safe.toLowerCase())) {
    throw new ConfigError(`MongoDB system database ${safe} is always blocked`);
  }
  if (!matchesAllowlist(safe, profile.databaseAllowlist)) {
    throw new ConfigError(
      `Database ${safe} is outside connection ${profile.name} database allowlist`,
    );
  }
  return safe;
}

export function filterVisibleMongoDatabases(
  profile: MongoConnectionProfile,
  databases: string[],
): string[] {
  const visible = new Set<string>();
  for (const database of databases) {
    const safe = assertSafeIdentifier(database, "MongoDB database");
    if (
      !SYSTEM_MONGODB_DATABASES.has(safe.toLowerCase()) &&
      matchesAllowlist(safe, profile.databaseAllowlist)
    ) {
      visible.add(safe);
    }
  }
  return [...visible].sort((left, right) => left.localeCompare(right));
}
