import { afterEach, describe, expect, it } from "vitest";
import { requireSafeBaseUrl, workspacePath } from "../src/common/env.js";

const previousValues = {
  ITOPS_TEST_URL: process.env.ITOPS_TEST_URL,
  ITOPS_TEST_PATH: process.env.ITOPS_TEST_PATH,
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

  it("confines configured local outputs to the workspace", () => {
    process.env.ITOPS_TEST_PATH = "reports";
    expect(workspacePath("ITOPS_TEST_PATH", "fallback")).toContain("reports");
    process.env.ITOPS_TEST_PATH = "../outside";
    expect(() => workspacePath("ITOPS_TEST_PATH", "fallback")).toThrow(/workspace/i);
  });
});
