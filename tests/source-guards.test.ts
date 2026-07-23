import { describe, expect, it } from "vitest";
import {
  assertBitbucketRepository,
  assertGitLabProject,
  assertSourcePath,
  assertSourceRef,
  assertTextSource,
} from "../src/common/source-guards.js";

describe("source-code guards", () => {
  it("accepts ordinary immutable refs and repository paths", () => {
    expect(assertSourceRef("9f6a12bc")).toBe("9f6a12bc");
    expect(assertSourceRef("release/mobile-8.14.2")).toBe("release/mobile-8.14.2");
    expect(assertSourcePath("src/services/checkout.ts")).toBe("src/services/checkout.ts");
  });

  it.each(["../main", "refs//heads/main", "main@{1}", "-main", "main:", "main^"])(
    "rejects unsafe or ambiguous refs: %s",
    (ref) => expect(() => assertSourceRef(ref)).toThrow(),
  );

  it.each([
    "../config/itops.env",
    ".env",
    "services/api/.env.production",
    "private.pem",
    "deploy/production.key",
    "credentials/cloud.json",
    "infra/terraform.tfstate",
  ])("blocks traversal and secret-bearing paths: %s", (path) => {
    expect(() => assertSourcePath(path)).toThrow();
  });

  it("enforces provider repository allowlists", () => {
    expect(assertBitbucketRepository("mobile", "checkout-api", ["mobile/*"]).fullName).toBe(
      "mobile/checkout-api",
    );
    expect(() =>
      assertBitbucketRepository("finance", "payroll", ["mobile/*"]),
    ).toThrow(/outside/i);

    expect(assertGitLabProject("mobile/checkout-api", ["mobile/*"])).toBe(
      "mobile/checkout-api",
    );
    expect(() => assertGitLabProject("finance/payroll", ["mobile/*"])).toThrow(/outside/i);
  });

  it("accepts bounded UTF-8 and blocks oversized or binary content", () => {
    expect(assertTextSource(Buffer.from("export const ok = true;"), "source", 100)).toContain(
      "true",
    );
    expect(() => assertTextSource(Buffer.alloc(101, 65), "source", 100)).toThrow(/exceeds/i);
    expect(() => assertTextSource(Buffer.from([65, 0, 66]), "source", 100)).toThrow(/binary/i);
  });
});
