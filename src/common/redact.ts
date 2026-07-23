import { envCsv, envInteger } from "./env.js";

const DEFAULT_SECRET_KEYS = [
  "authorization",
  "password",
  "passwd",
  "secret",
  "token",
  "api_key",
  "apikey",
  "connectionstring",
  "cookie",
  "session",
];

function secretKeys(): string[] {
  return [...DEFAULT_SECRET_KEYS, ...envCsv("ITOPS_REDACT_KEYS")].map((key) => key.toLowerCase());
}

function isSecretKey(key: string): boolean {
  const normalized = key.toLowerCase().replaceAll("-", "_");
  return secretKeys().some((secret) => normalized.includes(secret));
}

export function redactText(value: string): string {
  return value
    .replace(/(authorization\s*[:=]\s*)(?:bearer|splunk|api-token)?\s*[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/((?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/(mongodb(?:\+srv)?:\/\/[^:\s/]+:)[^@\s/]+@/gi, "$1[REDACTED]@")
    .replace(/((?:user id|uid|user)\s*=\s*[^;]+;\s*(?:password|pwd)\s*=)[^;]+/gi, "$1[REDACTED]");
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[MAX_DEPTH]";
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      result[key] = isSecretKey(key) ? "[REDACTED]" : redactValue(nested, depth + 1);
    }
    return result;
  }
  return value;
}

function boundedPreview(serialized: string, byteBudget: number): Record<string, string> {
  const notice =
    "Result exceeded ITOPS_MAX_RESULT_BYTES and was truncated before reaching the model.";
  let lower = 0;
  let upper = serialized.length;
  let preview = "";
  while (lower <= upper) {
    const middle = Math.floor((lower + upper) / 2);
    let candidate = serialized.slice(0, middle);
    if (/[\uD800-\uDBFF]$/.test(candidate)) candidate = candidate.slice(0, -1);
    if (
      Buffer.byteLength(JSON.stringify({ notice, preview: candidate }), "utf8") <=
      byteBudget
    ) {
      preview = candidate;
      lower = middle + 1;
    } else {
      upper = middle - 1;
    }
  }
  return { notice, preview };
}

export function boundedJson(value: unknown): { data: unknown; truncated: boolean; bytes: number } {
  const redacted = redactValue(value);
  const maxBytes = envInteger("ITOPS_MAX_RESULT_BYTES", 1_000_000, 10_000, 10_000_000);
  const serialized = JSON.stringify(redacted);
  const bytes = Buffer.byteLength(serialized, "utf8");
  // Leave room for the MCP envelope and metadata so the actual text response,
  // not merely the inner value, remains under the configured byte limit.
  const dataBudget = maxBytes - 1_024;
  if (bytes <= dataBudget) return { data: redacted, truncated: false, bytes };
  return {
    data: boundedPreview(serialized, dataBudget),
    truncated: true,
    bytes,
  };
}
