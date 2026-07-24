import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";
import { envInteger } from "./env.js";
import { redactText } from "./redact.js";

type FetchOptions = {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  retries?: number;
};

class NonRetryableHttpError extends Error {}

export function resolveApiUrl(base: URL, path: string): URL {
  const resolved = new URL(path, `${base.toString().replace(/\/+$/, "")}/`);
  if (resolved.origin !== base.origin) {
    throw new Error("Cross-origin API path rejected");
  }
  return resolved;
}

async function request(base: URL, path: string, options: FetchOptions): Promise<Response> {
  const url = resolveApiUrl(base, path);
  const timeoutMs =
    options.timeoutMs ?? envInteger("ITOPS_HTTP_TIMEOUT_MS", 30_000, 1_000, 300_000);
  const retries = options.retries ?? 2;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: options.method ?? "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "itops-kiro-harness/1.6.0",
          ...options.headers,
        },
        ...(options.body === undefined ? {} : { body: options.body }),
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if ([429, 502, 503, 504].includes(response.status) && attempt < retries) {
        await response.body?.cancel();
        await delay(250 * 2 ** attempt);
        continue;
      }
      if (!response.ok) {
        const body = redactText((await response.text()).slice(0, 2_000));
        throw new NonRetryableHttpError(`HTTP ${response.status} ${response.statusText}: ${body}`);
      }
      return response;
    } catch (error) {
      if (error instanceof NonRetryableHttpError) throw error;
      if (attempt >= retries) throw error;
      await delay(250 * 2 ** attempt);
    }
  }
  throw new Error("HTTP request failed");
}

async function readBounded(response: Response): Promise<Buffer> {
  const maxBytes = envInteger("ITOPS_MAX_HTTP_RESPONSE_BYTES", 5_000_000, 10_000, 50_000_000);
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel();
    throw new Error(`HTTP response exceeded ${maxBytes} bytes`);
  }
  if (!response.body) return Buffer.alloc(0);

  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new Error(`HTTP response exceeded ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, bytes);
}

export async function fetchJson<T>(
  base: URL,
  path: string,
  options: FetchOptions = {},
): Promise<T> {
  const response = await request(base, path, options);
  const buffer = await readBounded(response);
  try {
    return JSON.parse(buffer.toString("utf8")) as T;
  } catch {
    throw new Error("API returned invalid JSON");
  }
}

export async function fetchText(
  base: URL,
  path: string,
  options: FetchOptions = {},
): Promise<string> {
  const response = await request(base, path, options);
  const buffer = await readBounded(response);
  return buffer.toString("utf8");
}

export function withQuery(path: string, params: Record<string, string | number | boolean | undefined>): string {
  const url = new URL(path, "https://placeholder.invalid");
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}`;
}

export function bearer(token: string, scheme = "Bearer"): Record<string, string> {
  return { Authorization: `${scheme} ${token}` };
}

export function basic(username: string, password: string): Record<string, string> {
  return { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` };
}
