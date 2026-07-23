import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { parse } from "yaml";
import {
  ConfigError,
  enabled,
  env,
  envBoolean,
  envCsv,
  envInteger,
  requireSafeBaseUrl,
} from "../common/env.js";
import {
  assertBitbucketRepository,
  assertGitLabProject,
} from "../common/source-guards.js";

const root = process.cwd();
const runtime = process.argv.includes("--runtime");
const errors: string[] = [];
const warnings: string[] = [];

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function check(condition: unknown, message: string): void {
  if (!condition) errors.push(message);
}

function frontmatter(text: string): Record<string, unknown> {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match?.[1]) throw new Error("missing YAML frontmatter");
  const value = parse(match[1]) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("frontmatter must be a mapping");
  }
  return value as Record<string, unknown>;
}

async function validateAgents(): Promise<void> {
  const directory = resolve(root, ".kiro/agents");
  const expected = new Set([
    "itops-orchestrator.md",
    "itops-splunk.md",
    "itops-sql-server.md",
    "itops-mongodb-docdb.md",
    "itops-dynatrace.md",
    "itops-argocd.md",
    "itops-source-code.md",
  ]);
  const files = (await readdir(directory)).filter((file) => file.endsWith(".md"));
  check(files.length === expected.size, `Expected ${expected.size} agent profiles, found ${files.length}`);
  for (const name of expected) check(files.includes(name), `Missing agent profile ${name}`);

  for (const file of files) {
    try {
      const config = frontmatter(await readFile(join(directory, file), "utf8"));
      const tools = Array.isArray(config.tools) ? config.tools.map(String) : [];
      check(tools.includes("@mcp"), `${file}: tools must include @mcp`);
      check(config.includeMcpJson === false, `${file}: includeMcpJson must be false`);
      check(!tools.includes("read"), `${file}: generic read tools must remain disabled`);
      check(!tools.some((tool) => ["write", "shell", "web", "*", "@builtin"].includes(tool)), `${file}: unsafe tool tag`);
      check(
        file === "itops-orchestrator.md" ? tools.includes("subagent") : !tools.includes("subagent"),
        `${file}: invalid subagent capability`,
      );
      const servers =
        config.mcpServers && typeof config.mcpServers === "object"
          ? Object.keys(config.mcpServers as Record<string, unknown>)
          : [];
      check(servers.length === 1, `${file}: must declare exactly one MCP server`);
      const permissions = config.permissions as { rules?: Array<Record<string, unknown>> } | undefined;
      const rules = permissions?.rules ?? [];
      check(
        rules.some((rule) => rule.capability === "fs_write" && rule.effect === "deny"),
        `${file}: missing fs_write deny`,
      );
      check(
        rules.some(
          (rule) =>
            rule.capability === "fs_read" &&
            rule.effect === "deny" &&
            Array.isArray(rule.match) &&
            rule.match.includes("config/**"),
        ),
        `${file}: missing secret-directory read deny`,
      );
      check(
        rules.some((rule) => rule.capability === "shell" && rule.effect === "deny"),
        `${file}: missing shell deny`,
      );
      check(
        rules.some((rule) => rule.capability === "mcp" && rule.effect === "allow"),
        `${file}: missing explicit MCP allow rules`,
      );
    } catch (error) {
      errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function validateSkills(): Promise<void> {
  const directory = resolve(root, ".kiro/skills");
  const expected = new Set([
    "itops-orchestrate",
    "investigate-splunk",
    "investigate-sql-server",
    "investigate-mongodb-docdb",
    "investigate-dynatrace",
    "investigate-argocd",
    "investigate-source-code",
  ]);
  const directories = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  for (const name of expected) check(directories.includes(name), `Missing skill ${name}`);
  for (const name of expected) {
    try {
      const config = frontmatter(await readFile(join(directory, name, "SKILL.md"), "utf8"));
      check(config.name === name, `${name}: skill name does not match directory`);
      check(typeof config.description === "string" && config.description.length >= 40, `${name}: weak description`);
      check(
        Object.keys(config).every((key) => ["name", "description"].includes(key)),
        `${name}: unsupported SKILL.md frontmatter field`,
      );
    } catch (error) {
      errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function validateHooks(): Promise<void> {
  const directory = resolve(root, ".kiro/hooks");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".json"));
  check(files.length >= 3, "Expected at least three v3 hook files");
  for (const file of files) {
    try {
      const document = JSON.parse(await readFile(join(directory, file), "utf8")) as {
        version?: string;
        hooks?: Array<{ trigger?: string; action?: { type?: string; command?: string } }>;
      };
      check(document.version === "v1", `${file}: hook schema must be v1`);
      check(Array.isArray(document.hooks) && document.hooks.length > 0, `${file}: missing hooks`);
      for (const hook of document.hooks ?? []) {
        check(
          [
            "SessionStart",
            "Stop",
            "PreToolUse",
            "PostToolUse",
            "PreTaskExec",
            "PostTaskExec",
            "UserPromptSubmit",
            "PostFileCreate",
            "PostFileSave",
            "PostFileDelete",
            "Manual",
          ].includes(hook.trigger ?? ""),
          `${file}: invalid v3 trigger ${hook.trigger}`,
        );
        if (hook.action?.type === "command" && hook.action.command) {
          const commandFile = hook.action.command.split(/\s+/).at(-1);
          if (commandFile) check(await exists(resolve(root, commandFile)), `${file}: missing command ${commandFile}`);
        }
      }
    } catch (error) {
      errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function validateLayout(): Promise<void> {
  const required = [
    "AGENTS.md",
    "README.md",
    "config/itops.env.example",
    "wiki/.gitkeep",
    ".kiro/steering/product.md",
    ".kiro/steering/tech.md",
    ".kiro/steering/structure.md",
    ".kiro/specs/itops-harness/requirements.md",
    ".kiro/specs/itops-harness/design.md",
    ".kiro/specs/itops-harness/tasks.md",
    "dist/mcp/core.js",
    "dist/mcp/splunk.js",
    "dist/mcp/sql-server.js",
    "dist/mcp/mongodb-docdb.js",
    "dist/mcp/dynatrace.js",
    "dist/mcp/argocd.js",
    "dist/mcp/source-code.js",
  ];
  for (const path of required) check(await exists(resolve(root, path)), `Missing required path ${path}`);
  const envFiles = (await readdir(resolve(root, "config"))).filter((file) => /\.env(?:\.example)?$/i.test(file));
  check(
    envFiles.every((file) => ["itops.env", "itops.env.example"].includes(file)),
    `Unexpected environment file(s): ${envFiles.join(", ")}`,
  );
}

function requireVariables(names: string[]): void {
  for (const name of names) {
    try {
      env(name, { required: true });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
}

function safeUrl(name: string): void {
  try {
    requireSafeBaseUrl(name);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
}

function validateRuntime(): void {
  try {
    if (enabled("ATLASSIAN")) {
      requireVariables(["ATLASSIAN_BASE_URL", "ATLASSIAN_API_TOKEN"]);
      const authMode = env("ATLASSIAN_AUTH_MODE", { defaultValue: "basic", allowPlaceholder: true });
      if (authMode === "basic") requireVariables(["ATLASSIAN_EMAIL"]);
      safeUrl("ATLASSIAN_BASE_URL");
    }
    if (enabled("SPLUNK")) {
      requireVariables(["SPLUNK_BASE_URL", "SPLUNK_TOKEN"]);
      safeUrl("SPLUNK_BASE_URL");
    }
    if (enabled("SQLSERVER")) {
      requireVariables([
        "SQLSERVER_HOST",
        "SQLSERVER_DATABASE",
        "SQLSERVER_USERNAME",
        "SQLSERVER_PASSWORD",
      ]);
      if (!envBoolean("SQLSERVER_ENCRYPT", true)) errors.push("SQLSERVER_ENCRYPT must remain true");
      if (envBoolean("SQLSERVER_TRUST_SERVER_CERTIFICATE", false)) {
        errors.push("SQLSERVER_TRUST_SERVER_CERTIFICATE must remain false; install the issuing CA instead");
      }
    }
    if (enabled("MONGODB")) {
      requireVariables(["MONGODB_URI", "MONGODB_DATABASE"]);
      const uri = env("MONGODB_URI", { required: true });
      if (/tls(?:allowinvalidcertificates|insecure)=true/i.test(uri)) {
        errors.push("MONGODB_URI disables TLS certificate validation");
      }
      if (env("MONGODB_COLLECTION_ALLOWLIST", { defaultValue: "*", allowPlaceholder: true }) === "*") {
        warnings.push("MONGODB_COLLECTION_ALLOWLIST=*; narrow it for least privilege");
      }
    }
    if (enabled("DYNATRACE")) {
      requireVariables(["DYNATRACE_ENV_URL", "DYNATRACE_API_TOKEN"]);
      safeUrl("DYNATRACE_ENV_URL");
      if (envBoolean("DYNATRACE_DQL_ENABLED", true)) {
        requireVariables(["DYNATRACE_PLATFORM_URL"]);
        safeUrl("DYNATRACE_PLATFORM_URL");
        if (!env("DYNATRACE_PLATFORM_TOKEN")) {
          requireVariables([
            "DYNATRACE_OAUTH_TOKEN_URL",
            "DYNATRACE_OAUTH_CLIENT_ID",
            "DYNATRACE_OAUTH_CLIENT_SECRET",
            "DYNATRACE_OAUTH_SCOPES",
          ]);
          safeUrl("DYNATRACE_OAUTH_TOKEN_URL");
        }
        if (/(?:write|delete|manage|admin)/i.test(env("DYNATRACE_OAUTH_SCOPES"))) {
          errors.push("DYNATRACE_OAUTH_SCOPES contains a non-read scope");
        }
      }
    }
    if (enabled("ARGOCD")) {
      requireVariables(["ARGOCD_BASE_URL", "ARGOCD_TOKEN"]);
      safeUrl("ARGOCD_BASE_URL");
      if (env("ARGOCD_PROJECT_ALLOWLIST", { defaultValue: "*", allowPlaceholder: true }) === "*") {
        warnings.push("ARGOCD_PROJECT_ALLOWLIST=*; narrow it when possible");
      }
      if (env("ARGOCD_APPLICATION_ALLOWLIST", { defaultValue: "*", allowPlaceholder: true }) === "*") {
        warnings.push("ARGOCD_APPLICATION_ALLOWLIST=*; narrow it when possible");
      }
    }
    if (enabled("SOURCE_CODE")) {
      const bitbucketEnabled = enabled("BITBUCKET");
      const gitlabEnabled = enabled("GITLAB");
      if (!bitbucketEnabled && !gitlabEnabled) {
        errors.push("ITOPS_ENABLE_SOURCE_CODE=true requires Bitbucket and/or GitLab");
      }
      const sourceMax = envInteger("SOURCE_CODE_MAX_FILE_BYTES", 250_000, 1_000, 2_000_000);
      const httpMax = envInteger(
        "ITOPS_MAX_HTTP_RESPONSE_BYTES",
        5_000_000,
        10_000,
        50_000_000,
      );
      if (sourceMax > httpMax) {
        errors.push("SOURCE_CODE_MAX_FILE_BYTES must not exceed ITOPS_MAX_HTTP_RESPONSE_BYTES");
      }
      if (bitbucketEnabled) {
        requireVariables([
          "BITBUCKET_BASE_URL",
          "BITBUCKET_API_TOKEN",
          "BITBUCKET_REPOSITORY_ALLOWLIST",
          "BITBUCKET_HEALTH_REPOSITORY",
        ]);
        safeUrl("BITBUCKET_BASE_URL");
        const mode = env("BITBUCKET_AUTH_MODE", {
          defaultValue: "bearer",
          allowPlaceholder: true,
        }).toLowerCase();
        if (!["bearer", "basic"].includes(mode)) {
          errors.push("BITBUCKET_AUTH_MODE must be bearer or basic");
        }
        if (mode === "basic") requireVariables(["BITBUCKET_EMAIL"]);
        const allowlist = envCsv("BITBUCKET_REPOSITORY_ALLOWLIST");
        if (allowlist.includes("*")) {
          warnings.push("BITBUCKET_REPOSITORY_ALLOWLIST=*; narrow it for least privilege");
        }
        const healthParts = env("BITBUCKET_HEALTH_REPOSITORY", { required: true }).split("/");
        if (healthParts.length !== 2 || !healthParts[0] || !healthParts[1]) {
          errors.push("BITBUCKET_HEALTH_REPOSITORY must be workspace/repository");
        } else {
          try {
            assertBitbucketRepository(healthParts[0], healthParts[1], allowlist);
          } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
          }
        }
      }
      if (gitlabEnabled) {
        requireVariables([
          "GITLAB_BASE_URL",
          "GITLAB_TOKEN",
          "GITLAB_PROJECT_ALLOWLIST",
          "GITLAB_HEALTH_PROJECT",
        ]);
        safeUrl("GITLAB_BASE_URL");
        const mode = env("GITLAB_AUTH_MODE", {
          defaultValue: "private-token",
          allowPlaceholder: true,
        }).toLowerCase();
        if (!["private-token", "bearer"].includes(mode)) {
          errors.push("GITLAB_AUTH_MODE must be private-token or bearer");
        }
        const allowlist = envCsv("GITLAB_PROJECT_ALLOWLIST");
        if (allowlist.includes("*")) {
          warnings.push("GITLAB_PROJECT_ALLOWLIST=*; narrow it for least privilege");
        }
        try {
          assertGitLabProject(env("GITLAB_HEALTH_PROJECT", { required: true }), allowlist);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
}

await Promise.all([validateAgents(), validateSkills(), validateHooks(), validateLayout()]);
if (runtime) validateRuntime();

for (const warning of warnings) console.warn(`WARN: ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  console.error(`Validation failed with ${errors.length} error(s).`);
  process.exitCode = 1;
} else {
  console.log(
    `ITOps configuration validation passed (${runtime ? "structure + runtime" : "structure"}).`,
  );
}
