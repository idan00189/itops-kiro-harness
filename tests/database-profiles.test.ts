import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  filterVisibleMongoDatabases,
  loadMongoProfiles,
  loadSqlServerProfiles,
  resolveConnection,
  resolveMongoDatabase,
} from "../src/common/database-profiles.js";

const original = new Map(
  Object.entries(process.env).filter(([name]) =>
    /^(?:SQLSERVER|MONGODB)_/.test(name),
  ),
);

function clearDatabaseEnvironment(): void {
  for (const name of Object.keys(process.env)) {
    if (/^(?:SQLSERVER|MONGODB)_/.test(name)) delete process.env[name];
  }
}

beforeEach(clearDatabaseEnvironment);

afterEach(() => {
  clearDatabaseEnvironment();
  for (const [name, value] of original) process.env[name] = value;
});

describe("named database connection profiles", () => {
  it("loads independent SQL Server connection and authentication settings", () => {
    process.env.SQLSERVER_CONNECTIONS = "mobile,orders";
    process.env.SQLSERVER_MOBILE_HOST = "mobile-listener.example";
    process.env.SQLSERVER_MOBILE_DATABASE = "MobileApp";
    process.env.SQLSERVER_MOBILE_AUTH_MODE = "windows";
    process.env.SQLSERVER_ORDERS_HOST = "orders-listener.example";
    process.env.SQLSERVER_ORDERS_DATABASE = "Orders";
    process.env.SQLSERVER_ORDERS_AUTH_MODE = "sql";
    process.env.SQLSERVER_ORDERS_USERNAME = "orders_reader";
    process.env.SQLSERVER_ORDERS_PASSWORD = "secret-value";

    const profiles = loadSqlServerProfiles();
    expect(profiles).toHaveLength(2);
    expect(profiles[0]).toMatchObject({
      name: "mobile",
      authMode: "windows",
      database: "MobileApp",
    });
    expect(profiles[1]).toMatchObject({
      name: "orders",
      authMode: "sql",
      database: "Orders",
      username: "orders_reader",
    });
    expect(resolveConnection(profiles, "ORDERS", "SQL Server").database).toBe(
      "Orders",
    );
    expect(() => resolveConnection(profiles, undefined, "SQL Server")).toThrow(
      /connection is required/i,
    );
  });

  it("keeps the legacy single SQL Server variables compatible", () => {
    process.env.SQLSERVER_HOST = "legacy-listener.example";
    process.env.SQLSERVER_DATABASE = "LegacyMobile";
    process.env.SQLSERVER_AUTH_MODE = "windows";

    expect(loadSqlServerProfiles()).toEqual([
      expect.objectContaining({
        name: "default",
        host: "legacy-listener.example",
        database: "LegacyMobile",
      }),
    ]);
  });

  it("rejects ambiguous and malformed connection names", () => {
    process.env.SQLSERVER_CONNECTIONS = "mobile,mobile";
    expect(() => loadSqlServerProfiles()).toThrow(/duplicate/i);
    process.env.SQLSERVER_CONNECTIONS = "Mobile";
    expect(() => loadSqlServerProfiles()).toThrow(/must match/i);
    process.env.SQLSERVER_CONNECTIONS = "mobile-prod";
    expect(() => loadSqlServerProfiles()).toThrow(/must match/i);
  });

  it("rejects mixed named and legacy connection settings", () => {
    process.env.SQLSERVER_CONNECTIONS = "mobile";
    process.env.SQLSERVER_HOST = "legacy-listener.example";
    process.env.SQLSERVER_MOBILE_HOST = "mobile-listener.example";
    process.env.SQLSERVER_MOBILE_DATABASE = "Mobile";
    expect(() => loadSqlServerProfiles()).toThrow(/cannot be mixed/i);
  });

  it("loads several document URIs and allows every authorized app database", () => {
    process.env.MONGODB_CONNECTIONS = "mobile,archive";
    process.env.MONGODB_MOBILE_MODE = "mongodb";
    process.env.MONGODB_MOBILE_URI =
      "mongodb://reader:password@mongo.example:27017/?authSource=admin";
    process.env.MONGODB_MOBILE_DATABASE_ALLOWLIST = "mobile_*";
    process.env.MONGODB_MOBILE_COLLECTION_ALLOWLIST = "orders,events_*";
    process.env.MONGODB_ARCHIVE_MODE = "documentdb";
    process.env.MONGODB_ARCHIVE_URI =
      "mongodb://reader:password@archive.example:27017/?tls=true&replicaSet=rs0&retryWrites=false";
    process.env.MONGODB_ARCHIVE_DATABASE_ALLOWLIST = "*";
    process.env.MONGODB_ARCHIVE_COLLECTION_ALLOWLIST = "*";

    const profiles = loadMongoProfiles();
    expect(profiles).toHaveLength(2);
    expect(profiles[1]).toMatchObject({
      name: "archive",
      mode: "documentdb",
      databaseAllowlist: ["*"],
    });
    expect(
      filterVisibleMongoDatabases(profiles[0]!, [
        "admin",
        "config",
        "local",
        "mobile_prod",
        "mobile_test",
        "unrelated",
      ]),
    ).toEqual(["mobile_prod", "mobile_test"]);
    expect(resolveMongoDatabase(profiles[0]!, "mobile_prod")).toBe(
      "mobile_prod",
    );
    expect(() => resolveMongoDatabase(profiles[1]!, undefined)).toThrow(
      /list_databases first/i,
    );
    expect(() => resolveMongoDatabase(profiles[1]!, "admin")).toThrow(
      /always blocked/i,
    );
  });

  it("keeps a legacy single MongoDB database as the automatic target", () => {
    process.env.MONGODB_URI =
      "mongodb://reader:password@mongo.example:27017/?authSource=admin";
    process.env.MONGODB_DATABASE = "MobileApp";

    const [profile] = loadMongoProfiles();
    expect(profile).toBeDefined();
    expect(profile?.name).toBe("default");
    expect(resolveMongoDatabase(profile!, undefined)).toBe("MobileApp");
  });

  it("rejects TLS-insecure document connection profiles", () => {
    process.env.MONGODB_CONNECTIONS = "unsafe";
    process.env.MONGODB_UNSAFE_URI =
      "mongodb://reader:password@mongo.example:27017/?tls=true&tlsAllowInvalidCertificates=true";
    process.env.MONGODB_UNSAFE_DATABASE_ALLOWLIST = "*";
    expect(() => loadMongoProfiles()).toThrow(/TLS certificate validation/i);
  });
});
