import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  escapeXml,
  generateDashboardXml,
  parseDashboardPanelsJson,
  splunkDashboardToolInputSchema,
} from "../src/splunk/dashboard.js";
import { assertSafeSplunkDashboardXml } from "../src/report/write.js";

function maximumContainerDepth(value: unknown, depth = 0): number {
  if (!value || typeof value !== "object") return depth;
  const nested = Array.isArray(value) ? value : Object.values(value);
  return nested.reduce(
    (maximum, item) => Math.max(maximum, maximumContainerDepth(item, depth + 1)),
    depth + 1,
  );
}

describe("offline Splunk Simple XML generation", () => {
  it("keeps the MCP-facing input schema below provider nesting limits", () => {
    const jsonSchema = z.toJSONSchema(splunkDashboardToolInputSchema);
    expect(maximumContainerDepth(jsonSchema)).toBeLessThanOrEqual(5);
    expect(jsonSchema).toMatchObject({
      type: "object",
      properties: {
        panelsJson: { type: "string" },
      },
    });
  });

  it("parses and validates the flat panelsJson tool input", () => {
    const panels = parseDashboardPanelsJson(
      JSON.stringify([
        {
          title: "Errors",
          search: "index=mobile | stats count by error_code",
          visualization: "table",
        },
      ]),
    );
    expect(panels).toEqual([
      expect.objectContaining({
        title: "Errors",
        earliest: "-24h",
        latest: "now",
        visualization: "table",
      }),
    ]);
    expect(() => parseDashboardPanelsJson("{")).toThrow(/valid JSON/i);
    expect(() => parseDashboardPanelsJson("[]")).toThrow();
  });

  it("escapes user-controlled XML and emits no upload behavior", () => {
    expect(escapeXml("<x a=\"b\">&</x>")).toBe("&lt;x a=&quot;b&quot;&gt;&amp;&lt;/x&gt;");
    const xml = generateDashboardXml("Mobile & API", "Latency < errors", [
      {
        title: "5xx & latency",
        search: "index=mobile status>=500 | timechart count",
        earliest: "-60m",
        latest: "now",
        visualization: "chart",
        chartType: "line",
      },
    ]);
    expect(xml).toContain("<dashboard version=\"1.1\"");
    expect(xml).toContain("<label>Mobile &amp; API</label>");
    expect(xml).toContain("status&gt;=500");
    expect(xml).not.toContain("outputlookup");
    expect(() => assertSafeSplunkDashboardXml(xml)).not.toThrow();
  });

  it("rejects a dashboard panel containing a mutating SPL command", () => {
    expect(() =>
      generateDashboardXml("Unsafe", undefined, [
        {
          title: "Unsafe",
          search: "index=mobile | outputlookup copied.csv",
          earliest: "-60m",
          latest: "now",
          visualization: "table",
        },
      ]),
    ).toThrow(/blocked/i);
  });

  it.each([
    '<!DOCTYPE dashboard [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><dashboard version="1.1" theme="light"></dashboard>',
    '<dashboard version="1.1" theme="light"><script>alert(1)</script></dashboard>',
    '<dashboard version="1.1" theme="light"><row href="https://outside.example"></row></dashboard>',
  ])("rejects unsafe XML: %s", (xml) => {
    expect(() => assertSafeSplunkDashboardXml(xml)).toThrow();
  });
});
