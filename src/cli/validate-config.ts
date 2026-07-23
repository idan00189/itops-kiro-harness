import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { parse } from "yaml";
import {
  loadMongoProfiles,
  loadSqlServerProfiles,
} from "../common/database-profiles.js";
import {
  enabled,
  env,
  envBoolean,
  envChoice,
  envCsv,
  envInteger,
  requireLoopbackUrl,
  requireSafeBaseUrl,
} from "../common/env.js";
import { configuredExecutable } from "../common/process.js";
import {
  assertBitbucketRepository,
  assertGitLabProject,
} from "../common/source-guards.js";
import {
  ITOPS_TRUSTED_MCP_TOOLS,
  ITOPS_TRUSTED_SUBAGENTS,
} from "./configure-kiro-permissions.js";

const root = process.cwd();
const runtime = process.argv.includes("--runtime");
const errors: string[] = [];
const warnings: string[] = [];
const specialistAgents = [
  "itops-splunk",
  "itops-sql-server",
  "itops-mongodb-docdb",
  "itops-dynatrace",
  "itops-argocd",
  "itops-source-code",
];

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
    ...specialistAgents.map((name) => `${name}.md`),
  ]);
  const files = (await readdir(directory)).filter((file) => file.endsWith(".md"));
  check(
    specialistAgents.length === ITOPS_TRUSTED_SUBAGENTS.length &&
      specialistAgents.every((name) =>
        ITOPS_TRUSTED_SUBAGENTS.includes(
          name as (typeof ITOPS_TRUSTED_SUBAGENTS)[number],
        ),
      ),
    "Machine-local trusted subagents must match the six specialist profiles",
  );
  check(files.length === expected.size, `Expected ${expected.size} agent profiles, found ${files.length}`);
  for (const name of expected) check(files.includes(name), `Missing agent profile ${name}`);

  for (const file of files) {
    try {
      const profile = await readFile(join(directory, file), "utf8");
      const config = frontmatter(profile);
      const tools = Array.isArray(config.tools) ? config.tools.map(String) : [];
      check(tools.includes("@mcp"), `${file}: tools must include @mcp`);
      check(config.includeMcpJson === false, `${file}: includeMcpJson must be false`);
      check(!tools.includes("read"), `${file}: generic read tools must remain disabled`);
      check(!tools.some((tool) => ["write", "shell", "web", "*", "@builtin"].includes(tool)), `${file}: unsafe tool tag`);
      check(
        file === "itops-orchestrator.md" ? tools.includes("subagent") : !tools.includes("subagent"),
        `${file}: invalid subagent capability`,
      );
      if (file === "itops-orchestrator.md") {
        const toolSettings = config.toolsSettings as
          | {
              subagent?: {
                availableAgents?: unknown[];
                trustedAgents?: unknown[];
              };
            }
          | undefined;
        const available = (toolSettings?.subagent?.availableAgents ?? []).map(String);
        const trusted = (toolSettings?.subagent?.trustedAgents ?? []).map(String);
        check(
          available.length === specialistAgents.length &&
            specialistAgents.every((name) => available.includes(name)),
          `${file}: availableAgents must contain only the six ITOps specialists`,
        );
        check(
          trusted.length === specialistAgents.length &&
            specialistAgents.every((name) => trusted.includes(name)),
          `${file}: trustedAgents must contain only the six read-only ITOps specialists`,
        );
        const resources = Array.isArray(config.resources) ? config.resources : [];
        const wikiKnowledgeBase = resources.find(
          (resource) =>
            resource &&
            typeof resource === "object" &&
            !Array.isArray(resource) &&
            (resource as Record<string, unknown>).type === "knowledgeBase" &&
            (resource as Record<string, unknown>).name === "ITOpsWiki",
        ) as Record<string, unknown> | undefined;
        check(wikiKnowledgeBase?.source === "file://wiki", `${file}: missing ITOpsWiki source`);
        check(wikiKnowledgeBase?.indexType === "best", `${file}: ITOpsWiki must use best indexing`);
        check(wikiKnowledgeBase?.autoUpdate === true, `${file}: ITOpsWiki must auto-update`);
        check(
          !resources.some(
            (resource) => typeof resource === "string" && resource.includes("wiki/**/*.md"),
          ),
          `${file}: wiki must be indexed, not injected eagerly`,
        );
        check(
          profile.includes("Default mode: direct chat answer."),
          `${file}: direct chat must be the default operating mode`,
        );
        check(
          profile.includes("Do not call `report_write`"),
          `${file}: missing report-write prohibition for direct chat`,
        );
        check(
          profile.includes("Full investigation/report mode."),
          `${file}: missing explicit report-mode entry conditions`,
        );
      } else {
        check(
          profile.includes("internal, non-user-facing"),
          `${file}: specialist must identify itself as an internal subagent`,
        );
      }
      const servers =
        config.mcpServers && typeof config.mcpServers === "object"
          ? Object.keys(config.mcpServers as Record<string, unknown>)
          : [];
      check(servers.length === 1, `${file}: must declare exactly one MCP server`);
      if (file === "itops-dynatrace.md") {
        const dynatraceServer = (
          config.mcpServers as Record<string, Record<string, unknown>>
        )["dynatrace-platform"];
        const oauth = dynatraceServer?.oauth as
          | { clientId?: unknown; clientSecret?: unknown; redirectUri?: unknown; oauthScopes?: unknown[] }
          | undefined;
        check(dynatraceServer?.type === "http", `${file}: Dynatrace must use remote HTTP MCP`);
        check(
          dynatraceServer?.url === "${DYNATRACE_MCP_URL}",
          `${file}: Dynatrace MCP URL must come from the environment`,
        );
        check(
          oauth?.clientId === "${DYNATRACE_OAUTH_CLIENT_ID}" &&
            oauth?.clientSecret === "${DYNATRACE_OAUTH_CLIENT_SECRET}" &&
            oauth?.redirectUri === "${DYNATRACE_OAUTH_REDIRECT_URI}",
          `${file}: Dynatrace OAuth values must come from the environment`,
        );
        const scopes = (oauth?.oauthScopes ?? []).map(String);
        check(
          scopes.length > 0 && !scopes.some((scope) => /(?:write|delete|manage|admin)/i.test(scope)),
          `${file}: Dynatrace OAuth scopes must be read-only`,
        );
      }
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
      const mcpMatches = rules
        .filter((rule) => rule.capability === "mcp" && rule.effect === "allow")
        .flatMap((rule) =>
          Array.isArray(rule.match) ? rule.match.map(String) : [],
        );
      const server = servers[0];
      if (server) {
        const machineTrustedForServer = ITOPS_TRUSTED_MCP_TOOLS.filter(
          (tool) => tool.startsWith(`${server}/`),
        );
        check(
          mcpMatches.length === machineTrustedForServer.length &&
            mcpMatches.every((tool) =>
              machineTrustedForServer.includes(
                tool as (typeof ITOPS_TRUSTED_MCP_TOOLS)[number],
              ),
            ),
          `${file}: exact MCP rules must match the machine-local ITOps trust list`,
        );
        check(
          !mcpMatches.some((tool) => tool.includes("*")),
          `${file}: wildcard MCP trust is forbidden`,
        );
      }
      if (file === "itops-sql-server.md") {
        check(
          profile.includes("itops-sql-server/sql_list_connections"),
          `${file}: missing named SQL connection discovery tool`,
        );
      }
      if (file === "itops-mongodb-docdb.md") {
        check(
          profile.includes("itops-mongodb-docdb/mongodb_list_connections") &&
            profile.includes("itops-mongodb-docdb/mongodb_list_databases"),
          `${file}: missing named URI/database discovery tools`,
        );
      }
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
      const interfaceConfig = parse(
        await readFile(join(directory, name, "agents", "openai.yaml"), "utf8"),
      ) as {
        interface?: {
          display_name?: string;
          short_description?: string;
          default_prompt?: string;
        };
      };
      check(
        Boolean(interfaceConfig.interface?.display_name),
        `${name}: openai.yaml must declare a display name`,
      );
      check(
        (interfaceConfig.interface?.short_description?.length ?? 0) >= 25 &&
          (interfaceConfig.interface?.short_description?.length ?? 0) <= 64,
        `${name}: openai.yaml short description must be 25-64 characters`,
      );
      check(
        interfaceConfig.interface?.default_prompt?.includes(`$${name}`),
        `${name}: openai.yaml default prompt must mention $${name}`,
      );
      if (name === "itops-orchestrate") {
        const description = String(config.description);
        check(
          description.includes("Use only") && description.includes("do not use for routine"),
          `${name}: full-investigation skill must not trigger for routine chat`,
        );
      }
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
            "AgentSpawn",
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
    "docs/AUTHENTICATION.md",
    "scripts/Initialize-ItOpsAuth.ps1",
    "scripts/Set-ItOpsKiroPermissions.ps1",
    "scripts/hooks/session-policy.mjs",
    "wiki/.gitkeep",
    ".kiro/steering/product.md",
    ".kiro/steering/tech.md",
    ".kiro/steering/structure.md",
    ".kiro/steering/wiki-policy.md",
    ".kiro/specs/itops-harness/requirements.md",
    ".kiro/specs/itops-harness/design.md",
    ".kiro/specs/itops-harness/tasks.md",
    "dist/mcp/core.js",
    "dist/mcp/splunk.js",
    "dist/mcp/sql-server.js",
    "dist/mcp/mongodb-docdb.js",
    "dist/mcp/argocd.js",
    "dist/mcp/source-code.js",
    ".kiro/skills/itops-orchestrate/references/wiki-evidence.md",
  ];
  for (const path of required) check(await exists(resolve(root, path)), `Missing required path ${path}`);
  const envFiles = (await readdir(resolve(root, "config"))).filter((file) => /\.env(?:\.example)?$/i.test(file));
  check(
    envFiles.every((file) => ["itops.env", "itops.env.example"].includes(file)),
    `Unexpected environment file(s): ${envFiles.join(", ")}`,
  );
  const gitignore = await readFile(resolve(root, ".gitignore"), "utf8");
  check(gitignore.includes("wiki/*"), "Private wiki contents must be ignored by Git");
  check(gitignore.includes("!wiki/.gitkeep"), "wiki/.gitkeep must remain tracked");
  const reporting = await readFile(resolve(root, ".kiro/steering/reporting.md"), "utf8");
  check(
    reporting.includes("The default interaction is a direct answer in Kiro chat"),
    "Reporting policy must default to direct chat",
  );
  check(
    reporting.includes("Never create a report merely because one or more specialists were used"),
    "Reporting policy must gate report creation independently of delegation",
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
      requireVariables(["SPLUNK_BASE_URL"]);
      safeUrl("SPLUNK_BASE_URL");
      const mode = envChoice("SPLUNK_AUTH_MODE", ["kerberos", "token"] as const, "kerberos");
      if (mode === "kerberos") {
        try {
          configuredExecutable("SPLUNK_CURL_PATH", "curl.exe", ["curl", "curl.exe"]);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
        try {
          if (requireSafeBaseUrl("SPLUNK_BASE_URL").protocol !== "https:") {
            errors.push("SPLUNK_AUTH_MODE=kerberos requires an HTTPS endpoint");
          }
        } catch {
          // safeUrl already recorded the actionable URL error.
        }
      } else {
        requireVariables(["SPLUNK_TOKEN"]);
        envChoice("SPLUNK_AUTH_SCHEME", ["bearer", "splunk"] as const, "bearer");
      }
    }
    if (enabled("SQLSERVER")) {
      const profiles = loadSqlServerProfiles();
      if (profiles.length > 1) {
        warnings.push(
          `SQL Server has ${profiles.length} named connections; every investigation tool call must select one explicitly`,
        );
      }
    }
    if (enabled("MONGODB")) {
      const profiles = loadMongoProfiles();
      for (const profile of profiles) {
        if (profile.databaseAllowlist.includes("*")) {
          warnings.push(
            `MongoDB connection ${profile.name} database allowlist includes *; access is limited only by the read-only database identity and the system-database denylist`,
          );
        }
        if (profile.collectionAllowlist.includes("*")) {
          warnings.push(
            `MongoDB connection ${profile.name} collection allowlist includes *; narrow it when possible`,
          );
        }
      }
    }
    if (enabled("DYNATRACE")) {
      requireVariables([
        "DYNATRACE_MCP_URL",
        "DYNATRACE_OAUTH_CLIENT_ID",
        "DYNATRACE_OAUTH_CLIENT_SECRET",
        "DYNATRACE_OAUTH_REDIRECT_URI",
      ]);
      safeUrl("DYNATRACE_MCP_URL");
      try {
        const mcpUrl = requireSafeBaseUrl("DYNATRACE_MCP_URL");
        if (!mcpUrl.pathname.endsWith("/platform-reserved/mcp-gateway/v0.1/servers/dynatrace-mcp/mcp")) {
          errors.push("DYNATRACE_MCP_URL must target the official Dynatrace MCP gateway path");
        }
        requireLoopbackUrl("DYNATRACE_OAUTH_REDIRECT_URI");
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (enabled("ARGOCD")) {
      requireVariables(["ARGOCD_BASE_URL"]);
      safeUrl("ARGOCD_BASE_URL");
      const mode = envChoice("ARGOCD_AUTH_MODE", ["cli-sso", "token"] as const, "cli-sso");
      if (mode === "cli-sso") {
        requireVariables(["ARGOCD_CLI_CONTEXT", "ARGOCD_CLI_SERVER"]);
        try {
          configuredExecutable("ARGOCD_CLI_PATH", "argocd.exe", ["argocd", "argocd.exe"]);
          const base = requireSafeBaseUrl("ARGOCD_BASE_URL");
          const serverValue = env("ARGOCD_CLI_SERVER", { required: true });
          const cliServer = new URL(
            serverValue.includes("://") ? serverValue : `https://${serverValue}`,
          );
          if (
            cliServer.protocol !== "https:" ||
            cliServer.username ||
            cliServer.password ||
            cliServer.search ||
            cliServer.hash
          ) {
            errors.push("ARGOCD_CLI_SERVER must be an HTTPS server without credentials, query, or fragment");
          }
          if (cliServer.host.toLowerCase() !== base.host.toLowerCase()) {
            errors.push("ARGOCD_CLI_SERVER must match the ARGOCD_BASE_URL host and port");
          }
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      } else {
        requireVariables(["ARGOCD_TOKEN"]);
      }
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
