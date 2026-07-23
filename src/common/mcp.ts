import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { audited } from "./audit.js";
import { boundedJson, redactText } from "./redact.js";

export const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export const localWriteAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

export function createServer(name: string, instructions: string): McpServer {
  return new McpServer(
    { name, version: "1.5.0" },
    {
      instructions,
      capabilities: { logging: {} },
    },
  );
}

export function ok(value: unknown): CallToolResult {
  const bounded = boundedJson(value);
  const structured =
    bounded.data && typeof bounded.data === "object" && !Array.isArray(bounded.data)
      ? (bounded.data as Record<string, unknown>)
      : { data: bounded.data };
  return {
    content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
    structuredContent: {
      ...structured,
      _meta: { truncated: bounded.truncated, originalBytes: bounded.bytes },
    },
  };
}

export function fail(error: unknown): CallToolResult {
  const message = redactText(error instanceof Error ? error.message : String(error));
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

export async function runTool(
  server: string,
  tool: string,
  input: unknown,
  operation: () => Promise<unknown>,
): Promise<CallToolResult> {
  try {
    return ok(await audited(server, tool, input, operation));
  } catch (error) {
    return fail(error);
  }
}

export async function startServer(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
