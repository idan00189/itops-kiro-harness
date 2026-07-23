import { z } from "zod";
import { assertNoControlCharacters, enabled, env, envInteger, requireSafeBaseUrl } from "../common/env.js";
import { basic, bearer, fetchJson, withQuery } from "../common/http.js";
import {
  createServer,
  localWriteAnnotations,
  readOnlyAnnotations,
  runTool,
  startServer,
} from "../common/mcp.js";
import { parseIncidentReportJson, reportWriteToolInputSchema } from "../report/model.js";
import { writeIncidentReport, writeSplunkDashboardArtifact } from "../report/write.js";

const SERVER = "itops-core";
const server = createServer(
  SERVER,
  "Read-only Jira and Confluence evidence access plus narrowly scoped local Hebrew report and Splunk XML artifact writers. No external mutation tools are exposed.",
);

function atlassianHeaders(): Record<string, string> {
  const mode = env("ATLASSIAN_AUTH_MODE", { defaultValue: "basic", allowPlaceholder: true }).toLowerCase();
  if (mode === "basic") {
    return basic(
      env("ATLASSIAN_EMAIL", { required: true }),
      env("ATLASSIAN_API_TOKEN", { required: true }),
    );
  }
  if (mode === "bearer") return bearer(env("ATLASSIAN_API_TOKEN", { required: true }));
  throw new Error("ATLASSIAN_AUTH_MODE must be basic or bearer");
}

function assertAtlassianEnabled(): void {
  if (!enabled("ATLASSIAN")) throw new Error("Atlassian integration is disabled");
}

server.registerTool(
  "jira_search",
  {
    title: "Search Jira issues (read-only)",
    description: "Run bounded JQL search and return visible issues. This is a query-only operation.",
    inputSchema: z.object({
      jql: z.string().min(1).max(5_000),
      fields: z
        .array(z.string().regex(/^[A-Za-z0-9_.-]+$/))
        .max(50)
        .default(["summary", "status", "priority", "assignee", "created", "updated", "labels"]),
      maxResults: z.number().int().min(1).max(100).default(50),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "jira_search", input, async () => {
      assertAtlassianEnabled();
      assertNoControlCharacters(input.jql, "JQL");
      const base = requireSafeBaseUrl("ATLASSIAN_BASE_URL");
      const path = env("ATLASSIAN_JIRA_SEARCH_PATH", {
        defaultValue: "/rest/api/3/search/jql",
        allowPlaceholder: true,
      });
      return fetchJson(
        base,
        withQuery(path, {
          jql: input.jql,
          fields: input.fields.join(","),
          maxResults: Math.min(input.maxResults, envInteger("ATLASSIAN_MAX_RESULTS", 100, 1, 100)),
        }),
        { headers: atlassianHeaders() },
      );
    }),
);

server.registerTool(
  "jira_get_issue",
  {
    title: "Get Jira issue (read-only)",
    description: "Retrieve one Jira issue by key with a bounded field list.",
    inputSchema: z.object({
      issueKey: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*-\d+$/),
      fields: z
        .array(z.string().regex(/^[A-Za-z0-9_.-]+$/))
        .max(50)
        .default([
          "summary",
          "description",
          "status",
          "priority",
          "assignee",
          "reporter",
          "created",
          "updated",
          "labels",
          "comment",
        ]),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "jira_get_issue", input, async () => {
      assertAtlassianEnabled();
      const base = requireSafeBaseUrl("ATLASSIAN_BASE_URL");
      return fetchJson(
        base,
        withQuery(`/rest/api/3/issue/${encodeURIComponent(input.issueKey)}`, {
          fields: input.fields.join(","),
        }),
        { headers: atlassianHeaders() },
      );
    }),
);

server.registerTool(
  "confluence_search",
  {
    title: "Search Confluence (read-only)",
    description: "Run a bounded CQL search against visible Confluence content.",
    inputSchema: z.object({
      cql: z.string().min(1).max(5_000),
      limit: z.number().int().min(1).max(50).default(25),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "confluence_search", input, async () => {
      assertAtlassianEnabled();
      assertNoControlCharacters(input.cql, "CQL");
      const base = requireSafeBaseUrl("ATLASSIAN_BASE_URL");
      const path = env("ATLASSIAN_CONFLUENCE_SEARCH_PATH", {
        defaultValue: "/wiki/rest/api/search",
        allowPlaceholder: true,
      });
      return fetchJson(
        base,
        withQuery(path, {
          cql: input.cql,
          limit: Math.min(input.limit, envInteger("ATLASSIAN_MAX_RESULTS", 100, 1, 100)),
          expand: "content.version,content.space",
        }),
        { headers: atlassianHeaders() },
      );
    }),
);

server.registerTool(
  "confluence_get_page",
  {
    title: "Get Confluence page (read-only)",
    description: "Retrieve one visible Confluence page and its storage-format body.",
    inputSchema: z.object({
      pageId: z.string().regex(/^\d{1,30}$/),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "confluence_get_page", input, async () => {
      assertAtlassianEnabled();
      const base = requireSafeBaseUrl("ATLASSIAN_BASE_URL");
      return fetchJson(
        base,
        withQuery(`/wiki/rest/api/content/${input.pageId}`, {
          expand: "body.storage,version,space,metadata.labels",
        }),
        { headers: atlassianHeaders() },
      );
    }),
);

server.registerTool(
  "report_write",
  {
    title: "Write Hebrew incident report locally",
    description:
      "Validate and atomically write a structured Hebrew incident report under the local reports directory. Markdown is the default; HTML is optional.",
    inputSchema: reportWriteToolInputSchema,
    annotations: localWriteAnnotations,
  },
  async (input) =>
    runTool(
      SERVER,
      "report_write",
      { format: input.format, reportJsonBytes: Buffer.byteLength(input.reportJson, "utf8") },
      () => {
        const report = parseIncidentReportJson(input.reportJson);
        return writeIncidentReport(report, input.format);
      },
    ),
);

server.registerTool(
  "artifact_write_splunk_dashboard",
  {
    title: "Write generated Splunk dashboard XML locally",
    description:
      "Atomically save already-generated Simple XML under artifacts/splunk. This never uploads or changes a Splunk dashboard.",
    inputSchema: z.object({
      filename: z.string().min(5).max(105),
      xml: z.string().min(20).max(1_000_000),
    }),
    annotations: localWriteAnnotations,
  },
  async (input) =>
    runTool(SERVER, "artifact_write_splunk_dashboard", { filename: input.filename }, () =>
      writeSplunkDashboardArtifact(input.filename, input.xml),
    ),
);

server.registerTool(
  "itops_core_health",
  {
    title: "Check core integration health",
    description: "Verify Jira and Confluence read access without changing external state.",
    inputSchema: z.object({}),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "itops_core_health", input, async () => {
      if (!enabled("ATLASSIAN")) return { status: "disabled", integration: "atlassian" };
      const base = requireSafeBaseUrl("ATLASSIAN_BASE_URL");
      const headers = atlassianHeaders();
      const [jira, confluence] = await Promise.all([
        fetchJson(base, "/rest/api/3/myself", { headers }),
        fetchJson(base, "/wiki/rest/api/space?limit=1", { headers }),
      ]);
      return { status: "ok", jira, confluence };
    }),
);

await startServer(server);
