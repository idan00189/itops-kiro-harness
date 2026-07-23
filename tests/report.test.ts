import { describe, expect, it } from "vitest";
import { incidentReportSchema, assertHebrewReport, type IncidentReport } from "../src/report/model.js";
import { renderHtml, renderMarkdown } from "../src/report/render.js";

function reportFixture(): IncidentReport {
  return incidentReportSchema.parse({
    metadata: {
      incidentId: "INC-2026-001",
      title: "עלייה בשיעור השגיאות באפליקציה",
      severity: "SEV-2",
      status: "OPEN",
      timezone: "Asia/Jerusalem",
      systems: ["mobile-api", "Splunk"],
    },
    executiveSummary:
      "זוהתה עלייה בשגיאות בחיבור לשירות. הממצאים מצביעים על תלות חיצונית איטית, אך נדרש אימות נוסף.",
    scope: ["נבדקו לוגים, מדדים ומצב פריסה בחלון הזמן המוגדר."],
    impact: ["חלק מהמשתמשים חוו כשל זמני בכניסה לאפליקציה."],
    timeline: [
      {
        time: "2026-07-23T09:00:00+03:00",
        source: "Splunk",
        event: "שיעור השגיאות החל לעלות.",
        evidenceIds: ["E-1"],
      },
    ],
    findings: [
      {
        source: "Dynatrace",
        finding: "זמן התגובה של התלות החיצונית עלה.",
        confidence: "גבוהה",
        evidenceIds: ["E-1"],
      },
    ],
    hypotheses: [
      {
        hypothesis: "איטיות בתלות החיצונית גרמה לכשלים.",
        status: "סבירה",
        confidence: 80,
        supportingEvidence: ["קיים מתאם בזמן בין האיטיות לשגיאות."],
        contradictingEvidence: [],
      },
    ],
    rootCause: {
      status: "סביר",
      statement: "הגורם הסביר הוא האטה בתלות החיצונית; טרם התקבל אישור סופי.",
      evidenceIds: ["E-1"],
    },
    recommendations: [
      {
        priority: "P1",
        action: "לבחון התאמת פסק זמן במסגרת תהליך שינוי מאושר.",
        risk: "שינוי לא מבוקר עלול להגדיל עומס.",
        requiresChangeApproval: true,
      },
    ],
    evidence: [
      {
        id: "E-1",
        source: "Dynatrace",
        observedAt: "2026-07-23T09:05:00+03:00",
        description: "מדד זמן תגובה בחלון התקרית.",
      },
    ],
    limitations: ["לא הייתה גישה לנתוני ספק התלות."],
    appendix: [{ source: "Splunk", query: "index=mobile token=super-secret | stats count" }],
  });
}

describe("Hebrew incident report", () => {
  it("validates and renders the default Markdown report", () => {
    const report = reportFixture();
    expect(() => assertHebrewReport(report)).not.toThrow();
    const output = renderMarkdown(report, "2026-07-23T10:00:00.000Z");
    expect(output).toContain("# דוח תחקור תקרית");
    expect(output).toContain("לא בוצעו שינויים");
    expect(output).toContain("token=[REDACTED]");
  });

  it("renders standalone RTL HTML and escapes untrusted content", () => {
    const report = reportFixture();
    report.executiveSummary += " <script>alert('x')</script>";
    const output = renderHtml(report, "2026-07-23T10:00:00.000Z");
    expect(output).toContain('<html lang="he" dir="rtl">');
    expect(output).toContain("&lt;script&gt;");
    expect(output).not.toContain("<script>alert");
  });

  it("rejects reports that are not primarily Hebrew", () => {
    const report = reportFixture();
    report.metadata.title = "Mobile app errors";
    report.executiveSummary =
      "This report contains only English investigation language and no meaningful Hebrew content.";
    report.scope = ["Logs and metrics were reviewed."];
    report.impact = ["Users experienced errors."];
    report.timeline = [];
    report.findings = [
      {
        source: "Splunk",
        finding: "The error rate increased.",
        confidence: "גבוהה",
        evidenceIds: ["E-1"],
      },
    ];
    report.hypotheses = [];
    report.rootCause.statement = "The cause is not yet confirmed.";
    report.recommendations = [];
    report.limitations = ["No additional data was available."];
    expect(() => assertHebrewReport(report)).toThrow(/Hebrew/i);
  });
});
