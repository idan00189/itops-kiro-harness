import { appendFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import process from "node:process";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);

try {
  const event = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const workspace = resolve(process.cwd());
  const path = resolve(process.env.ITOPS_HOOK_AUDIT_LOG || "audit/kiro-hook-audit.jsonl");
  const pathFromWorkspace = relative(workspace, path);
  if (
    pathFromWorkspace === ".." ||
    pathFromWorkspace.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(pathFromWorkspace)
  ) {
    throw new Error("ITOPS_HOOK_AUDIT_LOG must resolve inside the ITOps workspace");
  }
  await mkdir(dirname(path), { recursive: true });
  const record = {
    timestamp: new Date().toISOString(),
    event: String(event.hook_event_name ?? event.hookEventName ?? "PostToolUse"),
    sessionId: String(event.session_id ?? event.sessionId ?? ""),
    tool: String(event.tool_name ?? event.toolName ?? ""),
  };
  await appendFile(path, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  process.exit(0);
} catch (error) {
  process.stderr.write(`ITOps audit hook warning: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
