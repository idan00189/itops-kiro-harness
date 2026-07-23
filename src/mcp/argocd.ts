import { z } from "zod";
import { assertSafeIdentifier, matchesAllowlist } from "../common/guards.js";
import {
  enabled,
  env,
  envBoolean,
  envChoice,
  envCsv,
  envInteger,
  requireSafeBaseUrl,
} from "../common/env.js";
import { bearer, fetchJson, withQuery } from "../common/http.js";
import { createServer, readOnlyAnnotations, runTool, startServer } from "../common/mcp.js";
import { configuredExecutable, executeBoundedProcess } from "../common/process.js";

const SERVER = "itops-argocd";
const server = createServer(
  SERVER,
  "Read-only Argo CD application health, sync, drift, resource-tree, managed-resource, and event inspection. Authentication can use a token or a Microsoft Entra-backed Argo CD CLI SSO session. Sync, refresh, rollback, action, delete, and exec tools do not exist.",
);

type CliTokenCache = { token: string; expiresAt: number };
let cliTokenCache: CliTokenCache | undefined;

function assertEnabled(): void {
  if (!enabled("ARGOCD")) throw new Error("Argo CD integration is disabled");
}

function authMode(): "cli-sso" | "token" {
  return envChoice("ARGOCD_AUTH_MODE", ["cli-sso", "token"] as const, "cli-sso");
}

function jwtExpiration(token: string): number | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { exp?: unknown };
    return typeof decoded.exp === "number" ? decoded.exp * 1_000 : undefined;
  } catch {
    return undefined;
  }
}

async function cliSessionToken(): Promise<string> {
  if (cliTokenCache && cliTokenCache.expiresAt > Date.now() + 60_000) {
    return cliTokenCache.token;
  }
  const command = configuredExecutable("ARGOCD_CLI_PATH", "argocd.exe", [
    "argocd",
    "argocd.exe",
  ]);
  const args = ["account", "session-token"];
  const context = env("ARGOCD_CLI_CONTEXT", { required: true });
  args.push("--argocd-context", context);
  const config = env("ARGOCD_CLI_CONFIG");
  if (config) args.push("--config", config);
  if (envBoolean("ARGOCD_CLI_GRPC_WEB", false)) args.push("--grpc-web");
  const grpcWebRootPath = env("ARGOCD_CLI_GRPC_WEB_ROOT_PATH");
  if (grpcWebRootPath) args.push("--grpc-web-root-path", grpcWebRootPath);
  const { stdout } = await executeBoundedProcess(command, args, {
    timeoutMs: envInteger("ARGOCD_CLI_TIMEOUT_MS", 30_000, 1_000, 120_000),
    maxBuffer: 64_000,
  });
  const token = stdout.trim();
  if (!token || /\s/.test(token) || token.length > 16_384) {
    throw new Error(
      "Argo CD CLI did not return a valid SSO session token; run scripts\\Initialize-ItOpsAuth.ps1",
    );
  }
  cliTokenCache = {
    token,
    expiresAt: jwtExpiration(token) ?? Date.now() + 60_000,
  };
  return token;
}

async function headers(): Promise<Record<string, string>> {
  if (authMode() === "token") {
    return bearer(env("ARGOCD_TOKEN", { required: true }));
  }
  return bearer(await cliSessionToken());
}

function assertProject(project: string | undefined): string | undefined {
  const allowlist = envCsv("ARGOCD_PROJECT_ALLOWLIST", "*");
  if (!project) {
    if (allowlist.includes("*")) return undefined;
    throw new Error("Argo CD project is required when ARGOCD_PROJECT_ALLOWLIST is narrowed");
  }
  const safe = assertSafeIdentifier(project, "Argo CD project");
  if (!matchesAllowlist(safe, allowlist)) {
    throw new Error(`Argo CD project ${safe} is outside ARGOCD_PROJECT_ALLOWLIST`);
  }
  return safe;
}

function filterApplications(
  response: { items?: Array<{ metadata?: { name?: string }; spec?: { project?: string } }>; [key: string]: unknown },
): typeof response {
  if (!Array.isArray(response.items)) return response;
  const applications = envCsv("ARGOCD_APPLICATION_ALLOWLIST", "*");
  const projects = envCsv("ARGOCD_PROJECT_ALLOWLIST", "*");
  return {
    ...response,
    items: response.items.filter((item) => {
      const name = item.metadata?.name;
      const project = item.spec?.project;
      return Boolean(
        name &&
          matchesAllowlist(name, applications) &&
          project &&
          matchesAllowlist(project, projects),
      );
    }),
  };
}

function assertApplication(application: string): string {
  const safe = assertSafeIdentifier(application, "Argo CD application");
  if (!matchesAllowlist(safe, envCsv("ARGOCD_APPLICATION_ALLOWLIST", "*"))) {
    throw new Error(`Argo CD application ${safe} is outside ARGOCD_APPLICATION_ALLOWLIST`);
  }
  return safe;
}

server.registerTool(
  "argocd_list_applications",
  {
    title: "List Argo CD applications (read-only)",
    description: "List visible Argo CD applications, optionally restricted to one allowlisted project.",
    inputSchema: z.object({
      project: z.string().max(128).optional(),
      selector: z.string().max(1_000).optional(),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "argocd_list_applications", input, async () => {
      assertEnabled();
      const project = assertProject(input.project);
      const response = (await fetchJson(
        requireSafeBaseUrl("ARGOCD_BASE_URL"),
        withQuery("/api/v1/applications", {
          projects: project,
          selector: input.selector,
        }),
        { headers: await headers() },
      )) as {
        items?: Array<{ metadata?: { name?: string }; spec?: { project?: string } }>;
        [key: string]: unknown;
      };
      return filterApplications(response);
    }),
);

server.registerTool(
  "argocd_get_application",
  {
    title: "Get Argo CD application (read-only)",
    description: "Read one application including source revision, sync status, health, operation history, and conditions.",
    inputSchema: z.object({
      application: z.string().min(1).max(128),
      project: z.string().max(128).optional(),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "argocd_get_application", input, async () => {
      assertEnabled();
      return fetchJson(
        requireSafeBaseUrl("ARGOCD_BASE_URL"),
        withQuery(`/api/v1/applications/${encodeURIComponent(assertApplication(input.application))}`, {
          project: assertProject(input.project),
        }),
        { headers: await headers() },
      );
    }),
);

server.registerTool(
  "argocd_resource_tree",
  {
    title: "Get Argo CD resource tree (read-only)",
    description: "Read the live application resource tree with health and sync state.",
    inputSchema: z.object({
      application: z.string().min(1).max(128),
      project: z.string().max(128).optional(),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "argocd_resource_tree", input, async () => {
      assertEnabled();
      return fetchJson(
        requireSafeBaseUrl("ARGOCD_BASE_URL"),
        withQuery(
          `/api/v1/applications/${encodeURIComponent(assertApplication(input.application))}/resource-tree`,
          { project: assertProject(input.project) },
        ),
        { headers: await headers() },
      );
    }),
);

server.registerTool(
  "argocd_managed_resources",
  {
    title: "Get Argo CD managed resources (read-only)",
    description: "Read desired/live managed-resource state for drift analysis without refreshing or syncing.",
    inputSchema: z.object({
      application: z.string().min(1).max(128),
      project: z.string().max(128).optional(),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "argocd_managed_resources", input, async () => {
      assertEnabled();
      return fetchJson(
        requireSafeBaseUrl("ARGOCD_BASE_URL"),
        withQuery(
          `/api/v1/applications/${encodeURIComponent(assertApplication(input.application))}/managed-resources`,
          { project: assertProject(input.project) },
        ),
        { headers: await headers() },
      );
    }),
);

server.registerTool(
  "argocd_application_events",
  {
    title: "Get Argo CD application events (read-only)",
    description: "Read Kubernetes events surfaced by Argo CD for one allowlisted application.",
    inputSchema: z.object({
      application: z.string().min(1).max(128),
      project: z.string().max(128).optional(),
      resourceNamespace: z.string().max(253).optional(),
      resourceName: z.string().max(253).optional(),
      resourceUid: z.string().max(128).optional(),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "argocd_application_events", input, async () => {
      assertEnabled();
      return fetchJson(
        requireSafeBaseUrl("ARGOCD_BASE_URL"),
        withQuery(
          `/api/v1/applications/${encodeURIComponent(assertApplication(input.application))}/events`,
          {
            project: assertProject(input.project),
            resourceNamespace: input.resourceNamespace,
            resourceName: input.resourceName,
            resourceUID: input.resourceUid,
          },
        ),
        { headers: await headers() },
      );
    }),
);

server.registerTool(
  "argocd_health",
  {
    title: "Check Argo CD read connection",
    description: "Read Argo CD version and a filtered application list to verify token access.",
    inputSchema: z.object({}),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "argocd_health", input, async () => {
      if (!enabled("ARGOCD")) return { status: "disabled", integration: "argocd" };
      const base = requireSafeBaseUrl("ARGOCD_BASE_URL");
      const projectPatterns = envCsv("ARGOCD_PROJECT_ALLOWLIST", "*");
      const exactProject =
        projectPatterns.length === 1 && !projectPatterns[0]?.includes("*")
          ? projectPatterns[0]
          : undefined;
      const authorization = await headers();
      const [version, applicationsResponse] = await Promise.all([
        fetchJson(base, "/api/version", { headers: authorization }),
        fetchJson(
          base,
          withQuery("/api/v1/applications", { projects: exactProject }),
          { headers: authorization },
        ),
      ]);
      const applications = filterApplications(
        applicationsResponse as {
          items?: Array<{ metadata?: { name?: string }; spec?: { project?: string } }>;
          [key: string]: unknown;
        },
      );
      return { status: "ok", authentication: authMode(), version, applications };
    }),
);

await startServer(server);
