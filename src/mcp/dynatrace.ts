import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";
import { z } from "zod";
import { assertSafeDql, matchesAllowlist } from "../common/guards.js";
import {
  enabled,
  env,
  envBoolean,
  envCsv,
  envInteger,
  requireSafeBaseUrl,
} from "../common/env.js";
import { bearer, fetchJson, withQuery } from "../common/http.js";
import { createServer, readOnlyAnnotations, runTool, startServer } from "../common/mcp.js";

const SERVER = "itops-dynatrace";
const server = createServer(
  SERVER,
  "Read-only Dynatrace Environment API v2 and Grail DQL Query API access. Only problems, entities, metric reads, DQL query execution/polling, and health checks are exposed.",
);

type OAuthCache = { token: string; expiresAt: number };
let oauthCache: OAuthCache | undefined;

function assertEnabled(): void {
  if (!enabled("DYNATRACE")) throw new Error("Dynatrace integration is disabled");
}

function environmentHeaders(): Record<string, string> {
  return bearer(env("DYNATRACE_API_TOKEN", { required: true }), "Api-Token");
}

function assertDqlSources(query: string): void {
  const allowlist = envCsv(
    "DYNATRACE_DQL_TABLE_ALLOWLIST",
    "logs,spans,events,bizevents,metrics,dt.entity.*",
  );
  for (const match of query.matchAll(/\bfetch\s+([A-Za-z0-9_.-]+)/gi)) {
    const source = match[1] ?? "";
    if (!matchesAllowlist(source, allowlist)) {
      throw new Error(`DQL source ${source} is outside DYNATRACE_DQL_TABLE_ALLOWLIST`);
    }
  }
}

async function platformToken(): Promise<string> {
  const direct = env("DYNATRACE_PLATFORM_TOKEN");
  if (direct) return direct;
  if (oauthCache && oauthCache.expiresAt > Date.now() + 30_000) return oauthCache.token;
  const clientId = env("DYNATRACE_OAUTH_CLIENT_ID", { required: true });
  const clientSecret = env("DYNATRACE_OAUTH_CLIENT_SECRET", { required: true });
  const scope = env("DYNATRACE_OAUTH_SCOPES", { required: true });
  const scopeValues = scope.split(/\s+/).filter(Boolean);
  if (scopeValues.some((item) => /(?:write|delete|manage|admin)/i.test(item))) {
    throw new Error("DYNATRACE_OAUTH_SCOPES contains a non-read scope");
  }
  const endpoint = requireSafeBaseUrl("DYNATRACE_OAUTH_TOKEN_URL");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope,
  });
  const response = await fetchJson<{ access_token: string; expires_in?: number }>(
    new URL(endpoint.origin),
    `${endpoint.pathname}${endpoint.search}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      retries: 1,
    },
  );
  if (!response.access_token) throw new Error("Dynatrace OAuth response omitted access_token");
  oauthCache = {
    token: response.access_token,
    expiresAt: Date.now() + (response.expires_in ?? 300) * 1_000,
  };
  return oauthCache.token;
}

server.registerTool(
  "dynatrace_problems",
  {
    title: "List Dynatrace problems (read-only)",
    description: "Read a bounded page of Dynatrace problems and optional root-cause evidence fields.",
    inputSchema: z.object({
      from: z.string().max(100).default("now-2h"),
      to: z.string().max(100).default("now"),
      problemSelector: z.string().max(5_000).optional(),
      entitySelector: z.string().max(5_000).optional(),
      pageSize: z.number().int().min(1).max(500).default(100),
      includeEvidence: z.boolean().default(true),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "dynatrace_problems", input, async () => {
      assertEnabled();
      return fetchJson(
        requireSafeBaseUrl("DYNATRACE_ENV_URL"),
        withQuery("/api/v2/problems", {
          from: input.from,
          to: input.to,
          problemSelector: input.problemSelector,
          entitySelector: input.entitySelector,
          pageSize: input.pageSize,
          fields: input.includeEvidence ? "evidenceDetails,impactAnalysis" : undefined,
        }),
        { headers: environmentHeaders() },
      );
    }),
);

server.registerTool(
  "dynatrace_entities",
  {
    title: "List Dynatrace entities (read-only)",
    description: "Read monitored entities using a bounded entity selector and optional fields.",
    inputSchema: z.object({
      entitySelector: z.string().min(1).max(5_000),
      from: z.string().max(100).default("now-2h"),
      to: z.string().max(100).default("now"),
      fields: z.string().max(2_000).optional(),
      pageSize: z.number().int().min(1).max(500).default(100),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "dynatrace_entities", input, async () => {
      assertEnabled();
      return fetchJson(
        requireSafeBaseUrl("DYNATRACE_ENV_URL"),
        withQuery("/api/v2/entities", {
          entitySelector: input.entitySelector,
          from: input.from,
          to: input.to,
          fields: input.fields,
          pageSize: input.pageSize,
        }),
        { headers: environmentHeaders() },
      );
    }),
);

server.registerTool(
  "dynatrace_metrics_query",
  {
    title: "Query Dynatrace metrics (read-only)",
    description: "Read bounded metric series using Dynatrace metric selector syntax.",
    inputSchema: z.object({
      metricSelector: z.string().min(1).max(10_000),
      from: z.string().max(100).default("now-2h"),
      to: z.string().max(100).default("now"),
      resolution: z.string().max(100).default("Inf"),
      entitySelector: z.string().max(5_000).optional(),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "dynatrace_metrics_query", input, async () => {
      assertEnabled();
      return fetchJson(
        requireSafeBaseUrl("DYNATRACE_ENV_URL"),
        withQuery("/api/v2/metrics/query", {
          metricSelector: input.metricSelector,
          from: input.from,
          to: input.to,
          resolution: input.resolution,
          entitySelector: input.entitySelector,
        }),
        { headers: environmentHeaders() },
      );
    }),
);

server.registerTool(
  "dynatrace_dql_query",
  {
    title: "Query Dynatrace Grail with DQL (read-only)",
    description:
      "Execute and poll one bounded DQL query. Data source allowlists and OAuth read-scope checks are enforced.",
    inputSchema: z.object({
      query: z.string().min(1).max(20_000),
      maxRecords: z.number().int().min(1).max(5_000).default(500),
      maxResultBytes: z.number().int().min(10_000).max(10_000_000).default(1_000_000),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "dynatrace_dql_query", { query: input.query }, async () => {
      assertEnabled();
      if (!envBoolean("DYNATRACE_DQL_ENABLED", true)) {
        throw new Error("Dynatrace DQL integration is disabled");
      }
      const query = assertSafeDql(input.query);
      assertDqlSources(query);
      const base = requireSafeBaseUrl("DYNATRACE_PLATFORM_URL");
      const headers = {
        ...bearer(await platformToken()),
        "Content-Type": "application/json",
      };
      type QueryResponse = {
        state: "NOT_STARTED" | "RUNNING" | "SUCCEEDED" | "RESULT_GONE" | "CANCELLED" | "FAILED";
        progress?: number;
        requestToken?: string;
        result?: unknown;
        error?: unknown;
      };
      let response = await fetchJson<QueryResponse>(
        base,
        "/platform/storage/query/v1/query:execute",
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            query,
            maxResultRecords: Math.min(
              input.maxRecords,
              envInteger("DYNATRACE_DQL_MAX_RECORDS", 1_000, 1, 10_000),
            ),
            maxResultBytes: Math.min(
              input.maxResultBytes,
              envInteger("DYNATRACE_DQL_MAX_BYTES", 2_000_000, 10_000, 20_000_000),
            ),
            enablePreview: false,
          }),
          timeoutMs: envInteger("DYNATRACE_QUERY_TIMEOUT_MS", 60_000, 1_000, 300_000),
          retries: 1,
        },
      );
      const deadline =
        Date.now() + envInteger("DYNATRACE_QUERY_TIMEOUT_MS", 60_000, 1_000, 300_000);
      while (["NOT_STARTED", "RUNNING"].includes(response.state)) {
        if (!response.requestToken) throw new Error("Dynatrace DQL response omitted requestToken");
        if (Date.now() >= deadline) throw new Error("Dynatrace DQL query timed out");
        await delay(500);
        response = await fetchJson<QueryResponse>(
          base,
          withQuery("/platform/storage/query/v1/query:poll", {
            "request-token": response.requestToken,
            "request-timeout": 1_000,
          }),
          { headers, timeoutMs: 10_000, retries: 1 },
        );
      }
      if (response.state !== "SUCCEEDED") {
        throw new Error(`Dynatrace DQL ended in state ${response.state}: ${JSON.stringify(response.error ?? {})}`);
      }
      return response;
    }),
);

server.registerTool(
  "dynatrace_health",
  {
    title: "Check Dynatrace read connection",
    description: "Verify Environment API read access and report whether Grail DQL is configured.",
    inputSchema: z.object({}),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "dynatrace_health", input, async () => {
      if (!enabled("DYNATRACE")) return { status: "disabled", integration: "dynatrace" };
      const problems = await fetchJson(
        requireSafeBaseUrl("DYNATRACE_ENV_URL"),
        "/api/v2/problems?pageSize=1&from=now-5m&to=now",
        { headers: environmentHeaders() },
      );
      return {
        status: "ok",
        environmentApi: problems,
        dqlEnabled: envBoolean("DYNATRACE_DQL_ENABLED", true),
        dqlConfigured: Boolean(env("DYNATRACE_PLATFORM_URL", { allowPlaceholder: true })),
      };
    }),
);

await startServer(server);
