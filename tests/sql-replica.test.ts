import { describe, expect, it } from "vitest";
import {
  assertReadableSecondary,
  buildWindowsReadOnlyConnectionString,
} from "../src/common/sql-replica.js";

describe("SQL Server readable-secondary enforcement", () => {
  it("accepts only a matching, read-only AG secondary proof", () => {
    expect(
      assertReadableSecondary(
        {
          database_name: "MobileApp",
          server_name: "sql-secondary-02",
          is_hadr_enabled: 1,
          is_primary_replica: 0,
          is_read_only: 1,
          updateability: "READ_ONLY",
        },
        "mobileapp",
      ),
    ).toMatchObject({ server_name: "sql-secondary-02" });
  });

  it("fails closed for primary, standalone, writable, and wrong-database connections", () => {
    const valid = {
      database_name: "MobileApp",
      is_hadr_enabled: 1,
      is_primary_replica: 0,
      is_read_only: 1,
      updateability: "READ_ONLY",
    };
    expect(() =>
      assertReadableSecondary({ ...valid, is_primary_replica: 1 }, "MobileApp"),
    ).toThrow(/not proven/i);
    expect(() =>
      assertReadableSecondary({ ...valid, is_hadr_enabled: 0 }, "MobileApp"),
    ).toThrow(/not proven/i);
    expect(() =>
      assertReadableSecondary({ ...valid, is_read_only: 0 }, "MobileApp"),
    ).toThrow(/not proven/i);
    expect(() => assertReadableSecondary(valid, "OtherDb")).toThrow(
      /unexpected database/i,
    );
  });

  it("builds an integrated-auth connection with immutable read-only intent", () => {
    const connectionString = buildWindowsReadOnlyConnectionString({
      host: "ag-listener.corp.example",
      port: 1433,
      database: "MobileApp",
      driver: "ODBC Driver 18 for SQL Server",
      multiSubnetFailover: true,
    });
    expect(connectionString).toContain("Trusted_Connection=Yes");
    expect(connectionString).toContain("ApplicationIntent=ReadOnly");
    expect(connectionString).toContain("TrustServerCertificate=No");
    expect(connectionString).toContain("MultiSubnetFailover=Yes");
    expect(() =>
      buildWindowsReadOnlyConnectionString({
        host: "listener;Trusted_Connection=No",
        port: 1433,
        database: "MobileApp",
        driver: "ODBC Driver 18 for SQL Server",
        multiSubnetFailover: true,
      }),
    ).toThrow(/listener/i);
    expect(() =>
      buildWindowsReadOnlyConnectionString({
        host: "listener,1433",
        port: 1433,
        database: "MobileApp",
        driver: "ODBC Driver 18 for SQL Server",
        multiSubnetFailover: true,
      }),
    ).toThrow(/listener/i);
  });
});
