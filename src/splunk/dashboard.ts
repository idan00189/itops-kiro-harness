import { assertReadOnlySpl } from "../common/guards.js";

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
