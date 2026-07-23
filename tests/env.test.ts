import { afterEach, describe, expect, it } from "vitest";
import {
  envChoice,
  requireLoopbackUrl,
  requireSafeBaseUrl,
  workspacePath,
} from "../src/common/env.js";

const previousValues = {
  ITOPS_TEST_URL: process.env.ITOPS_TEST_URL,
  ITOPS_TEST_PATH: process.env.ITOPS_TEST_PATH,
  ITOPS_TEST_MODE: process.env.ITOPS_TEST_MODE,
  ITOPS_TEST_CALLBACK: process.env.ITOPS_TEST_CALLBACK,
};

afterEach(() => {
  for (const [name, value] of Object.entries(previousValues)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("environment security boundaries", () => {
  it("requires HTTPS for non-local API origins", () => {
    process.env.ITOPS_TEST_URL = "http://production.example/api";
    expect(() => requireSafeBaseUrl("ITOPS_TEST_URL")).toThrow(/HTTPS/i);
    process.env.ITOPS_TEST_URL = "https://production.example/api/";
    expect(requireSafeBaseUrl("ITOPS_TEST_URL").pathname).toBe("/api");
  });

  it("allows HTTP only for a loopback development endpoint", () => {
    process.env.ITOPS_TEST_URL = "http://127.0.0.1:8080";
    expect(requireSafeBaseUrl("ITOPS_TEST_URL").origin).toBe("http://127.0.0.1:8080");
  });

  it("rejects credentials, query strings, and fragments in base URLs", () => {
    process.env.ITOPS_TEST_URL = "https://user:password@production.example";
    expect(() => requireSafeBaseUrl("ITOPS_TEST_URL")).toThrow(/credentials/i);
    process.env.ITOPS_TEST_URL = "https://production.example?token=value";
    expect(() => requireSafeBaseUrl("ITOPS_TEST_URL")).toThrow(/query string/i);
    process.env.ITOPS_TEST_URL = "https://production.example/#secret";
    expect(() => requireSafeBaseUrl("ITOPS_TEST_URL")).toThrow(/fragment/i);
  });

  it("confines configured local outputs to the workspace", () => {
    process.env.ITOPS_TEST_PATH = "reports";
    expect(workspacePath("ITOPS_TEST_PATH", "fallback")).toContain("reports");
    process.env.ITOPS_TEST_PATH = "../outside";
    expect(() => workspacePath("ITOPS_TEST_PATH", "fallback")).toThrow(/workspace/i);
  });

  it("accepts only an explicit authentication mode", () => {
    process.env.ITOPS_TEST_MODE = "WINDOWS";
    expect(
      envChoice("ITOPS_TEST_MODE", ["windows", "sql"] as const, "windows"),
    ).toBe("windows");
    process.env.ITOPS_TEST_MODE = "browser-cookie";
    expect(() =>
      envChoice("ITOPS_TEST_MODE", ["windows", "sql"] as const, "windows"),
    ).toThrow(/must be one of/i);
  });

  it("requires OAuth callbacks to stay on loopback", () => {
    process.env.ITOPS_TEST_CALLBACK = "http://127.0.0.1:7778/oauth/callback";
    expect(requireLoopbackUrl("ITOPS_TEST_CALLBACK").port).toBe("7778");
    process.env.ITOPS_TEST_CALLBACK = "https://outside.example/oauth/callback";
    expect(() => requireLoopbackUrl("ITOPS_TEST_CALLBACK")).toThrow(/loopback/i);
  });
});
