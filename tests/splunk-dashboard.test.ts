import { describe, expect, it } from "vitest";
import { escapeXml, generateDashboardXml } from "../src/splunk/dashboard.js";
import { assertSafeSplunkDashboardXml } from "../src/report/write.js";

describe("offline Splunk Simple XML generation", () => {
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
