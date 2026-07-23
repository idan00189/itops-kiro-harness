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

export function boundedJson(value: unknown): { data: unknown; truncated: boolean; bytes: number } {
  const redacted = redactValue(value);
  const maxBytes = envInteger("ITOPS_MAX_RESULT_BYTES", 1_000_000, 10_000, 10_000_000);
  const serialized = JSON.stringify(redacted);
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes <= maxBytes) return { data: redacted, truncated: false, bytes };
  return {
    data: {
      notice: "Result exceeded ITOPS_MAX_RESULT_BYTES and was truncated before reaching the model.",
      preview: serialized.slice(0, maxBytes),
    },
    truncated: true,
    bytes,
  };
}
