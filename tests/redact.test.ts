import { describe, expect, it } from "vitest";
import { ok } from "../src/common/mcp.js";
import { boundedJson, redactText, redactValue } from "../src/common/redact.js";

describe("secret redaction", () => {
  it("redacts common credentials in text and connection strings", () => {
    const value =
      "Authorization: Bearer abc123 token=xyz mongodb://reader:hunter2@db.example/app";
    const redacted = redactText(value);
    expect(redacted).not.toContain("abc123");
    expect(redacted).not.toContain("xyz");
    expect(redacted).not.toContain("hunter2");
    expect(redacted).toContain("[REDACTED]");
  });

  it("redacts nested values using secret-like key names", () => {
    expect(
      redactValue({
        token: "abc",
        nested: { apiKey: "def", safe: "visible" },
      }),
    ).toEqual({
      token: "[REDACTED]",
      nested: { apiKey: "[REDACTED]", safe: "visible" },
    });
  });

  it("bounds the actual UTF-8 MCP output for Hebrew and escaped content", () => {
    const previous = process.env.ITOPS_MAX_RESULT_BYTES;
    process.env.ITOPS_MAX_RESULT_BYTES = "10000";
    try {
      const value = {
        message: `${"אירוע חמור ".repeat(2_000)}${'"\\'.repeat(2_000)}`,
        token: "must-not-leak",
      };
      const bounded = boundedJson(value);
      expect(bounded.truncated).toBe(true);
      expect(Buffer.byteLength(JSON.stringify(bounded.data), "utf8")).toBeLessThanOrEqual(8_976);
      expect(JSON.stringify(bounded.data)).not.toContain("\uFFFD");
      expect(JSON.stringify(bounded.data)).not.toContain("must-not-leak");

      const result = ok(value);
      const text = result.content.find((item) => item.type === "text")?.text ?? "";
      expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(10_000);
      expect(text).not.toContain("must-not-leak");
    } finally {
      if (previous === undefined) delete process.env.ITOPS_MAX_RESULT_BYTES;
      else process.env.ITOPS_MAX_RESULT_BYTES = previous;
    }
  });
});
