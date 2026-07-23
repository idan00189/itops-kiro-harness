import { describe, expect, it } from "vitest";
import {
  assertReadOnlyPipeline,
  assertReadOnlySpl,
  assertReadOnlySql,
  assertMongoCollectionScopes,
  assertSafeDql,
  assertSafeMongoValue,
  matchesAllowlist,
} from "../src/common/guards.js";

describe("SQL read-only guard", () => {
  it("allows a single SELECT or CTE query", () => {
    expect(assertReadOnlySql("SELECT TOP (10) id FROM dbo.Incidents;")).toBe(
      "SELECT TOP (10) id FROM dbo.Incidents",
    );
    expect(
      assertReadOnlySql("WITH recent AS (SELECT id FROM dbo.Events) SELECT id FROM recent"),
    ).toContain("WITH recent");
  });

  it.each([
    "UPDATE dbo.Users SET admin = 1",
    "SELECT * INTO dbo.Copy FROM dbo.Events",
    "SELECT 1; DELETE FROM dbo.Events",
    "EXEC dbo.usp_ReadSomething",
    "SELECT * FROM OtherDb.dbo.Events",
    "SELECT * FROM OPENROWSET('provider', 'secret', 'query')",
    "SELECT NEXT VALUE FOR dbo.IncidentSequence",
    "SELECT * FROM dbo.Events WITH (UPDLOCK)",
    "SELECT * FROM dbo.Events WITH (XLOCK)",
  ])("blocks mutating, procedural, multi-statement, or cross-database SQL: %s", (query) => {
    expect(() => assertReadOnlySql(query)).toThrow();
  });

  it("does not treat blocked words inside literals or comments as executable SQL", () => {
    expect(assertReadOnlySql("SELECT 'delete from users' AS message")).toContain("delete");
    expect(assertReadOnlySql("SELECT 1 /* drop table users */")).toContain("drop");
  });
});

describe("Splunk and Dynatrace guards", () => {
  it("normalizes a read-only SPL search", () => {
    expect(assertReadOnlySpl("search index=mobile status>=500 | stats count by service")).toBe(
      "index=mobile status>=500 | stats count by service",
    );
  });

  it.each([
    "index=mobile | outputlookup production.csv",
    "index=mobile | collect index=summary",
    "index=mobile | mcollect index=metrics",
    "index=mobile | meventcollect index=metrics",
    "index=mobile | tscollect namespace=mobile",
    "index=mobile | sendemail to=outside@example.com",
    "index=mobile | sendalert webhook",
    "index=mobile | delete",
    "| savedsearch hidden_search",
    "| loadjob savedsearch=\"admin:search:hidden_search\"",
    "| rest /services/server/info",
    "| dbxquery connection=prod query=\"select * from secrets\"",
    "index=mobile `hidden_macro`",
  ])("blocks mutating or exfiltration-oriented SPL: %s", (query) => {
    expect(() => assertReadOnlySpl(query)).toThrow();
  });

  it("accepts a single DQL pipeline and rejects multiple statements", () => {
    expect(assertSafeDql("fetch logs | limit 20")).toBe("fetch logs | limit 20");
    expect(() => assertSafeDql("fetch logs; fetch events")).toThrow();
  });
});

describe("MongoDB/DocumentDB guards", () => {
  it("allows recursively safe filters and aggregation stages", () => {
    expect(() =>
      assertSafeMongoValue({ status: "error", nested: { $in: [500, 503] } }),
    ).not.toThrow();
    expect(() =>
      assertReadOnlyPipeline([{ $match: { status: "error" } }, { $group: { _id: "$service" } }]),
    ).not.toThrow();
  });

  it.each([
    [{ $where: "this.password" }],
    [{ nested: { $function: { body: "return true" } } }],
    [{ $merge: "other" }],
    [{ $out: "copy" }],
  ])("blocks server-side code and write operators: %o", (value) => {
    expect(() => assertSafeMongoValue(value)).toThrow();
  });

  it("rejects any aggregation stage not explicitly allowlisted", () => {
    expect(() => assertReadOnlyPipeline([{ $merge: "other" }])).toThrow();
    expect(() => assertReadOnlyPipeline([{ $changeStream: {} }])).toThrow();
  });

  it("enforces collection allowlists inside lookup and union stages", () => {
    expect(() =>
      assertMongoCollectionScopes(
        [{ $lookup: { from: "mobile_orders", localField: "id", foreignField: "id", as: "orders" } }],
        ["mobile_*"],
      ),
    ).not.toThrow();
    expect(() =>
      assertMongoCollectionScopes([{ $unionWith: { coll: "payroll", pipeline: [] } }], ["mobile_*"]),
    ).toThrow(/outside/i);
  });
});

describe("allowlist matching", () => {
  it("supports anchored case-insensitive wildcards", () => {
    expect(matchesAllowlist("mobile-prod-api", ["mobile-*-api"])).toBe(true);
    expect(matchesAllowlist("MOBILE-PROD-API", ["mobile-*-api"])).toBe(true);
    expect(matchesAllowlist("payments-prod-api", ["mobile-*-api"])).toBe(false);
  });
});
