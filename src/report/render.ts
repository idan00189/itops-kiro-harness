import type { IncidentReport } from "./model.js";
import { redactText } from "../common/redact.js";

function md(value: string): string {
  return redactText(value).replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function html(value: string): string {
  return redactText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function mdList(values: string[]): string {
  return values.length ? values.map((value) => `- ${md(value)}`).join("\n") : "- לא זמין";
}

function ids(values: string[]): string {
  return values.length ? values.map(md).join(", ") : "—";
}

function tableCell(value: string): string {
  return md(value).replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

export function renderMarkdown(report: IncidentReport, generatedAt = new Date().toISOString()): string {
  const lines: string[] = [
    `# דוח תחקור תקרית — ${md(report.metadata.title)}`,
    "",
    `> מזהה: \`${md(report.metadata.incidentId)}\` · חומרה: **${report.metadata.severity}** · מצב: **${report.metadata.status}**`,
    "",
    "## פרטי הדוח",
    "",
    `- זמן יצירה: ${generatedAt}`,
    `- אזור זמן: ${md(report.metadata.timezone)}`,
    `- תחילת התקרית: ${report.metadata.incidentStartedAt ?? "לא ידוע"}`,
    `- זמן זיהוי: ${report.metadata.detectedAt ?? "לא ידוע"}`,
    `- מערכות שנבדקו: ${report.metadata.systems.length ? report.metadata.systems.map(md).join(", ") : "לא צוין"}`,
    "",
    "## תקציר מנהלים",
    "",
    md(report.executiveSummary),
    "",
    "## היקף התחקור",
    "",
    mdList(report.scope),
    "",
    "## השפעה",
    "",
    mdList(report.impact),
    "",
    "## ציר זמן",
    "",
    "| זמן | מקור | אירוע | ראיות |",
    "|---|---|---|---|",
    ...report.timeline.map(
      (item) =>
        `| ${tableCell(item.time)} | ${tableCell(item.source)} | ${tableCell(item.event)} | ${tableCell(ids(item.evidenceIds))} |`,
    ),
    ...(report.timeline.length ? [] : ["| — | — | לא זמין | — |"]),
    "",
    "## ממצאים לפי מערכת",
    "",
    "| מקור | ממצא | ביטחון | ראיות |",
    "|---|---|---|---|",
    ...report.findings.map(
      (item) =>
        `| ${tableCell(item.source)} | ${tableCell(item.finding)} | ${item.confidence} | ${tableCell(ids(item.evidenceIds))} |`,
    ),
    "",
    "## השערות ובחינתן",
    "",
  ];

  for (const [index, hypothesis] of report.hypotheses.entries()) {
    lines.push(
      `### ${index + 1}. ${md(hypothesis.hypothesis)}`,
      "",
      `- מצב: **${hypothesis.status}**`,
      `- רמת ביטחון: **${hypothesis.confidence}%**`,
      "- ראיות תומכות:",
      mdList(hypothesis.supportingEvidence),
      "- ראיות סותרות:",
      mdList(hypothesis.contradictingEvidence),
      "",
    );
  }
  if (!report.hypotheses.length) lines.push("לא תועדו השערות.", "");

  lines.push(
    "## גורם שורש",
    "",
    `- סטטוס: **${report.rootCause.status}**`,
    `- מסקנה: ${md(report.rootCause.statement)}`,
    `- ראיות: ${ids(report.rootCause.evidenceIds)}`,
    "",
    "## המלצות — לא בוצעו שינויים",
    "",
    "> כל פעולה להלן היא המלצה בלבד ומחייבת אישור שינוי אנושי בתהליך המקובל.",
    "",
    "| עדיפות | פעולה | בעלים | סיכון | אישור שינוי |",
    "|---|---|---|---|---|",
    ...report.recommendations.map(
      (item) =>
        `| ${item.priority} | ${tableCell(item.action)} | ${tableCell(item.owner ?? "טרם נקבע")} | ${tableCell(item.risk)} | נדרש |`,
    ),
    ...(report.recommendations.length ? [] : ["| — | לא הוגדרו | — | — | נדרש |"]),
    "",
    "## יומן ראיות",
    "",
    "| מזהה | מקור | זמן תצפית | תיאור | SHA-256 של שאילתה | תוצר |",
    "|---|---|---|---|---|---|",
    ...report.evidence.map(
      (item) =>
        `| ${tableCell(item.id)} | ${tableCell(item.source)} | ${tableCell(item.observedAt)} | ${tableCell(item.description)} | ${tableCell(item.queryHash ?? "—")} | ${tableCell(item.artifact ?? "—")} |`,
    ),
    "",
    "## מגבלות ופערי מידע",
    "",
    mdList(report.limitations),
    "",
    "## נספח שאילתות",
    "",
  );

  for (const item of report.appendix) {
    lines.push(
      `### ${md(item.source)}`,
      "",
      "```text",
      redactText(item.query).replaceAll("```", "\\`\\`\\`"),
      "```",
      ...(item.note ? [md(item.note), ""] : [""]),
    );
  }
  if (!report.appendix.length) lines.push("לא צורפו שאילתות גולמיות.", "");
  lines.push(
    "---",
    "",
    "דוח זה נוצר על ידי ITOps במצב תחקור לקריאה בלבד. אין בו אישור או תיעוד לביצוע שינוי במערכות הייצור.",
    "",
  );
  return lines.join("\n");
}

function htmlList(values: string[]): string {
  const items = values.length ? values : ["לא זמין"];
  return `<ul>${items.map((value) => `<li>${html(value)}</li>`).join("")}</ul>`;
}

function htmlTable(headers: string[], rows: string[][]): string {
  const body = rows.length ? rows : [["—", "לא זמין"]];
  return `<table><thead><tr>${headers.map((header) => `<th>${html(header)}</th>`).join("")}</tr></thead><tbody>${body
    .map((row) => `<tr>${row.map((cell) => `<td>${html(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

export function renderHtml(report: IncidentReport, generatedAt = new Date().toISOString()): string {
  const timeline = report.timeline.map((item) => [
    item.time,
    item.source,
    item.event,
    item.evidenceIds.join(", ") || "—",
  ]);
  const findings = report.findings.map((item) => [
    item.source,
    item.finding,
    item.confidence,
    item.evidenceIds.join(", ") || "—",
  ]);
  const evidence = report.evidence.map((item) => [
    item.id,
    item.source,
    item.observedAt,
    item.description,
    item.queryHash ?? "—",
    item.artifact ?? "—",
  ]);
  const hypotheses = report.hypotheses
    .map(
      (item, index) =>
        `<section><h3>${index + 1}. ${html(item.hypothesis)}</h3><p><strong>מצב:</strong> ${item.status} · <strong>ביטחון:</strong> ${item.confidence}%</p><h4>ראיות תומכות</h4>${htmlList(item.supportingEvidence)}<h4>ראיות סותרות</h4>${htmlList(item.contradictingEvidence)}</section>`,
    )
    .join("");
  const appendix = report.appendix
    .map(
      (item) =>
        `<section><h3>${html(item.source)}</h3><pre><code>${html(item.query)}</code></pre>${item.note ? `<p>${html(item.note)}</p>` : ""}</section>`,
    )
    .join("");
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${html(report.metadata.incidentId)} — ${html(report.metadata.title)}</title>
<style>
:root{color-scheme:light;--ink:#172033;--muted:#5c667a;--line:#d8deea;--accent:#2357d9;--panel:#f6f8fc}
body{font-family:Arial,"Noto Sans Hebrew",sans-serif;color:var(--ink);max-width:1100px;margin:0 auto;padding:40px;line-height:1.65;background:#fff}
h1,h2,h3{line-height:1.25}h1{border-bottom:4px solid var(--accent);padding-bottom:16px}h2{margin-top:38px}
.meta,.notice{background:var(--panel);border-right:5px solid var(--accent);padding:16px 20px;border-radius:8px}
table{width:100%;border-collapse:collapse;margin:14px 0 24px;font-size:.95rem}th,td{border:1px solid var(--line);padding:9px;text-align:right;vertical-align:top}th{background:var(--panel)}
pre{direction:ltr;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere;background:#101827;color:#eef3ff;padding:16px;border-radius:8px}
footer{margin-top:48px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font-size:.9rem}
@media print{body{padding:12mm}.notice{break-inside:avoid}table{break-inside:auto}tr{break-inside:avoid}}
</style>
</head>
<body>
<h1>דוח תחקור תקרית — ${html(report.metadata.title)}</h1>
<div class="meta"><strong>מזהה:</strong> ${html(report.metadata.incidentId)} · <strong>חומרה:</strong> ${report.metadata.severity} · <strong>מצב:</strong> ${report.metadata.status}<br><strong>נוצר:</strong> ${generatedAt} · <strong>אזור זמן:</strong> ${html(report.metadata.timezone)}</div>
<h2>תקציר מנהלים</h2><p>${html(report.executiveSummary).replaceAll("\n", "<br>")}</p>
<h2>היקף התחקור</h2>${htmlList(report.scope)}
<h2>השפעה</h2>${htmlList(report.impact)}
<h2>ציר זמן</h2>${htmlTable(["זמן", "מקור", "אירוע", "ראיות"], timeline)}
<h2>ממצאים לפי מערכת</h2>${htmlTable(["מקור", "ממצא", "ביטחון", "ראיות"], findings)}
<h2>השערות ובחינתן</h2>${hypotheses || "<p>לא תועדו השערות.</p>"}
<h2>גורם שורש</h2><p><strong>סטטוס:</strong> ${report.rootCause.status}</p><p>${html(report.rootCause.statement)}</p><p><strong>ראיות:</strong> ${html(report.rootCause.evidenceIds.join(", ") || "—")}</p>
<h2>המלצות — לא בוצעו שינויים</h2><div class="notice">כל פעולה להלן היא המלצה בלבד ומחייבת אישור שינוי אנושי.</div>${htmlTable(
    ["עדיפות", "פעולה", "בעלים", "סיכון", "אישור"],
    report.recommendations.map((item) => [
      item.priority,
      item.action,
      item.owner ?? "טרם נקבע",
      item.risk,
      "נדרש",
    ]),
  )}
<h2>יומן ראיות</h2>${htmlTable(["מזהה", "מקור", "זמן", "תיאור", "SHA-256", "תוצר"], evidence)}
<h2>מגבלות ופערי מידע</h2>${htmlList(report.limitations)}
<h2>נספח שאילתות</h2>${appendix || "<p>לא צורפו שאילתות גולמיות.</p>"}
<footer>דוח זה נוצר על ידי ITOps במצב תחקור לקריאה בלבד. אין בו אישור או תיעוד לביצוע שינוי במערכות הייצור.</footer>
</body></html>`;
}
