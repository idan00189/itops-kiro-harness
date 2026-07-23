import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { workspacePath } from "./env.js";
import { redactText } from "./redact.js";

type AuditRecord = {
  timestamp: string;
  server: string;
  tool: string;
  inputHash: string;
  durationMs: number;
  success: boolean;
  error?: string;
};

function hashInput(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

async function appendAudit(record: AuditRecord): Promise<void> {
  const path = workspacePath("ITOPS_AUDIT_LOG", "audit/mcp-audit.jsonl");
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
}

export async function audited<T>(
  server: string,
  tool: string,
  input: unknown,
  operation: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    const result = await operation();
    await appendAudit({
      timestamp: new Date().toISOString(),
      server,
      tool,
      inputHash: hashInput(input),
      durationMs: Math.round(performance.now() - start),
      success: true,
    });
    return result;
  } catch (error) {
    const message = redactText(error instanceof Error ? error.message : String(error)).slice(0, 500);
    await appendAudit({
      timestamp: new Date().toISOString(),
      server,
      tool,
      inputHash: hashInput(input),
      durationMs: Math.round(performance.now() - start),
      success: false,
      error: message,
    }).catch(() => undefined);
    throw error;
  }
}
