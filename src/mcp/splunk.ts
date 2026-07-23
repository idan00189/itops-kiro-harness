import { z } from "zod";
import { assertReadOnlySpl } from "../common/guards.js";
import {
  enabled,
  env,
  envChoice,
  envInteger,
  requireSafeBaseUrlWithPort,
} from "../common/env.js";
import { bearer, fetchJson, fetchText, withQuery } from "../common/http.js";
import { createServer, readOnlyAnnotations, runTool, startServer } from "../common/mcp.js";
import { fetchNegotiateJson, fetchNegotiateText } from "../common/negotiate.js";
import {
  generateDashboardXml,
  parseDashboardPanelsJson,
  splunkDashboardToolInputSchema,
} from "../splunk/dashboard.js";

const SERVER = "itops-splunk";
const server = createServer(
  SERVER,
  "Bounded read-only Splunk searches using Windows Kerberos/SPNEGO or a token, plus offline Simple XML dashboard generation. No saved-search, dashboard upload, lookup write, email, or delete tools exist.",
);

function assertEnabled(): void {
  if (!enabled("SPLUNK")) throw new Error("Splunk integration is disabled");
}

function authHeaders(): Record<string, string> {
  const scheme = envChoice(
    "SPLUNK_AUTH_SCHEME",
    ["bearer", "splunk"] as const,
    "bearer",
  );
  return bearer(
    env("SPLUNK_TOKEN", { required: true }),
    scheme === "splunk" ? "Splunk" : "Bearer",
  );
}

function authMode(): "kerberos" | "token" {
  return envChoice("SPLUNK_AUTH_MODE", ["kerberos", "token"] as const, "kerberos");
}

function splunkBaseUrl(): URL {
  return requireSafeBaseUrlWithPort("SPLUNK_BASE_URL", "SPLUNK_PORT");
}

async function splunkText(
  path: string,
  options: {
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    retries?: number;
  } = {},
): Promise<string> {
  const base = splunkBaseUrl();
  if (authMode() === "kerberos") {
    return fetchNegotiateText(base, path, options);
  }
  return fetchText(base, path, {
    ...options,
    headers: { ...authHeaders(), ...options.headers },
  });
}

async function splunkJson<T>(
  path: string,
  options: {
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    retries?: number;
  } = {},
): Promise<T> {
  const base = splunkBaseUrl();
  if (authMode() === "kerberos") {
    return fetchNegotiateJson<T>(base, path, options);
  }
  return fetchJson<T>(base, path, {
    ...options,
    headers: { ...authHeaders(), ...options.headers },
  });
}

function parseExport(text: string, limit: number): unknown[] {
  const records: unknown[] = [];
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    try {
      const parsed = JSON.parse(line) as { result?: unknown; messages?: unknown };
      if (parsed.result !== undefined) records.push(parsed.result);
      else if (parsed.messages !== undefined) records.push({ messages: parsed.messages });
      else records.push(parsed);
      if (records.length >= limit) break;
    } catch {
      if (records.length === 0) {
        try {
          const parsed = JSON.parse(text) as { results?: unknown[] };
          return (parsed.results ?? [parsed]).slice(0, limit);
        } catch {
          throw new Error("Splunk export endpoint returned invalid JSON");
        }
      }
    }
  }
  return records;
}

server.registerTool(
  "splunk_search",
  {
    title: "Search Splunk logs (read-only)",
    description:
      "Run one bounded SPL search through search/v2/jobs/export. Mutating and exfiltration-oriented SPL commands are rejected.",
    inputSchema: z.object({
      search: z.string().min(1).max(20_000),
      earliestTime: z.string().min(1).max(100).default("-60m"),
      latestTime: z.string().min(1).max(100).default("now"),
      maxResults: z.number().int().min(1).max(1_000).default(200),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "splunk_search", input, async () => {
      assertEnabled();
      const search = assertReadOnlySpl(input.search);
      const maxResults = Math.min(
        input.maxResults,
        envInteger("SPLUNK_MAX_RESULTS", 500, 1, 10_000),
      );
      const body = new URLSearchParams({
        search: `search ${search}`,
        earliest_time: input.earliestTime,
        latest_time: input.latestTime,
        output_mode: "json",
        max_count: String(maxResults),
        adhoc_search_level: "fast",
      });
      const result = await splunkText(
        env("SPLUNK_EXPORT_PATH", {
          defaultValue: "/services/search/v2/jobs/export",
          allowPlaceholder: true,
        }),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: body.toString(),
          timeoutMs: envInteger("SPLUNK_SEARCH_TIMEOUT_MS", 60_000, 1_000, 300_000),
          retries: 1,
        },
      );
      const records = parseExport(result, maxResults);
      return {
        records,
        resultCount: records.length,
        earliestTime: input.earliestTime,
        latestTime: input.latestTime,
        truncated: records.length >= maxResults,
      };
    }),
);

server.registerTool(
  "splunk_list_indexes",
  {
    title: "List visible Splunk indexes",
    description: "List only indexes visible to the configured read-only Splunk service account.",
    inputSchema: z.object({
      count: z.number().int().min(1).max(500).default(100),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "splunk_list_indexes", input, async () => {
      assertEnabled();
      return splunkJson(
        withQuery("/services/data/indexes", { output_mode: "json", count: input.count }),
      );
    }),
);

server.registerTool(
  "splunk_generate_dashboard_xml",
  {
    title: "Generate Splunk Simple XML offline",
    description:
      'Generate a classic Splunk Simple XML dashboard locally in memory. panelsJson must be a JSON array of objects with title, search, earliest, latest, visualization, and optional chartType. The XML is returned but never uploaded to Splunk.',
    inputSchema: splunkDashboardToolInputSchema,
    annotations: {
      ...readOnlyAnnotations,
      openWorldHint: false,
    },
  },
  async (input) =>
    runTool(
      SERVER,
      "splunk_generate_dashboard_xml",
      { panelsJsonBytes: Buffer.byteLength(input.panelsJson, "utf8") },
      async () => {
        const panels = parseDashboardPanelsJson(input.panelsJson);
        return {
          xml: generateDashboardXml(input.title, input.description, panels),
          panelCount: panels.length,
          uploadPerformed: false,
          format: "Splunk Simple XML 1.1",
        };
      },
    ),
);

server.registerTool(
  "splunk_health",
  {
    title: "Check Splunk read connection",
    description: "Read Splunk server metadata to verify connectivity and token validity.",
    inputSchema: z.object({}),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "splunk_health", input, async () => {
      if (!enabled("SPLUNK")) return { status: "disabled", integration: "splunk" };
      const response = await splunkJson(
        "/services/server/info?output_mode=json&count=1",
      );
      return { status: "ok", authentication: authMode(), response };
    }),
);

await startServer(server);
