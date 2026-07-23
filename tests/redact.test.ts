import { describe, expect, it } from "vitest";
import { redactText, redactValue } from "../src/common/redact.js";

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
});
