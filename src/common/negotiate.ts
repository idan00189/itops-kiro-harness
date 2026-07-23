import { randomUUID } from "node:crypto";
import { env, envInteger } from "./env.js";
import { resolveApiUrl } from "./http.js";
import { configuredExecutable, executeBoundedProcess } from "./process.js";
import { redactText } from "./redact.js";

type NegotiateRequest = {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
};

const verifiedClients = new Set<string>();

function curlCommand(): string {
  return configuredExecutable("SPLUNK_CURL_PATH", "curl.exe", ["curl", "curl.exe"]);
}

async function verifyClient(command: string): Promise<void> {
  if (verifiedClients.has(command)) return;
  if (process.platform !== "win32") {
    throw new Error("SPLUNK_AUTH_MODE=kerberos is supported only on Windows");
  }
  const { stdout } = await executeBoundedProcess(command, ["--version"], {
    timeoutMs: 10_000,
    maxBuffer: 64_000,
  });
  if (!/\bSPNEGO\b/i.test(stdout) || !/\bSSPI\b/i.test(stdout)) {
    throw new Error(
      "curl.exe does not advertise the Windows SSPI and SPNEGO features required for Kerberos",
    );
  }
  verifiedClients.add(command);
}

export function parseCurlResponse(output: string, marker: string): {
  status: number;
  body: string;
} {
  const markerIndex = output.lastIndexOf(marker);
  if (markerIndex < 0) throw new Error("Kerberos HTTP helper omitted its status marker");
  const statusText = output.slice(markerIndex + marker.length).trim();
  if (!/^\d{3}$/.test(statusText)) {
    throw new Error("Kerberos HTTP helper returned an invalid status code");
  }
  return {
    status: Number(statusText),
    body: output.slice(0, markerIndex).replace(/\r?\n$/, ""),
  };
}

export async function fetchNegotiateText(
  base: URL,
  path: string,
  options: NegotiateRequest = {},
): Promise<string> {
  if (base.protocol !== "https:") {
    throw new Error("Kerberos authentication requires an HTTPS Splunk endpoint");
  }
  const command = curlCommand();
  await verifyClient(command);

  const url = resolveApiUrl(base, path);
  const timeoutMs =
    options.timeoutMs ?? envInteger("ITOPS_HTTP_TIMEOUT_MS", 30_000, 1_000, 300_000);
  const maxBytes = envInteger(
    "ITOPS_MAX_HTTP_RESPONSE_BYTES",
    5_000_000,
    10_000,
    50_000_000,
  );
  const marker = `\n__ITOPS_STATUS_${randomUUID()}__:`;
  const args = [
    "--silent",
    "--show-error",
    "--no-progress-meter",
    "--negotiate",
    "--user",
    ":",
    "--request",
    options.method ?? "GET",
    "--connect-timeout",
    String(Math.max(1, Math.ceil(timeoutMs / 1_000))),
    "--max-time",
    String(Math.max(1, Math.ceil(timeoutMs / 1_000))),
    "--max-redirs",
    "0",
    "--proto",
    "=https",
    "--proto-redir",
    "=https",
    "--tlsv1.2",
    "--header",
    "Accept: application/json",
    "--header",
    "User-Agent: itops-kiro-harness/1.3.1",
  ];
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    args.push("--header", `${name}: ${value}`);
  }
  const caBundle = env("SPLUNK_CURL_CA_BUNDLE");
  if (caBundle) args.push("--cacert", caBundle);
  if (options.body !== undefined) args.push("--data-raw", options.body);
  args.push("--write-out", `${marker}%{http_code}`, url.toString());

  const { stdout } = await executeBoundedProcess(command, args, {
    timeoutMs: timeoutMs + 5_000,
    maxBuffer: maxBytes + 65_536,
  });
  const response = parseCurlResponse(stdout, marker);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Kerberos HTTP ${response.status}: ${redactText(response.body.slice(0, 2_000))}`,
    );
  }
  if (Buffer.byteLength(response.body, "utf8") > maxBytes) {
    throw new Error(`HTTP response exceeded ${maxBytes} bytes`);
  }
  return response.body;
}

export async function fetchNegotiateJson<T>(
  base: URL,
  path: string,
  options: NegotiateRequest = {},
): Promise<T> {
  const text = await fetchNegotiateText(base, path, options);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Kerberos-authenticated API returned invalid JSON");
  }
}
