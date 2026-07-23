import { assertReadOnlySpl } from "../common/guards.js";
import { z } from "zod";

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export type DashboardPanel = {
  title: string;
  search: string;
  earliest: string;
  latest: string;
  visualization: "table" | "chart" | "single" | "event";
  chartType?: "line" | "area" | "bar" | "column" | "pie" | undefined;
};

const dashboardPanelsSchema = z
  .array(
    z.object({
      title: z.string().min(1).max(200),
      search: z.string().min(1).max(20_000),
      earliest: z.string().min(1).max(100).default("-24h"),
      latest: z.string().min(1).max(100).default("now"),
      visualization: z
        .enum(["table", "chart", "single", "event"])
        .default("table"),
      chartType: z.enum(["line", "area", "bar", "column", "pie"]).optional(),
    }),
  )
  .min(1)
  .max(24);

// Keep the MCP-facing schema deliberately flat. Some model providers reject
// every tool in a server when one function declaration nests past five JSON
// levels. The panel structure is validated after parsing the JSON string.
export const splunkDashboardToolInputSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1_000).optional(),
  panelsJson: z.string().min(2).max(200_000),
});

export function parseDashboardPanelsJson(value: string): DashboardPanel[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("panelsJson must be valid JSON");
  }
  return dashboardPanelsSchema.parse(parsed);
}

export function generateDashboardXml(
  title: string,
  description: string | undefined,
  panels: DashboardPanel[],
): string {
  const rows: string[] = [];
  for (let index = 0; index < panels.length; index += 2) {
    const pair = panels.slice(index, index + 2);
    const rendered = pair
      .map((panel) => {
        const search = assertReadOnlySpl(panel.search);
        const tag = panel.visualization;
        const chartOption =
          tag === "chart"
            ? `\n        <option name="charting.chart">${escapeXml(panel.chartType ?? "line")}</option>`
            : "";
        return `    <panel>
      <title>${escapeXml(panel.title)}</title>
      <${tag}>
        <search>
          <query>${escapeXml(search)}</query>
          <earliest>${escapeXml(panel.earliest)}</earliest>
          <latest>${escapeXml(panel.latest)}</latest>
        </search>${chartOption}
      </${tag}>
    </panel>`;
      })
      .join("\n");
    rows.push(`  <row>\n${rendered}\n  </row>`);
  }
  return `<dashboard version="1.1" theme="light">
  <label>${escapeXml(title)}</label>${description ? `\n  <description>${escapeXml(description)}</description>` : ""}
${rows.join("\n")}
</dashboard>
`;
}
