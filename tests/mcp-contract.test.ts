import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ITOPS_V3_MCP_TOOLS } from "../src/kiro/contract.js";

type RunningMcp = {
  client: Client;
  close: () => Promise<void>;
};

const servers = [
  ["itops-core", "dist/mcp/core.js", "itops_core_health"],
  ["itops-splunk", "dist/mcp/splunk.js", "splunk_health"],
  ["itops-sql-server", "dist/mcp/sql-server.js", "sql_health"],
  ["itops-mongodb-docdb", "dist/mcp/mongodb-docdb.js", "mongodb_health"],
  ["itops-argocd", "dist/mcp/argocd.js", "argocd_health"],
  ["itops-source-code", "dist/mcp/source-code.js", "source_code_health"],
] as const;

let qaDirectory = "";

function childEnvironment(extra: Record<string, string> = {}): Record<string, string> {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  return {
    ...inherited,
    ITOPS_ENABLE_ATLASSIAN: "false",
    ITOPS_ENABLE_SPLUNK: "false",
    ITOPS_ENABLE_SQLSERVER: "false",
    ITOPS_ENABLE_MONGODB: "false",
    ITOPS_ENABLE_ARGOCD: "false",
    ITOPS_ENABLE_SOURCE_CODE: "false",
    ITOPS_ENABLE_BITBUCKET: "false",
    ITOPS_ENABLE_GITLAB: "false",
    ITOPS_AUDIT_LOG: join(qaDirectory, "audit", "mcp.jsonl"),
    ITOPS_REPORT_DIR: join(qaDirectory, "reports"),
    ITOPS_ARTIFACT_DIR: join(qaDirectory, "artifacts"),
    ...extra,
  };
}

async function connect(serverPath: string, extra: Record<string, string> = {}): Promise<RunningMcp> {
  const client = new Client(
    { name: "itops-contract-qa", version: "1.0.0" },
    { capabilities: {} },
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(serverPath)],
    cwd: process.cwd(),
    env: childEnvironment(extra),
    stderr: "pipe",
  });
  await client.connect(transport);
  return {
    client,
    close: () => client.close(),
  };
}

function textContent(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const first = result.content?.find(
    (item): item is { type: "text"; text: string } => item.type === "text",
  );
  if (!first) throw new Error("MCP result did not contain text content");
  return first.text;
}

function reportFixture(): Record<string, unknown> {
  return {
    metadata: {
      incidentId: "INC-QA-001",
      title: "בדיקת איכות מלאה של רתמת התחקור",
      severity: "SEV-3",
      status: "RESOLVED",
      timezone: "Asia/Jerusalem",
      systems: ["qa"],
    },
    executiveSummary:
      "בדיקת האיכות אימתה את יצירת הדוח המקומי דרך פרוטוקול הכלים, ללא כל שינוי במערכות חיצוניות.",
    scope: ["נבדקו חוזה הכלים, כתיבה מקומית בטוחה ועיבוד תוכן בעברית."],
    impact: ["לא הייתה השפעה על סביבת ייצור משום שכל הבדיקה מקומית ומבודדת."],
    timeline: [],
    findings: [
      {
        source: "QA",
        finding: "שרת הכלים החזיר תוצאה תקינה וכתב קובץ מקומי בתחום המותר.",
        confidence: "גבוהה",
        evidenceIds: ["QA-1"],
      },
    ],
    hypotheses: [],
    rootCause: {
      status: "מאומת",
      statement: "מסלול יצירת הדוח פועל בהתאם לחוזה המצומצם והמאומת.",
      evidenceIds: ["QA-1"],
    },
    recommendations: [],
    evidence: [
      {
        id: "QA-1",
        source: "MCP contract test",
        observedAt: "2026-07-23T20:00:00.000Z",
        description: "קריאת כלי מקומית מוצלחת דרך תעבורת stdio.",
      },
    ],
    limitations: ["הבדיקה אינה משתמשת באישורי גישה של סביבת הייצור."],
    appendix: [],
  };
}

beforeAll(async () => {
  const workDirectory = resolve("work");
  await mkdir(workDirectory, { recursive: true });
  qaDirectory = await mkdtemp(join(workDirectory, "itops-mcp-qa-"));
});

afterAll(async () => {
  await rm(qaDirectory, { recursive: true, force: true });
});

describe("compiled MCP protocol contracts", () => {
  it("exposes exactly the trusted local tools with safe annotations", async () => {
    for (const [serverName, serverPath] of servers) {
      const running = await connect(serverPath);
      try {
        const response = await running.client.listTools();
        const expected = ITOPS_V3_MCP_TOOLS.filter((tool) =>
          tool.startsWith(`${serverName}/`),
        )
          .map((tool) => tool.slice(serverName.length + 1))
          .sort();
        const actual = response.tools.map((tool) => tool.name).sort();
        expect(actual, serverName).toEqual(expected);

        for (const tool of response.tools) {
          expect(tool.annotations?.destructiveHint, `${serverName}/${tool.name}`).toBe(false);
          const localWriter =
            serverName === "itops-core" &&
            ["report_write", "artifact_write_splunk_dashboard"].includes(tool.name);
          expect(tool.annotations?.readOnlyHint, `${serverName}/${tool.name}`).toBe(!localWriter);
        }
      } finally {
        await running.close();
      }
    }
  });

  it("returns a deterministic disabled status from every local health tool", async () => {
    for (const [, serverPath, healthTool] of servers) {
      const running = await connect(serverPath);
      try {
        const result = await running.client.callTool({ name: healthTool, arguments: {} });
        expect(result.isError).not.toBe(true);
        expect(JSON.parse(textContent(result))).toMatchObject({ status: "disabled" });
      } finally {
        await running.close();
      }
    }
  });

  it("keeps report_write shallow and writes Markdown and HTML through MCP", async () => {
    const running = await connect("dist/mcp/core.js");
    try {
      const tools = await running.client.listTools();
      const reportTool = tools.tools.find((tool) => tool.name === "report_write");
      expect(reportTool?.inputSchema.properties).toHaveProperty("reportJson");
      expect(reportTool?.inputSchema.properties).not.toHaveProperty("report");
      expect(JSON.stringify(reportTool?.inputSchema)).not.toContain("executiveSummary");

      for (const format of ["md", "html"] as const) {
        const result = await running.client.callTool({
          name: "report_write",
          arguments: { reportJson: JSON.stringify(reportFixture()), format },
        });
        expect(result.isError, textContent(result)).not.toBe(true);
      }

      const files = await readdir(join(qaDirectory, "reports"));
      expect(files.some((file) => file.endsWith(".md"))).toBe(true);
      expect(files.some((file) => file.endsWith(".html"))).toBe(true);
      const markdownName = files.find((file) => file.endsWith(".md"));
      const htmlName = files.find((file) => file.endsWith(".html"));
      expect(await readFile(join(qaDirectory, "reports", markdownName!), "utf8")).toContain(
        "# דוח תחקור תקרית",
      );
      expect(await readFile(join(qaDirectory, "reports", htmlName!), "utf8")).toContain(
        '<html lang="he" dir="rtl">',
      );
    } finally {
      await running.close();
    }
  });

  it("generates and persists a safe Splunk dashboard without uploading it", async () => {
    const splunk = await connect("dist/mcp/splunk.js");
    let xml = "";
    try {
      const generated = await splunk.client.callTool({
        name: "splunk_generate_dashboard_xml",
        arguments: {
          title: "Mobile QA",
          description: "Offline contract test",
          panelsJson: JSON.stringify([
            {
              title: "Errors",
              search: "index=mobile error | timechart count",
              earliest: "-15m",
              latest: "now",
              visualization: "chart",
              chartType: "line",
            },
          ]),
        },
      });
      expect(generated.isError, textContent(generated)).not.toBe(true);
      const payload = JSON.parse(textContent(generated)) as {
        xml: string;
        uploadPerformed: boolean;
      };
      expect(payload.uploadPerformed).toBe(false);
      xml = payload.xml;
    } finally {
      await splunk.close();
    }

    const core = await connect("dist/mcp/core.js");
    try {
      const stored = await core.client.callTool({
        name: "artifact_write_splunk_dashboard",
        arguments: { filename: "mobile-qa.xml", xml },
      });
      expect(stored.isError, textContent(stored)).not.toBe(true);
      expect(await readFile(join(qaDirectory, "artifacts", "mobile-qa.xml"), "utf8")).toContain(
        '<dashboard version="1.1"',
      );
    } finally {
      await core.close();
    }
  });

  it("exposes multiple SQL connections and fails closed before any unsafe or ambiguous query", async () => {
    const running = await connect("dist/mcp/sql-server.js", {
      ITOPS_ENABLE_SQLSERVER: "true",
      SQLSERVER_CONNECTIONS: "east,west",
      SQLSERVER_EAST_AUTH_MODE: "sql",
      SQLSERVER_EAST_HOST: "east-listener.invalid",
      SQLSERVER_EAST_DATABASE: "MobileEast",
      SQLSERVER_EAST_USERNAME: "readonly",
      SQLSERVER_EAST_PASSWORD: "qa-password",
      SQLSERVER_WEST_AUTH_MODE: "sql",
      SQLSERVER_WEST_HOST: "west-listener.invalid",
      SQLSERVER_WEST_DATABASE: "MobileWest",
      SQLSERVER_WEST_USERNAME: "readonly",
      SQLSERVER_WEST_PASSWORD: "qa-password",
      SQLSERVER_ENCRYPT: "true",
      SQLSERVER_TRUST_SERVER_CERTIFICATE: "false",
    });
    try {
      const listed = await running.client.callTool({
        name: "sql_list_connections",
        arguments: {},
      });
      expect(listed.isError).not.toBe(true);
      const payload = JSON.parse(textContent(listed)) as {
        connections: Array<{ name: string; database: string }>;
      };
      expect(payload.connections).toEqual([
        expect.objectContaining({ name: "east", database: "MobileEast" }),
        expect.objectContaining({ name: "west", database: "MobileWest" }),
      ]);
      expect(JSON.stringify(payload)).not.toContain("qa-password");
      expect(JSON.stringify(payload)).not.toContain("listener.invalid");

      const mutation = await running.client.callTool({
        name: "sql_query",
        arguments: { connection: "east", query: "DELETE FROM dbo.Users" },
      });
      expect(mutation.isError).toBe(true);
      expect(textContent(mutation)).toMatch(/read-only|SELECT|blocked/i);

      const ambiguous = await running.client.callTool({
        name: "sql_query",
        arguments: { query: "SELECT 1" },
      });
      expect(ambiguous.isError).toBe(true);
      expect(textContent(ambiguous)).toMatch(/connection is required/i);
    } finally {
      await running.close();
    }
  });

  it("exposes multiple MongoDB URIs and rejects system databases and write operators pre-network", async () => {
    const running = await connect("dist/mcp/mongodb-docdb.js", {
      ITOPS_ENABLE_MONGODB: "true",
      MONGODB_CONNECTIONS: "main,archive",
      MONGODB_MAIN_MODE: "mongodb",
      MONGODB_MAIN_URI: "mongodb://readonly:qa-password@main.invalid/?tls=true",
      MONGODB_MAIN_DATABASE_ALLOWLIST: "mobile_*",
      MONGODB_MAIN_COLLECTION_ALLOWLIST: "events,users",
      MONGODB_MAIN_READ_PREFERENCE: "secondaryPreferred",
      MONGODB_ARCHIVE_MODE: "documentdb",
      MONGODB_ARCHIVE_URI: "mongodb://readonly:qa-password@archive.invalid/?tls=true",
      MONGODB_ARCHIVE_DATABASE_ALLOWLIST: "archive",
      MONGODB_ARCHIVE_COLLECTION_ALLOWLIST: "*",
      MONGODB_ARCHIVE_READ_PREFERENCE: "secondaryPreferred",
    });
    try {
      const listed = await running.client.callTool({
        name: "mongodb_list_connections",
        arguments: {},
      });
      expect(listed.isError).not.toBe(true);
      const text = textContent(listed);
      const payload = JSON.parse(text) as {
        connections: Array<{ name: string; mode: string }>;
      };
      expect(payload.connections).toEqual([
        expect.objectContaining({ name: "main", mode: "mongodb" }),
        expect.objectContaining({ name: "archive", mode: "documentdb" }),
      ]);
      expect(text).not.toContain("qa-password");
      expect(text).not.toContain("main.invalid");

      const serverSideCode = await running.client.callTool({
        name: "mongodb_find",
        arguments: {
          connection: "main",
          database: "mobile_prod",
          collection: "events",
          filter: { $where: "return true" },
        },
      });
      expect(serverSideCode.isError).toBe(true);
      expect(textContent(serverSideCode)).toMatch(/MongoDB operator.*blocked/i);

      const systemDatabase = await running.client.callTool({
        name: "mongodb_find",
        arguments: {
          connection: "main",
          database: "admin",
          collection: "events",
          filter: {},
        },
      });
      expect(systemDatabase.isError).toBe(true);
      expect(textContent(systemDatabase)).toMatch(/system database/i);

      const writePipeline = await running.client.callTool({
        name: "mongodb_aggregate",
        arguments: {
          connection: "main",
          database: "mobile_prod",
          collection: "events",
          pipeline: [{ $out: "copied" }],
        },
      });
      expect(writePipeline.isError).toBe(true);
      expect(textContent(writePipeline)).toMatch(/not allowlisted|blocked/i);

      const ambiguous = await running.client.callTool({
        name: "mongodb_find",
        arguments: {
          database: "mobile_prod",
          collection: "events",
          filter: {},
        },
      });
      expect(ambiguous.isError).toBe(true);
      expect(textContent(ambiguous)).toMatch(/connection is required/i);
    } finally {
      await running.close();
    }
  });
});
