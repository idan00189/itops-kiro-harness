import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fetchJson, fetchText } from "../src/common/http.js";

const baseUrl = new URL("http://127.0.0.1:17777");
const previousLimit = process.env.ITOPS_MAX_HTTP_RESPONSE_BYTES;

beforeAll(() => {
  process.env.ITOPS_MAX_HTTP_RESPONSE_BYTES = "10000";
});

afterAll(() => {
  vi.unstubAllGlobals();
  if (previousLimit === undefined) delete process.env.ITOPS_MAX_HTTP_RESPONSE_BYTES;
  else process.env.ITOPS_MAX_HTTP_RESPONSE_BYTES = previousLimit;
});

describe("bounded HTTP client", () => {
  it("returns JSON from the fixed origin", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ status: "ok" }))),
    );
    await expect(fetchJson(baseUrl, "/ok")).resolves.toEqual({ status: "ok" });
  });

  it("stops reading a response after the configured byte bound", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("x".repeat(12_000), {
            headers: { "Content-Type": "text/plain" },
          }),
      ),
    );
    await expect(fetchText(baseUrl, "/large")).rejects.toThrow(/exceeded 10000 bytes/i);
  });

  it("does not retry non-retriable authentication failures and redacts error text", async () => {
    const request = vi.fn(
      async () => new Response("token=must-not-leak", { status: 401, statusText: "Unauthorized" }),
    );
    vi.stubGlobal("fetch", request);
    await expect(fetchJson(baseUrl, "/unauthorized")).rejects.toThrow(
      /token=\[REDACTED\]/i,
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects cross-origin paths before issuing a request", async () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    await expect(fetchJson(baseUrl, "https://outside.example/data")).rejects.toThrow(
      /cross-origin/i,
    );
    expect(request).not.toHaveBeenCalled();
  });
});
