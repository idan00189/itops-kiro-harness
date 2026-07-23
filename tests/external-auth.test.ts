import { afterEach, describe, expect, it } from "vitest";
import { parseCurlResponse } from "../src/common/negotiate.js";
import {
  configuredExecutable,
  executeBoundedProcess,
} from "../src/common/process.js";

const previous = process.env.ITOPS_TEST_EXECUTABLE;

afterEach(() => {
  if (previous === undefined) delete process.env.ITOPS_TEST_EXECUTABLE;
  else process.env.ITOPS_TEST_EXECUTABLE = previous;
});

describe("external authentication helper boundaries", () => {
  it("parses the final randomized curl status marker", () => {
    const marker = "\n__ITOPS_STATUS_test__:";
    expect(parseCurlResponse(`{"ok":true}${marker}200`, marker)).toEqual({
      status: 200,
      body: '{"ok":true}',
    });
    expect(() => parseCurlResponse("missing", marker)).toThrow(/marker/i);
    expect(() => parseCurlResponse(`${marker}abc`, marker)).toThrow(/status/i);
  });

  it("limits environment-configured executable names", () => {
    process.env.ITOPS_TEST_EXECUTABLE = "curl.exe";
    expect(
      configuredExecutable("ITOPS_TEST_EXECUTABLE", "curl.exe", [
        "curl",
        "curl.exe",
      ]),
    ).toBe("curl.exe");
    process.env.ITOPS_TEST_EXECUTABLE = "powershell.exe";
    expect(() =>
      configuredExecutable("ITOPS_TEST_EXECUTABLE", "curl.exe", [
        "curl",
        "curl.exe",
      ]),
    ).toThrow(/must name/i);
  });

  it("does not echo helper arguments when a process fails", async () => {
    const secretMarker = "query-value-that-must-not-be-echoed";
    await expect(
      executeBoundedProcess(
        process.execPath,
        ["-e", "process.exit(1)", secretMarker],
        { timeoutMs: 5_000, maxBuffer: 64_000 },
      ),
    ).rejects.not.toThrow(secretMarker);
  });
});
