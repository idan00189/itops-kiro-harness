import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type RecordedRequest = {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
};

type RunningMcp = {
  client: Client;
  close: () => Promise<void>;
};

let origin = "";
let qaDirectory = "";
const requests: RecordedRequest[] = [];

function respondJson(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

function mockHandler(request: IncomingMessage, response: ServerResponse): void {
  const chunks: Buffer[] = [];
  request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  request.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    requests.push({
      method: request.method ?? "",
      url: request.url ?? "",
      headers: request.headers,
      body,
    });
    const url = new URL(request.url ?? "/", origin);
    const path = url.pathname;

    if (path === "/services/search/v2/jobs/export") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"result":{"level":"ERROR","count":2}}\n');
      return;
    }
    if (
      /\/diff\/[a-f0-9]{40,64}$/.test(path) ||
      /\/pullrequests\/7\/diff$/.test(path) ||
      /\/jobs\/42\/trace$/.test(path)
    ) {
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end("safe bounded source or CI text");
      return;
    }
    if (/\/src\/[a-f0-9]{40,64}\/src\/index\.ts$/.test(path)) {
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end("export const mobile = true;\n");
      return;
    }
    if (/\/repository\/files\//.test(path)) {
      respondJson(response, {
        file_name: "index.ts",
        file_path: "src/index.ts",
        size: 28,
        encoding: "base64",
        content: Buffer.from("export const mobile = true;\n").toString("base64"),
        commit_id: "a".repeat(40),
      });
      return;
    }
    if (/\/pullrequests\/7$/.test(path)) {
      const root = path.replace(/\/pullrequests\/7$/, "");
      respondJson(response, {
        id: 7,
        merge_commit: { hash: "a".repeat(40) },
        links: {
          diff: { href: `${origin}${root}/pullrequests/7/diff` },
          diffstat: { href: `${origin}${root}/pullrequests/7/diffstat` },
        },
      });
      return;
    }
    if (/\/2\.0\/repositories\/team\/mobile\/pipelines\/(?!$)(?!.*\/steps$)/.test(path)) {
      respondJson(response, {
        uuid: "{qa-pipeline}",
        target: { commit: { hash: "a".repeat(40) } },
      });
      return;
    }
    if (/\/api\/v4\/projects\/team%2Fmobile\/merge_requests\/7$/.test(path)) {
      respondJson(response, { iid: 7, merge_commit_sha: "a".repeat(40) });
      return;
    }
    if (/\/api\/v4\/projects\/team%2Fmobile\/pipelines\/42$/.test(path)) {
      respondJson(response, { id: 42, sha: "a".repeat(40) });
      return;
    }
    if (/\/api\/v4\/projects\/team%2Fmobile\/jobs\/42$/.test(path)) {
      respondJson(response, { id: 42, commit: { id: "a".repeat(40) } });
      return;
    }
    if (path === "/api/v1/applications") {
      respondJson(response, {
        items: [
          { metadata: { name: "mobile-app" }, spec: { project: "mobile" } },
          { metadata: { name: "outside-app" }, spec: { project: "outside" } },
        ],
      });
      return;
    }
    respondJson(response, { ok: true, path, query: Object.fromEntries(url.searchParams) });
  });
}

const mockServer = createServer(mockHandler);

function childEnvironment(extra: Record<string, string>): Record<string, string> {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
    ITOPS_AUDIT_LOG: join(qaDirectory, "audit", "mcp-http.jsonl"),
    ITOPS_MAX_HTTP_RESPONSE_BYTES: "1000000",
    ITOPS_HTTP_TIMEOUT_MS: "5000",
    ITOPS_HTTP_RETRIES: "0",
    ...extra,
  };
}

async function connect(serverPath: string, env: Record<string, string>): Promise<RunningMcp> {
  const client = new Client(
    { name: "itops-http-integration-qa", version: "1.0.0" },
    { capabilities: {} },
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(serverPath)],
    cwd: process.cwd(),
    env: childEnvironment(env),
    stderr: "pipe",
  });
  await client.connect(transport);
  return { client, close: () => client.close() };
}

async function callOk(
  client: Client,
  name: string,
  arguments_: Record<string, unknown>,
): Promise<string> {
  const result = await client.callTool({ name, arguments: arguments_ });
  const text = result.content?.find(
    (item): item is { type: "text"; text: string } => item.type === "text",
  )?.text;
  expect(result.isError, `${name}: ${text ?? "no text result"}`).not.toBe(true);
  return text ?? "";
}

beforeAll(async () => {
  const workDirectory = resolve("work");
  await mkdir(workDirectory, { recursive: true });
  qaDirectory = await mkdtemp(join(workDirectory, "itops-http-qa-"));
  await new Promise<void>((resolveListen, reject) => {
    mockServer.once("error", reject);
    mockServer.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = mockServer.address();
  if (!address || typeof address === "string") throw new Error("Mock HTTP server did not bind");
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolveClose, reject) =>
    mockServer.close((error) => (error ? reject(error) : resolveClose())),
  );
  await rm(qaDirectory, { recursive: true, force: true });
});

describe("MCP HTTP integrations against isolated read-only endpoints", () => {
  it("exercises all Jira and Confluence reads with basic authentication", async () => {
    const running = await connect("dist/mcp/core.js", {
      ITOPS_ENABLE_ATLASSIAN: "true",
      ATLASSIAN_BASE_URL: origin,
      ATLASSIAN_AUTH_MODE: "basic",
      ATLASSIAN_EMAIL: "qa@example.invalid",
      ATLASSIAN_API_TOKEN: "qa-atlassian-token",
    });
    try {
      await callOk(running.client, "jira_search", { jql: "project = MOBILE", maxResults: 2 });
      await callOk(running.client, "jira_get_issue", { issueKey: "MOB-123" });
      await callOk(running.client, "confluence_search", { cql: 'space = "MOBILE"', limit: 2 });
      await callOk(running.client, "confluence_get_page", { pageId: "12345" });
      await callOk(running.client, "itops_core_health", {});
    } finally {
      await running.close();
    }
    const atlassian = requests.filter(
      (request) => request.url.startsWith("/rest/") || request.url.startsWith("/wiki/"),
    );
    expect(atlassian.length).toBeGreaterThanOrEqual(6);
    expect(atlassian.every((request) => request.method === "GET")).toBe(true);
    expect(atlassian.every((request) => request.headers.authorization?.startsWith("Basic "))).toBe(
      true,
    );
  });

  it("exercises token Splunk search, index listing, and health on a selected port", async () => {
    const parsed = new URL(origin);
    const running = await connect("dist/mcp/splunk.js", {
      ITOPS_ENABLE_SPLUNK: "true",
      SPLUNK_BASE_URL: `${parsed.protocol}//${parsed.hostname}`,
      SPLUNK_PORT: parsed.port,
      SPLUNK_AUTH_MODE: "token",
      SPLUNK_AUTH_SCHEME: "bearer",
      SPLUNK_TOKEN: "qa-splunk-token",
      SPLUNK_MAX_RESULTS: "10",
    });
    try {
      const search = JSON.parse(
        await callOk(running.client, "splunk_search", {
          search: "index=mobile level=ERROR | stats count",
          maxResults: 5,
        }),
      ) as { resultCount: number };
      expect(search.resultCount).toBe(1);
      await callOk(running.client, "splunk_list_indexes", { count: 10 });
      await callOk(running.client, "splunk_health", {});
    } finally {
      await running.close();
    }
    const splunk = requests.filter((request) => request.url.startsWith("/services/"));
    expect(splunk.some((request) => request.method === "POST")).toBe(true);
    expect(
      splunk
        .filter((request) => request.method !== "POST")
        .every((request) => request.method === "GET"),
    ).toBe(true);
    expect(splunk.every((request) => request.headers.authorization === "Bearer qa-splunk-token")).toBe(
      true,
    );
    expect(splunk.find((request) => request.method === "POST")?.body).toContain(
      "search=search+index%3Dmobile",
    );
  });

  it("exercises every Argo CD read and filters application allowlists", async () => {
    const running = await connect("dist/mcp/argocd.js", {
      ITOPS_ENABLE_ARGOCD: "true",
      ARGOCD_BASE_URL: origin,
      ARGOCD_AUTH_MODE: "token",
      ARGOCD_TOKEN: "qa-argocd-token",
      ARGOCD_PROJECT_ALLOWLIST: "mobile",
      ARGOCD_APPLICATION_ALLOWLIST: "mobile-*",
    });
    try {
      const listed = JSON.parse(
        await callOk(running.client, "argocd_list_applications", { project: "mobile" }),
      ) as { items: unknown[] };
      expect(listed.items).toHaveLength(1);
      await callOk(running.client, "argocd_get_application", {
        application: "mobile-app",
        project: "mobile",
      });
      await callOk(running.client, "argocd_resource_tree", {
        application: "mobile-app",
        project: "mobile",
      });
      await callOk(running.client, "argocd_managed_resources", {
        application: "mobile-app",
        project: "mobile",
      });
      await callOk(running.client, "argocd_application_events", {
        application: "mobile-app",
        project: "mobile",
        resourceNamespace: "mobile",
      });
      await callOk(running.client, "argocd_health", {});
    } finally {
      await running.close();
    }
    const argo = requests.filter(
      (request) => request.url.startsWith("/api/v1/") || request.url.startsWith("/api/version"),
    );
    expect(argo.length).toBeGreaterThanOrEqual(7);
    expect(argo.every((request) => request.method === "GET")).toBe(true);
    expect(argo.every((request) => request.headers.authorization === "Bearer qa-argocd-token")).toBe(
      true,
    );
  });

  it("exercises every Bitbucket and GitLab source/CI read at an immutable revision", async () => {
    const revision = "a".repeat(40);
    const running = await connect("dist/mcp/source-code.js", {
      ITOPS_ENABLE_SOURCE_CODE: "true",
      ITOPS_ENABLE_BITBUCKET: "true",
      ITOPS_ENABLE_GITLAB: "true",
      BITBUCKET_BASE_URL: origin,
      BITBUCKET_AUTH_MODE: "bearer",
      BITBUCKET_API_TOKEN: "qa-bitbucket-token",
      BITBUCKET_REPOSITORY_ALLOWLIST: "team/mobile",
      BITBUCKET_HEALTH_REPOSITORY: "team/mobile",
      GITLAB_BASE_URL: origin,
      GITLAB_AUTH_MODE: "private-token",
      GITLAB_TOKEN: "qa-gitlab-token",
      GITLAB_PROJECT_ALLOWLIST: "team/mobile",
      GITLAB_HEALTH_PROJECT: "team/mobile",
      SOURCE_CODE_PATH_DENYLIST: ".env,*.pem,*.key",
    });
    try {
      const bitbucket = { workspace: "team", repository: "mobile" };
      await callOk(running.client, "bitbucket_tree", {
        ...bitbucket,
        ref: revision,
        path: "src",
      });
      const file = JSON.parse(
        await callOk(running.client, "bitbucket_read_file", {
          ...bitbucket,
          ref: revision,
          path: "src/index.ts",
        }),
      ) as { content: string };
      expect(file.content).toContain("mobile");
      await callOk(running.client, "bitbucket_commits", { ...bitbucket, ref: revision });
      await callOk(running.client, "bitbucket_commit_diff", {
        ...bitbucket,
        commit: revision,
      });
      await callOk(running.client, "bitbucket_pull_request", {
        ...bitbucket,
        pullRequestId: 7,
        deployedRevision: revision,
      });
      await callOk(running.client, "bitbucket_pipelines", {
        ...bitbucket,
        deployedRevision: revision,
      });
      await callOk(running.client, "bitbucket_pipelines", {
        ...bitbucket,
        pipelineUuid: "{qa-pipeline}",
        deployedRevision: revision,
      });

      const gitlab = { project: "team/mobile" };
      await callOk(running.client, "gitlab_tree", { ...gitlab, ref: revision, path: "src" });
      const gitlabFile = JSON.parse(
        await callOk(running.client, "gitlab_read_file", {
          ...gitlab,
          ref: revision,
          path: "src/index.ts",
        }),
      ) as { content: string };
      expect(gitlabFile.content).toContain("mobile");
      await callOk(running.client, "gitlab_code_search", {
        ...gitlab,
        ref: revision,
        search: "mobile",
      });
      await callOk(running.client, "gitlab_commits", { ...gitlab, ref: revision });
      await callOk(running.client, "gitlab_commit_diff", { ...gitlab, commit: revision });
      await callOk(running.client, "gitlab_merge_request", {
        ...gitlab,
        mergeRequestIid: 7,
        deployedRevision: revision,
      });
      await callOk(running.client, "gitlab_pipelines", {
        ...gitlab,
        deployedRevision: revision,
      });
      await callOk(running.client, "gitlab_pipelines", {
        ...gitlab,
        pipelineId: 42,
        deployedRevision: revision,
      });
      await callOk(running.client, "gitlab_job_trace", {
        ...gitlab,
        jobId: 42,
        deployedRevision: revision,
      });
      await callOk(running.client, "source_code_health", {});
    } finally {
      await running.close();
    }

    const bitbucketRequests = requests.filter((request) => request.url.startsWith("/2.0/"));
    const gitlabRequests = requests.filter((request) => request.url.startsWith("/api/v4/"));
    expect(bitbucketRequests.length).toBeGreaterThanOrEqual(12);
    expect(gitlabRequests.length).toBeGreaterThanOrEqual(12);
    expect(bitbucketRequests.every((request) => request.method === "GET")).toBe(true);
    expect(gitlabRequests.every((request) => request.method === "GET")).toBe(true);
    expect(
      bitbucketRequests.every(
        (request) => request.headers.authorization === "Bearer qa-bitbucket-token",
      ),
    ).toBe(true);
    expect(
      gitlabRequests.every((request) => request.headers["private-token"] === "qa-gitlab-token"),
    ).toBe(true);
    expect(bitbucketRequests.some((request) => request.url.includes(revision))).toBe(true);
    expect(gitlabRequests.some((request) => request.url.includes(revision))).toBe(true);
  });
});
