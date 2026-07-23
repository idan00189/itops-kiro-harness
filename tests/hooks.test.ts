import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

type HookResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

const temporaryDirectories: string[] = [];

async function runHook(
  script: string,
  input = "",
  environment: Record<string, string> = {},
): Promise<HookResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd: process.cwd(),
      env: { ...process.env, ...environment },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
    child.stdin.end(input);
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("Kiro v3 hook enforcement", () => {
  it("blocks built-in and mutation-shaped tools", async () => {
    for (const toolName of [
      "shell",
      "fs_write",
      "@itops-argocd/sync",
      "@untrusted/report_write_delete",
      "@untrusted/artifact_write_splunk_dashboard_upload",
    ]) {
      const result = await runHook(
        "scripts/hooks/readonly-guard.mjs",
        JSON.stringify({ tool_name: toolName }),
      );
      expect(result.exitCode, toolName).toBe(2);
      expect(result.stderr, toolName).toMatch(/blocks/i);
    }
  });

  it("allows reviewed reads, constrained local writers, and Dynatrace execute-dql", async () => {
    for (const toolName of [
      "@itops-splunk/splunk_search",
      "@itops-core/report_write",
      "@itops-core/artifact_write_splunk_dashboard",
      "@dynatrace-platform/execute-dql",
    ]) {
      const result = await runHook(
        "scripts/hooks/readonly-guard.mjs",
        JSON.stringify({ tool_name: toolName }),
      );
      expect(result, toolName).toMatchObject({ exitCode: 0, stderr: "" });
    }
  });

  it("fails closed when the pre-tool event is invalid JSON", async () => {
    const result = await runHook("scripts/hooks/readonly-guard.mjs", "{invalid");
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/invalid JSON/i);
  });

  it("adds the deterministic session policy context", async () => {
    const result = await runHook(
      "scripts/hooks/session-policy.mjs",
      JSON.stringify({ hook_event_name: "sessionStart" }),
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("sole user-facing agent");
    expect(result.stdout).toContain("never execute remediation");
  });

  it("audits metadata without recording tool inputs or responses", async () => {
    await mkdir(join(process.cwd(), "work"), { recursive: true });
    const directory = await mkdtemp(join(process.cwd(), "work", "qa-hooks-"));
    temporaryDirectories.push(directory);
    const auditPath = join(directory, "hook-audit.jsonl");
    const result = await runHook(
      "scripts/hooks/audit-tool.mjs",
      JSON.stringify({
        hook_event_name: "postToolUse",
        session_id: "qa-session",
        tool_name: "@itops-splunk/splunk_search",
        tool_input: { token: "must-not-be-recorded" },
        tool_response: { secret: "must-not-be-recorded" },
      }),
      {
        ITOPS_HOOK_AUDIT_LOG: relative(process.cwd(), auditPath),
      },
    );
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const record = await readFile(auditPath, "utf8");
    expect(record).toContain("qa-session");
    expect(record).toContain("@itops-splunk/splunk_search");
    expect(record).not.toContain("must-not-be-recorded");
  });
});
