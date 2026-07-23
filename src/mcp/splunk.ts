import { z } from "zod";
import { assertReadOnlySpl } from "../common/guards.js";
import { enabled, env, envInteger, requireSafeBaseUrl } from "../common/env.js";
import { bearer, fetchJson, fetchText, withQuery } from "../common/http.js";
import { createServer, readOnlyAnnotations, runTool, startServer } from "../common/mcp.js";
import { generateDashboardXml } from "../splunk/dashboard.js";

const SERVER = "itops-splunk";
const server = createServer(
  SERVER,
  "Bounded read-only Splunk searches and offline Simple XML dashboard generation. No saved-search, dashboard upload, lookup write, email, or delete tools exist.",
);

function assertEnabled(): void {
  if (!enabled("SPLUNK")) throw new Error("Splunk integration is disabled");
}

function authHeaders(): Record<string, string> {
  return bearer(
    env("SPLUNK_TOKEN", { required: true }),
    env("SPLUNK_AUTH_SCHEME", { defaultValue: "Bearer", allowPlaceholder: true }),
  );
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
      const result = await fetchText(
        requireSafeBaseUrl("SPLUNK_BASE_URL"),
        env("SPLUNK_EXPORT_PATH", {
          defaultValue: "/services/search/v2/jobs/export",
          allowPlaceholder: true,
        }),
        {
          method: "POST",
          headers: {
            ...authHeaders(),
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
      return fetchJson(
        requireSafeBaseUrl("SPLUNK_BASE_URL"),
        withQuery("/services/data/indexes", { output_mode: "json", count: input.count }),
        { headers: authHeaders() },
      );
    }),
);

server.registerTool(
  "splunk_generate_dashboard_xml",
  {
    title: "Generate Splunk Simple XML offline",
    description:
      "Generate a classic Splunk Simple XML dashboard locally in memory. The XML is returned but never uploaded to Splunk.",
    inputSchema: z.object({
      title: z.string().min(1).max(200),
      description: z.string().max(1_000).optional(),
      panels: z
        .array(
          z.object({
            title: z.string().min(1).max(200),
            search: z.string().min(1).max(20_000),
            earliest: z.string().min(1).max(100).default("-24h"),
            latest: z.string().min(1).max(100).default("now"),
            visualization: z.enum(["table", "chart", "single", "event"]).default("table"),
            chartType: z.enum(["line", "area", "bar", "column", "pie"]).optional(),
          }),
        )
        .min(1)
        .max(24),
    }),
    annotations: {
      ...readOnlyAnnotations,
      openWorldHint: false,
    },
  },
  async (input) =>
    runTool(SERVER, "splunk_generate_dashboard_xml", { panelCount: input.panels.length }, async () => ({
      xml: generateDashboardXml(input.title, input.description, input.panels),
      uploadPerformed: false,
      format: "Splunk Simple XML 1.1",
    })),
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
      const response = await fetchJson(
        requireSafeBaseUrl("SPLUNK_BASE_URL"),
        "/services/server/info?output_mode=json&count=1",
        { headers: authHeaders() },
      );
      return { status: "ok", response };
    }),
);

await startServer(server);
