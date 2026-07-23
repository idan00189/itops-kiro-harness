import { z } from "zod";
import { enabled, env, envCsv, envInteger, requireSafeBaseUrl } from "../common/env.js";
import { basic, bearer, fetchJson, fetchText, withQuery } from "../common/http.js";
import {
  assertBitbucketRepository,
  assertEvidenceRevision,
  assertGitLabProject,
  assertSourcePath,
  assertSourceRevision,
  assertTextSource,
} from "../common/source-guards.js";
import { createServer, readOnlyAnnotations, runTool, startServer } from "../common/mcp.js";

const SERVER = "itops-source-code";
const server = createServer(
  SERVER,
  "Read-only Bitbucket Cloud and GitLab source-code investigation. The server exposes only bounded repository, file, commit, diff, review, and CI evidence reads; it cannot clone, push, comment, approve, merge, rerun, cancel, or modify anything.",
);

function assertSourceEnabled(): void {
  if (!enabled("SOURCE_CODE")) throw new Error("Source-code integration is disabled");
}

function assertProviderEnabled(provider: "BITBUCKET" | "GITLAB"): void {
  assertSourceEnabled();
  if (!enabled(provider)) throw new Error(`${provider} integration is disabled`);
}

function bitbucketBase(): URL {
  return requireSafeBaseUrl("BITBUCKET_BASE_URL");
}

function bitbucketHeaders(): Record<string, string> {
  const mode = env("BITBUCKET_AUTH_MODE", {
    defaultValue: "bearer",
    allowPlaceholder: true,
  }).toLowerCase();
  const token = env("BITBUCKET_API_TOKEN", { required: true });
  if (mode === "bearer") return bearer(token);
  if (mode === "basic") {
    return basic(env("BITBUCKET_EMAIL", { required: true }), token);
  }
  throw new Error("BITBUCKET_AUTH_MODE must be bearer or basic");
}

function bitbucketRepo(workspace: string, repository: string): string {
  const allowed = assertBitbucketRepository(
    workspace,
    repository,
    envCsv("BITBUCKET_REPOSITORY_ALLOWLIST"),
  );
  return `/2.0/repositories/${encodeURIComponent(allowed.workspace)}/${encodeURIComponent(allowed.repository)}`;
}

function gitlabBase(): URL {
  return requireSafeBaseUrl("GITLAB_BASE_URL");
}

function gitlabHeaders(): Record<string, string> {
  const mode = env("GITLAB_AUTH_MODE", {
    defaultValue: "private-token",
    allowPlaceholder: true,
  }).toLowerCase();
  const token = env("GITLAB_TOKEN", { required: true });
  if (mode === "private-token") return { "PRIVATE-TOKEN": token };
  if (mode === "bearer") return bearer(token);
  throw new Error("GITLAB_AUTH_MODE must be private-token or bearer");
}

function gitlabProject(project: string): string {
  return encodeURIComponent(
    assertGitLabProject(project, envCsv("GITLAB_PROJECT_ALLOWLIST")),
  );
}

function sourcePath(path: string): string {
  return assertSourcePath(path, envCsv("SOURCE_CODE_PATH_DENYLIST"));
}

function encodedSourcePath(path: string): string {
  return sourcePath(path)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function encodedGitLabSourcePath(path: string): string {
  return encodeURIComponent(sourcePath(path));
}

function sameOriginPath(base: URL, href: string, expectedPathPrefix: string): string {
  const target = new URL(href, base);
  if (target.origin !== base.origin) throw new Error("Cross-origin source-code link rejected");
  if (
    target.pathname !== expectedPathPrefix &&
    !target.pathname.startsWith(`${expectedPathPrefix}/`)
  ) {
    throw new Error("Source-code link escaped the allowlisted repository path");
  }
  return `${target.pathname}${target.search}`;
}

function boundedText(value: string, label: string, requestedBytes?: number): string {
  const maximum = Math.min(
    requestedBytes ?? envInteger("SOURCE_CODE_MAX_FILE_BYTES", 250_000, 1_000, 2_000_000),
    envInteger("SOURCE_CODE_MAX_FILE_BYTES", 250_000, 1_000, 2_000_000),
  );
  return assertTextSource(Buffer.from(value, "utf8"), label, maximum);
}

const bitbucketRepositoryInput = {
  workspace: z.string().min(1).max(100),
  repository: z.string().min(1).max(100),
};

const gitlabProjectInput = {
  project: z.string().min(1).max(500),
};

server.registerTool(
  "bitbucket_tree",
  {
    title: "List a Bitbucket Cloud source tree",
    description: "List one bounded directory at an allowlisted repository and ref.",
    inputSchema: z.object({
      ...bitbucketRepositoryInput,
      ref: z.string().min(40).max(64),
      path: z.string().max(1_000).default(""),
      pageLength: z.number().int().min(1).max(100).default(50),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "bitbucket_tree", input, async () => {
      assertProviderEnabled("BITBUCKET");
      const root = bitbucketRepo(input.workspace, input.repository);
      const ref = encodeURIComponent(assertSourceRevision(input.ref));
      const path = input.path ? `/${encodedSourcePath(input.path)}` : "/";
      return fetchJson(
        bitbucketBase(),
        withQuery(`${root}/src/${ref}${path}`, {
          pagelen: input.pageLength,
          sort: "path",
        }),
        { headers: bitbucketHeaders() },
      );
    }),
);

server.registerTool(
  "bitbucket_read_file",
  {
    title: "Read a Bitbucket Cloud source file",
    description:
      "Read one bounded UTF-8 text file at an allowlisted repository and ref. Secret-bearing paths and binary content are blocked.",
    inputSchema: z.object({
      ...bitbucketRepositoryInput,
      ref: z.string().min(40).max(64),
      path: z.string().min(1).max(1_000),
      maxBytes: z.number().int().min(1_000).max(2_000_000).optional(),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "bitbucket_read_file", { ...input, maxBytes: input.maxBytes }, async () => {
      assertProviderEnabled("BITBUCKET");
      const content = await fetchText(
        bitbucketBase(),
        `${bitbucketRepo(input.workspace, input.repository)}/src/${encodeURIComponent(assertSourceRevision(input.ref))}/${encodedSourcePath(input.path)}`,
        { headers: { ...bitbucketHeaders(), Accept: "text/plain" } },
      );
      return {
        workspace: input.workspace,
        repository: input.repository,
        ref: input.ref,
        path: sourcePath(input.path),
        content: boundedText(content, "Bitbucket source file", input.maxBytes),
      };
    }),
);

server.registerTool(
  "bitbucket_commits",
  {
    title: "List Bitbucket Cloud commits",
    description: "List a bounded page of commits for one allowlisted repository and ref.",
    inputSchema: z.object({
      ...bitbucketRepositoryInput,
      ref: z.string().min(40).max(64),
      pageLength: z.number().int().min(1).max(100).default(30),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "bitbucket_commits", input, async () => {
      assertProviderEnabled("BITBUCKET");
      return fetchJson(
        bitbucketBase(),
        withQuery(
          `${bitbucketRepo(input.workspace, input.repository)}/commits/${encodeURIComponent(assertSourceRevision(input.ref))}`,
          { pagelen: input.pageLength },
        ),
        { headers: bitbucketHeaders() },
      );
    }),
);

server.registerTool(
  "bitbucket_commit_diff",
  {
    title: "Inspect a Bitbucket Cloud commit and diff",
    description: "Read commit metadata, diffstat, and an optionally bounded patch.",
    inputSchema: z.object({
      ...bitbucketRepositoryInput,
      commit: z.string().min(40).max(64),
      includePatch: z.boolean().default(true),
      maxPatchCharacters: z.number().int().min(1_000).max(200_000).default(80_000),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "bitbucket_commit_diff", input, async () => {
      assertProviderEnabled("BITBUCKET");
      const root = bitbucketRepo(input.workspace, input.repository);
      const commit = encodeURIComponent(assertSourceRevision(input.commit));
      const [metadata, diffstat, patch] = await Promise.all([
        fetchJson(bitbucketBase(), `${root}/commit/${commit}`, { headers: bitbucketHeaders() }),
        fetchJson(bitbucketBase(), `${root}/diffstat/${commit}`, { headers: bitbucketHeaders() }),
        input.includePatch
          ? fetchText(bitbucketBase(), `${root}/diff/${commit}`, {
              headers: { ...bitbucketHeaders(), Accept: "text/plain" },
            })
          : Promise.resolve(""),
      ]);
      return {
        metadata,
        diffstat,
        patch: patch.slice(0, input.maxPatchCharacters),
        patchTruncated: patch.length > input.maxPatchCharacters,
      };
    }),
);

server.registerTool(
  "bitbucket_pull_request",
  {
    title: "Inspect a Bitbucket Cloud pull request",
    description: "Read one pull request and its bounded canonical diff without commenting or approving.",
    inputSchema: z.object({
      ...bitbucketRepositoryInput,
      pullRequestId: z.number().int().positive(),
      deployedRevision: z.string().min(40).max(64),
      includeDiff: z.boolean().default(true),
      maxDiffCharacters: z.number().int().min(1_000).max(200_000).default(80_000),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "bitbucket_pull_request", input, async () => {
      assertProviderEnabled("BITBUCKET");
      const deployedRevision = assertSourceRevision(input.deployedRevision);
      type PullRequest = {
        merge_commit?: { hash?: string };
        source?: { commit?: { hash?: string } };
        links?: { diff?: { href?: string }; diffstat?: { href?: string } };
      };
      const base = bitbucketBase();
      const repositoryRoot = bitbucketRepo(input.workspace, input.repository);
      const pullRequest = await fetchJson<PullRequest>(
        base,
        `${repositoryRoot}/pullrequests/${input.pullRequestId}`,
        { headers: bitbucketHeaders() },
      );
      assertEvidenceRevision(
        deployedRevision,
        [pullRequest.merge_commit?.hash, pullRequest.source?.commit?.hash],
        "Bitbucket pull request",
      );
      const diffHref = pullRequest.links?.diff?.href;
      const diffstatHref = pullRequest.links?.diffstat?.href;
      const [diff, diffstat] = await Promise.all([
        input.includeDiff && diffHref
          ? fetchText(base, sameOriginPath(base, diffHref, repositoryRoot), {
              headers: { ...bitbucketHeaders(), Accept: "text/plain" },
            })
          : Promise.resolve(""),
        diffstatHref
          ? fetchJson(base, sameOriginPath(base, diffstatHref, repositoryRoot), {
              headers: bitbucketHeaders(),
            })
          : Promise.resolve(undefined),
      ]);
      return {
        deployedRevision,
        pullRequest,
        diffstat,
        diff: diff.slice(0, input.maxDiffCharacters),
        diffTruncated: diff.length > input.maxDiffCharacters,
      };
    }),
);

server.registerTool(
  "bitbucket_pipelines",
  {
    title: "Inspect Bitbucket Cloud pipelines",
    description:
      "List bounded pipeline metadata, or read one pipeline and its steps. It cannot trigger, stop, or rerun a pipeline.",
    inputSchema: z.object({
      ...bitbucketRepositoryInput,
      pipelineUuid: z.string().min(3).max(100).optional(),
      deployedRevision: z.string().min(40).max(64),
      pageLength: z.number().int().min(1).max(50).default(20),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "bitbucket_pipelines", input, async () => {
      assertProviderEnabled("BITBUCKET");
      const deployedRevision = assertSourceRevision(input.deployedRevision);
      const root = `${bitbucketRepo(input.workspace, input.repository)}/pipelines`;
      if (input.pipelineUuid) {
        const uuid = encodeURIComponent(input.pipelineUuid);
        type Pipeline = { target?: { commit?: { hash?: string } } };
        const [pipeline, steps] = await Promise.all([
          fetchJson<Pipeline>(bitbucketBase(), `${root}/${uuid}`, { headers: bitbucketHeaders() }),
          fetchJson(
            bitbucketBase(),
            withQuery(`${root}/${uuid}/steps`, { pagelen: input.pageLength }),
            { headers: bitbucketHeaders() },
          ),
        ]);
        assertEvidenceRevision(
          deployedRevision,
          [pipeline.target?.commit?.hash],
          "Bitbucket pipeline",
        );
        return { deployedRevision, pipeline, steps };
      }
      return fetchJson(
        bitbucketBase(),
        withQuery(`${root}/`, {
          pagelen: input.pageLength,
          sort: "-created_on",
          q: `target.commit.hash = "${deployedRevision}"`,
        }),
        { headers: bitbucketHeaders() },
      );
    }),
);

server.registerTool(
  "gitlab_tree",
  {
    title: "List a GitLab repository tree",
    description: "List one bounded directory at an allowlisted GitLab project and ref.",
    inputSchema: z.object({
      ...gitlabProjectInput,
      ref: z.string().min(40).max(64),
      path: z.string().max(1_000).default(""),
      recursive: z.boolean().default(false),
      pageSize: z.number().int().min(1).max(100).default(50),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "gitlab_tree", input, async () => {
      assertProviderEnabled("GITLAB");
      return fetchJson(
        gitlabBase(),
        withQuery(`/api/v4/projects/${gitlabProject(input.project)}/repository/tree`, {
          ref: assertSourceRevision(input.ref),
          path: input.path ? sourcePath(input.path) : undefined,
          recursive: input.recursive,
          per_page: input.pageSize,
          page: 1,
        }),
        { headers: gitlabHeaders() },
      );
    }),
);

server.registerTool(
  "gitlab_read_file",
  {
    title: "Read a GitLab source file",
    description:
      "Read one bounded UTF-8 text file at an allowlisted GitLab project and ref. Secret-bearing paths and binary content are blocked.",
    inputSchema: z.object({
      ...gitlabProjectInput,
      ref: z.string().min(40).max(64),
      path: z.string().min(1).max(1_000),
      maxBytes: z.number().int().min(1_000).max(2_000_000).optional(),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "gitlab_read_file", input, async () => {
      assertProviderEnabled("GITLAB");
      type GitLabFile = {
        file_name: string;
        file_path: string;
        size: number;
        encoding: string;
        content: string;
        content_sha256?: string;
        commit_id?: string;
        last_commit_id?: string;
      };
      const file = await fetchJson<GitLabFile>(
        gitlabBase(),
        withQuery(
          `/api/v4/projects/${gitlabProject(input.project)}/repository/files/${encodedGitLabSourcePath(input.path)}`,
          { ref: assertSourceRevision(input.ref) },
        ),
        { headers: gitlabHeaders() },
      );
      if (file.encoding !== "base64") throw new Error("GitLab returned an unsupported file encoding");
      const maximum = Math.min(
        input.maxBytes ?? envInteger("SOURCE_CODE_MAX_FILE_BYTES", 250_000, 1_000, 2_000_000),
        envInteger("SOURCE_CODE_MAX_FILE_BYTES", 250_000, 1_000, 2_000_000),
      );
      return {
        ...file,
        content: assertTextSource(
          Buffer.from(file.content.replace(/\s+/g, ""), "base64"),
          "GitLab source file",
          maximum,
        ),
      };
    }),
);

server.registerTool(
  "gitlab_code_search",
  {
    title: "Search code in one GitLab project",
    description: "Run a bounded project-scoped blob search where the GitLab tier supports it.",
    inputSchema: z.object({
      ...gitlabProjectInput,
      search: z.string().min(2).max(200),
      ref: z.string().min(40).max(64),
      pageSize: z.number().int().min(1).max(100).default(30),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "gitlab_code_search", input, async () => {
      assertProviderEnabled("GITLAB");
      return fetchJson(
        gitlabBase(),
        withQuery(`/api/v4/projects/${gitlabProject(input.project)}/search`, {
          scope: "blobs",
          search: input.search,
          ref: assertSourceRevision(input.ref),
          per_page: input.pageSize,
          page: 1,
        }),
        { headers: gitlabHeaders() },
      );
    }),
);

server.registerTool(
  "gitlab_commits",
  {
    title: "List GitLab commits",
    description: "List bounded commits by ref, time window, or source path.",
    inputSchema: z.object({
      ...gitlabProjectInput,
      ref: z.string().min(40).max(64),
      since: z.string().datetime({ offset: true }).optional(),
      until: z.string().datetime({ offset: true }).optional(),
      path: z.string().max(1_000).optional(),
      pageSize: z.number().int().min(1).max(100).default(30),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "gitlab_commits", input, async () => {
      assertProviderEnabled("GITLAB");
      return fetchJson(
        gitlabBase(),
        withQuery(`/api/v4/projects/${gitlabProject(input.project)}/repository/commits`, {
          ref_name: assertSourceRevision(input.ref),
          since: input.since,
          until: input.until,
          path: input.path ? sourcePath(input.path) : undefined,
          per_page: input.pageSize,
          page: 1,
        }),
        { headers: gitlabHeaders() },
      );
    }),
);

server.registerTool(
  "gitlab_commit_diff",
  {
    title: "Inspect a GitLab commit and diff",
    description: "Read one commit and a bounded first page of its unified diff.",
    inputSchema: z.object({
      ...gitlabProjectInput,
      commit: z.string().min(40).max(64),
      pageSize: z.number().int().min(1).max(100).default(50),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "gitlab_commit_diff", input, async () => {
      assertProviderEnabled("GITLAB");
      const root = `/api/v4/projects/${gitlabProject(input.project)}/repository/commits/${encodeURIComponent(assertSourceRevision(input.commit))}`;
      const [commit, diff] = await Promise.all([
        fetchJson(gitlabBase(), root, { headers: gitlabHeaders() }),
        fetchJson(
          gitlabBase(),
          withQuery(`${root}/diff`, {
            unidiff: true,
            per_page: input.pageSize,
            page: 1,
          }),
          { headers: gitlabHeaders() },
        ),
      ]);
      return { commit, diff };
    }),
);

server.registerTool(
  "gitlab_merge_request",
  {
    title: "Inspect a GitLab merge request",
    description: "Read one merge request and a bounded first page of diffs without commenting or approving.",
    inputSchema: z.object({
      ...gitlabProjectInput,
      mergeRequestIid: z.number().int().positive(),
      deployedRevision: z.string().min(40).max(64),
      pageSize: z.number().int().min(1).max(100).default(50),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "gitlab_merge_request", input, async () => {
      assertProviderEnabled("GITLAB");
      const deployedRevision = assertSourceRevision(input.deployedRevision);
      const root = `/api/v4/projects/${gitlabProject(input.project)}/merge_requests/${input.mergeRequestIid}`;
      type MergeRequest = {
        merge_commit_sha?: string;
        squash_commit_sha?: string;
        sha?: string;
        diff_refs?: { head_sha?: string };
      };
      const [mergeRequest, diffs] = await Promise.all([
        fetchJson<MergeRequest>(gitlabBase(), root, { headers: gitlabHeaders() }),
        fetchJson(
          gitlabBase(),
          withQuery(`${root}/diffs`, {
            unidiff: true,
            per_page: input.pageSize,
            page: 1,
          }),
          { headers: gitlabHeaders() },
        ),
      ]);
      assertEvidenceRevision(
        deployedRevision,
        [
          mergeRequest.merge_commit_sha,
          mergeRequest.squash_commit_sha,
          mergeRequest.sha,
          mergeRequest.diff_refs?.head_sha,
        ],
        "GitLab merge request",
      );
      return { deployedRevision, mergeRequest, diffs };
    }),
);

server.registerTool(
  "gitlab_pipelines",
  {
    title: "Inspect GitLab pipelines",
    description:
      "List bounded pipeline metadata, or read one pipeline and its jobs. It cannot trigger, retry, cancel, or erase jobs.",
    inputSchema: z.object({
      ...gitlabProjectInput,
      pipelineId: z.number().int().positive().optional(),
      deployedRevision: z.string().min(40).max(64),
      updatedAfter: z.string().datetime({ offset: true }).optional(),
      updatedBefore: z.string().datetime({ offset: true }).optional(),
      pageSize: z.number().int().min(1).max(100).default(30),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "gitlab_pipelines", input, async () => {
      assertProviderEnabled("GITLAB");
      const deployedRevision = assertSourceRevision(input.deployedRevision);
      const root = `/api/v4/projects/${gitlabProject(input.project)}/pipelines`;
      if (input.pipelineId) {
        type Pipeline = { sha?: string };
        const [pipeline, jobs] = await Promise.all([
          fetchJson<Pipeline>(gitlabBase(), `${root}/${input.pipelineId}`, { headers: gitlabHeaders() }),
          fetchJson(
            gitlabBase(),
            withQuery(`${root}/${input.pipelineId}/jobs`, {
              include_retried: true,
              per_page: input.pageSize,
              page: 1,
            }),
            { headers: gitlabHeaders() },
          ),
        ]);
        assertEvidenceRevision(
          deployedRevision,
          [pipeline.sha],
          "GitLab pipeline",
        );
        return { deployedRevision, pipeline, jobs };
      }
      return fetchJson(
        gitlabBase(),
        withQuery(root, {
          sha: deployedRevision,
          updated_after: input.updatedAfter,
          updated_before: input.updatedBefore,
          order_by: "updated_at",
          sort: "desc",
          per_page: input.pageSize,
          page: 1,
        }),
        { headers: gitlabHeaders() },
      );
    }),
);

server.registerTool(
  "gitlab_job_trace",
  {
    title: "Read a GitLab CI job trace",
    description: "Read and redact the bounded tail of one GitLab CI job log.",
    inputSchema: z.object({
      ...gitlabProjectInput,
      jobId: z.number().int().positive(),
      deployedRevision: z.string().min(40).max(64),
      maxCharacters: z.number().int().min(1_000).max(200_000).default(80_000),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "gitlab_job_trace", input, async () => {
      assertProviderEnabled("GITLAB");
      const deployedRevision = assertSourceRevision(input.deployedRevision);
      const root = `/api/v4/projects/${gitlabProject(input.project)}/jobs/${input.jobId}`;
      type Job = { commit?: { id?: string }; pipeline?: { sha?: string } };
      const [job, trace] = await Promise.all([
        fetchJson<Job>(gitlabBase(), root, { headers: gitlabHeaders() }),
        fetchText(gitlabBase(), `${root}/trace`, {
          headers: { ...gitlabHeaders(), Accept: "text/plain" },
        }),
      ]);
      assertEvidenceRevision(
        deployedRevision,
        [job.commit?.id, job.pipeline?.sha],
        "GitLab job",
      );
      return {
        deployedRevision,
        jobId: input.jobId,
        job,
        traceTail: trace.slice(-input.maxCharacters),
        traceTruncated: trace.length > input.maxCharacters,
      };
    }),
);

server.registerTool(
  "source_code_health",
  {
    title: "Check Bitbucket and GitLab read connections",
    description:
      "Read one explicitly configured repository/project from each enabled provider to verify read-only access.",
    inputSchema: z.object({}),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "source_code_health", input, async () => {
      if (!enabled("SOURCE_CODE")) return { status: "disabled", integration: "source-code" };
      if (!enabled("BITBUCKET") && !enabled("GITLAB")) {
        throw new Error("Source-code integration requires Bitbucket and/or GitLab");
      }
      const checks: Record<string, unknown> = {};
      if (enabled("BITBUCKET")) {
        const repositoryParts = env("BITBUCKET_HEALTH_REPOSITORY", {
          required: true,
        }).split("/");
        if (repositoryParts.length !== 2 || !repositoryParts[0] || !repositoryParts[1]) {
          throw new Error("BITBUCKET_HEALTH_REPOSITORY must be workspace/repository");
        }
        const [workspace, repository] = repositoryParts as [string, string];
        checks.bitbucket = await fetchJson(
          bitbucketBase(),
          bitbucketRepo(workspace, repository),
          { headers: bitbucketHeaders() },
        );
      } else {
        checks.bitbucket = { status: "disabled" };
      }
      if (enabled("GITLAB")) {
        const project = env("GITLAB_HEALTH_PROJECT", { required: true });
        checks.gitlab = await fetchJson(
          gitlabBase(),
          `/api/v4/projects/${gitlabProject(project)}`,
          { headers: gitlabHeaders() },
        );
      } else {
        checks.gitlab = { status: "disabled" };
      }
      return { status: "ok", checks };
    }),
);

await startServer(server);
