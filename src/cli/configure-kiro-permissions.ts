import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";

type PermissionRule = {
  capability: string;
  effect: "allow";
  match: string[];
};

type ParsedPermissionRule = {
  capability: string;
  effect: "allow" | "ask" | "deny";
  match: string[];
  exclude: string[];
};

type PermissionDocument = {
  rules: unknown[];
  [key: string]: unknown;
};

type ManagedState = {
  version: 1;
  rules: PermissionRule[];
};

export const ITOPS_TRUSTED_SUBAGENTS = [
  "itops-splunk",
  "itops-sql-server",
  "itops-mongodb-docdb",
  "itops-dynatrace",
  "itops-argocd",
  "itops-source-code",
] as const;

export const ITOPS_TRUSTED_MCP_TOOLS = [
  "itops-core/jira_search",
  "itops-core/jira_get_issue",
  "itops-core/confluence_search",
  "itops-core/confluence_get_page",
  "itops-core/report_write",
  "itops-core/artifact_write_splunk_dashboard",
  "itops-core/itops_core_health",
  "itops-splunk/splunk_search",
  "itops-splunk/splunk_list_indexes",
  "itops-splunk/splunk_generate_dashboard_xml",
  "itops-splunk/splunk_health",
  "itops-sql-server/sql_list_connections",
  "itops-sql-server/sql_query",
  "itops-sql-server/sql_list_schema",
  "itops-sql-server/sql_health",
  "itops-mongodb-docdb/mongodb_list_connections",
  "itops-mongodb-docdb/mongodb_list_databases",
  "itops-mongodb-docdb/mongodb_find",
  "itops-mongodb-docdb/mongodb_aggregate",
  "itops-mongodb-docdb/mongodb_list_collections",
  "itops-mongodb-docdb/mongodb_sample_schema",
  "itops-mongodb-docdb/mongodb_health",
  "itops-argocd/argocd_list_applications",
  "itops-argocd/argocd_get_application",
  "itops-argocd/argocd_resource_tree",
  "itops-argocd/argocd_managed_resources",
  "itops-argocd/argocd_application_events",
  "itops-argocd/argocd_health",
  "itops-source-code/bitbucket_tree",
  "itops-source-code/bitbucket_read_file",
  "itops-source-code/bitbucket_commits",
  "itops-source-code/bitbucket_commit_diff",
  "itops-source-code/bitbucket_pull_request",
  "itops-source-code/bitbucket_pipelines",
  "itops-source-code/gitlab_tree",
  "itops-source-code/gitlab_read_file",
  "itops-source-code/gitlab_code_search",
  "itops-source-code/gitlab_commits",
  "itops-source-code/gitlab_commit_diff",
  "itops-source-code/gitlab_merge_request",
  "itops-source-code/gitlab_pipelines",
  "itops-source-code/gitlab_job_trace",
  "itops-source-code/source_code_health",
  "dynatrace-platform/nl2dql",
  "dynatrace-platform/dql2nl",
  "dynatrace-platform/dynatrace-conversation",
  "dynatrace-platform/execute-dql",
] as const;

export const REQUIRED_ITOPS_PERMISSION_RULES: PermissionRule[] = [
  {
    capability: "subagent",
    effect: "allow",
    match: [...ITOPS_TRUSTED_SUBAGENTS],
  },
  {
    capability: "mcp",
    effect: "allow",
    match: [...ITOPS_TRUSTED_MCP_TOOLS],
  },
];

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asDocument(value: unknown): PermissionDocument {
  if (value === null || value === undefined) return { rules: [] };
  if (!isObject(value)) {
    throw new Error("Kiro permissions.yaml must contain a YAML mapping");
  }
  const rules = value.rules ?? [];
  if (!Array.isArray(rules)) {
    throw new Error("Kiro permissions.yaml rules must be an array");
  }
  return { ...value, rules };
}

function asRule(value: unknown): PermissionRule | undefined {
  if (
    !isObject(value) ||
    typeof value.capability !== "string" ||
    value.effect !== "allow" ||
    !Array.isArray(value.match) ||
    !value.match.every((item) => typeof item === "string")
  ) {
    return undefined;
  }
  return {
    capability: value.capability,
    effect: "allow",
    match: [...value.match],
  };
}

function asPermissionRule(value: unknown): ParsedPermissionRule | undefined {
  if (
    !isObject(value) ||
    typeof value.capability !== "string" ||
    !["allow", "ask", "deny"].includes(String(value.effect)) ||
    (value.match !== undefined &&
      (!Array.isArray(value.match) ||
        !value.match.every((item) => typeof item === "string"))) ||
    (value.exclude !== undefined &&
      (!Array.isArray(value.exclude) ||
        !value.exclude.every((item) => typeof item === "string")))
  ) {
    return undefined;
  }
  return {
    capability: value.capability,
    effect: value.effect as ParsedPermissionRule["effect"],
    match: value.match ? [...value.match] : ["*"],
    exclude: value.exclude ? [...value.exclude] : [],
  };
}

function matchesKiroPattern(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replaceAll("*", ".*")}$`).test(value);
}

function sameRule(left: unknown, right: PermissionRule): boolean {
  const candidate = asRule(left);
  if (!candidate || candidate.capability !== right.capability) return false;
  const leftMatches = [...new Set(candidate.match)].sort();
  const rightMatches = [...new Set(right.match)].sort();
  return (
    leftMatches.length === rightMatches.length &&
    leftMatches.every((item, index) => item === rightMatches[index])
  );
}

export function removeManagedPermissionRules(
  existing: PermissionDocument,
  previous: readonly PermissionRule[],
): PermissionDocument {
  const remainingPrevious = [...previous];
  const rules = existing.rules.filter((candidate) => {
    const index = remainingPrevious.findIndex((managed) =>
      sameRule(candidate, managed),
    );
    if (index === -1) return true;
    remainingPrevious.splice(index, 1);
    return false;
  });
  return { ...existing, rules };
}

function hasAllowedMatch(
  document: PermissionDocument,
  capability: string,
  pattern: string,
): boolean {
  return document.rules.some((candidate) => {
    const rule = asRule(candidate);
    return (
      rule?.capability === capability &&
      rule.match.includes(pattern)
    );
  });
}

export function mergeManagedPermissionRules(
  existing: PermissionDocument,
  previous: readonly PermissionRule[] = [],
): { document: PermissionDocument; managed: PermissionRule[] } {
  const document = removeManagedPermissionRules(existing, previous);
  const managed: PermissionRule[] = [];
  for (const required of REQUIRED_ITOPS_PERMISSION_RULES) {
    const missing = required.match.filter(
      (pattern) => !hasAllowedMatch(document, required.capability, pattern),
    );
    if (missing.length === 0) continue;
    const rule: PermissionRule = {
      capability: required.capability,
      effect: "allow",
      match: missing,
    };
    document.rules.push(rule);
    managed.push(rule);
  }
  return { document, managed };
}

export function missingItOpsPermissions(
  document: PermissionDocument,
): string[] {
  return REQUIRED_ITOPS_PERMISSION_RULES.flatMap((rule) =>
    rule.match
      .filter(
        (pattern) => !hasAllowedMatch(document, rule.capability, pattern),
      )
      .map((pattern) => `${rule.capability}:${pattern}`),
  );
}

export function blockingItOpsPermissions(
  document: PermissionDocument,
): string[] {
  return REQUIRED_ITOPS_PERMISSION_RULES.flatMap((required) =>
    required.match.flatMap((resource) =>
      document.rules.flatMap((candidate) => {
        const rule = asPermissionRule(candidate);
        if (
          !rule ||
          rule.effect === "allow" ||
          ![required.capability, "all"].includes(rule.capability) ||
          !rule.match.some((pattern) => matchesKiroPattern(pattern, resource)) ||
          rule.exclude.some((pattern) => matchesKiroPattern(pattern, resource))
        ) {
          return [];
        }
        return [`${rule.effect}:${required.capability}:${resource}`];
      }),
    ),
  );
}

function defaultPaths(): { target: string; state: string } {
  const kiroHome = resolve(process.env.KIRO_HOME || join(homedir(), ".kiro"));
  const settings = join(kiroHome, "settings");
  return {
    target: join(settings, "permissions.yaml"),
    state: join(settings, "itops-permissions-state.json"),
  };
}

async function readYamlDocument(path: string): Promise<PermissionDocument> {
  try {
    return asDocument(parse(await readFile(path, "utf8")));
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return { rules: [] };
    }
    throw error;
  }
}

async function readState(path: string): Promise<ManagedState> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (
      !isObject(value) ||
      value.version !== 1 ||
      !Array.isArray(value.rules)
    ) {
      throw new Error("ITOps permission state is invalid");
    }
    const rules = value.rules.map(asRule);
    if (rules.some((rule) => !rule)) {
      throw new Error("ITOps permission state contains an invalid rule");
    }
    return { version: 1, rules: rules as PermissionRule[] };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return { version: 1, rules: [] };
    }
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

async function writeAtomically(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.itops-tmp-${process.pid}`;
  await writeFile(temporary, contents, { encoding: "utf8", mode: 0o600 });
  try {
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

function timestamp(): string {
  return new Date().toISOString().replaceAll(":", "").replaceAll(".", "-");
}

type CliOptions = {
  check: boolean;
  dryRun: boolean;
  remove: boolean;
  target?: string;
  state?: string;
};

function cliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    check: false,
    dryRun: false,
    remove: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--check") options.check = true;
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--remove") options.remove = true;
    else if (argument === "--target") {
      const value = args[++index];
      if (!value) throw new Error("--target requires a path");
      options.target = value;
    } else if (argument === "--state") {
      const value = args[++index];
      if (!value) throw new Error("--state requires a path");
      options.state = value;
    }
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.check && (options.remove || options.dryRun)) {
    throw new Error("--check cannot be combined with --remove or --dry-run");
  }
  return options;
}

export async function runConfigureKiroPermissions(
  args = process.argv.slice(2),
): Promise<void> {
  const options = cliOptions(args);
  const defaults = defaultPaths();
  const target = resolve(options.target || defaults.target);
  const statePath = resolve(options.state || defaults.state);
  const existing = await readYamlDocument(target);
  const state = await readState(statePath);
  const blocked = blockingItOpsPermissions(existing);
  if (!options.remove && blocked.length > 0) {
    throw new Error(
      `Kiro has ${blocked.length} explicit ask/deny rule conflict(s) for ITOps. Review ${target}; restrictive rules override allow rules. First conflict: ${blocked[0]}`,
    );
  }

  if (options.check) {
    const missing = missingItOpsPermissions(existing);
    if (missing.length > 0) {
      throw new Error(
        `Kiro is missing ${missing.length} ITOps permission(s). Run scripts\\Set-ItOpsKiroPermissions.ps1`,
      );
    }
    console.log(
      `Kiro ITOps permissions are configured (${ITOPS_TRUSTED_SUBAGENTS.length} subagents, ${ITOPS_TRUSTED_MCP_TOOLS.length} exact MCP tools).`,
    );
    return;
  }

  const result = options.remove
    ? {
        document: removeManagedPermissionRules(existing, state.rules),
        managed: [] as PermissionRule[],
      }
    : mergeManagedPermissionRules(existing, state.rules);

  if (options.dryRun) {
    console.log(
      stringify(result.document, { lineWidth: 0 }).trimEnd(),
    );
    return;
  }

  if (await exists(target)) {
    const backup = `${target}.itops-backup-${timestamp()}`;
    await copyFile(target, backup);
    console.log(`Backed up existing Kiro permissions to ${backup}`);
  }

  await writeAtomically(
    target,
    stringify(result.document, { lineWidth: 0 }),
  );
  await writeAtomically(
    statePath,
    `${JSON.stringify(
      { version: 1, rules: result.managed } satisfies ManagedState,
      null,
      2,
    )}\n`,
  );

  console.log(
    options.remove
      ? `Removed ITOps-managed trust rules from ${target}`
      : `Configured ${ITOPS_TRUSTED_SUBAGENTS.length} ITOps subagents and ${ITOPS_TRUSTED_MCP_TOOLS.length} exact MCP tools in ${target}`,
  );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  runConfigureKiroPermissions().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
