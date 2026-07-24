import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { ITOPS_V3_MCP_TOOLS, ITOPS_V3_SPECIALIST_AGENTS } from "../src/kiro/contract.js";

const root = process.cwd();
const agentDirectory = join(root, ".kiro", "agents");
const agentNames = ["itops-orchestrator", ...ITOPS_V3_SPECIALIST_AGENTS];

async function profile(name: string): Promise<Record<string, unknown>> {
  const text = await readFile(join(agentDirectory, `${name}.md`), "utf8");
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match?.[1]) throw new Error(`Missing frontmatter for ${name}`);
  return parse(match[1]) as Record<string, unknown>;
}

describe("Kiro CLI v3 workspace contract", () => {
  it("uses seven Markdown profiles and exactly one inline MCP server per profile", async () => {
    for (const name of agentNames) {
      const config = await profile(name);
      expect(config.toolsSettings, `${name} must not use legacy toolsSettings`).toBeUndefined();
      expect(config.includeMcpJson).toBe(false);
      expect(Object.keys(config.mcpServers as Record<string, unknown>)).toHaveLength(1);
    }
  });

  it("declares exact v3 delegation and MCP permissions", async () => {
    const config = await profile("itops-orchestrator");
    const rules = (config.permissions as { rules: Array<Record<string, unknown>> }).rules;
    const subagents = rules
      .filter((rule) => rule.capability === "subagent" && rule.effect === "allow")
      .flatMap((rule) => (Array.isArray(rule.match) ? rule.match.map(String) : []));
    expect(subagents).toEqual([...ITOPS_V3_SPECIALIST_AGENTS]);

    const mcpRules = rules.filter((rule) => rule.capability === "mcp" && rule.effect === "allow");
    const coreTools = mcpRules.flatMap((rule) => (Array.isArray(rule.match) ? rule.match.map(String) : []));
    expect(coreTools).toEqual(ITOPS_V3_MCP_TOOLS.filter((tool) => tool.startsWith("itops-core/")));
  });

  it("starts through the v3 TUI and never through classic chat", async () => {
    const start = await readFile(join(root, "scripts", "Start-ItOps.ps1"), "utf8");
    expect(start).toContain("kiro-cli --v3 --tui --agent itops-orchestrator --require-mcp-startup");
    expect(start).not.toContain("--classic");
    expect(start).not.toContain("--legacy-ui");
  });

  it("does not ship a repository-side permission mutator", async () => {
    await expect(stat(join(root, "scripts", "Set-ItOpsKiroPermissions.ps1"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(stat(join(root, "src", "cli", "configure-kiro-permissions.ts"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
