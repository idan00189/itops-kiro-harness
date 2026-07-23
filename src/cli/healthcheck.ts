import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { enabled } from "../common/env.js";

type Check = {
  integration: string;
  enabledName: string;
  serverPath: string;
  tool: string;
};

const checks: Check[] = [
  {
    integration: "Atlassian/core",
    enabledName: "ATLASSIAN",
    serverPath: "dist/mcp/core.js",
    tool: "itops_core_health",
  },
  {
    integration: "Splunk",
    enabledName: "SPLUNK",
    serverPath: "dist/mcp/splunk.js",
    tool: "splunk_health",
  },
  {
    integration: "SQL Server",
    enabledName: "SQLSERVER",
    serverPath: "dist/mcp/sql-server.js",
    tool: "sql_health",
  },
  {
    integration: "MongoDB/DocumentDB",
    enabledName: "MONGODB",
    serverPath: "dist/mcp/mongodb-docdb.js",
    tool: "mongodb_health",
  },
  {
    integration: "Argo CD",
    enabledName: "ARGOCD",
    serverPath: "dist/mcp/argocd.js",
    tool: "argocd_health",
  },
  {
    integration: "Bitbucket/GitLab source code",
    enabledName: "SOURCE_CODE",
    serverPath: "dist/mcp/source-code.js",
    tool: "source_code_health",
  },
];

let failures = 0;
if (enabled("DYNATRACE")) {
  console.log(
    "DEFER Dynatrace: Kiro validates the remote MCP and browser OAuth when the Dynatrace subagent starts",
  );
}
for (const check of checks) {
  if (!enabled(check.enabledName)) {
    console.log(`SKIP ${check.integration}: disabled`);
    continue;
  }
  const client = new Client(
    { name: "itops-healthcheck", version: "1.5.0" },
    { capabilities: {} },
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [check.serverPath],
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: check.tool, arguments: {} });
    if (result.isError) {
      throw new Error(`MCP tool returned an error: ${JSON.stringify(result.content)}`);
    }
    console.log(`PASS ${check.integration}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${check.integration}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await client.close().catch(() => undefined);
  }
}

if (failures) {
  console.error(`${failures} integration health check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log("All enabled read-only integration health checks passed.");
}
