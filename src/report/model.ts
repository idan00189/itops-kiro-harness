import { z } from "zod";

const nonEmpty = z.string().trim().min(1).max(20_000);
const shortText = z.string().trim().min(1).max(1_000);
const timestamp = z.string().datetime({ offset: true });

export const incidentReportSchema = z.object({
  metadata: z.object({
    incidentId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/),
    title: shortText,
    severity: z.enum(["SEV-1", "SEV-2", "SEV-3", "SEV-4", "UNKNOWN"]),
    status: z.enum(["OPEN", "MONITORING", "RESOLVED", "UNKNOWN"]),
    incidentStartedAt: timestamp.optional(),
    detectedAt: timestamp.optional(),
    timezone: z.string().trim().min(1).max(64).default("Asia/Jerusalem"),
    systems: z.array(shortText).max(30).default([]),
  }),
  executiveSummary: nonEmpty,
  scope: z.array(nonEmpty).min(1).max(50),
  impact: z.array(nonEmpty).min(1).max(50),
  timeline: z
    .array(
      z.object({
        time: timestamp,
        source: shortText,
        event: nonEmpty,
        evidenceIds: z.array(z.string().max(64)).max(20).default([]),
      }),
    )
    .max(500)
    .default([]),
  findings: z
    .array(
      z.object({
        source: shortText,
        finding: nonEmpty,
        confidence: z.enum(["גבוהה", "בינונית", "נמוכה"]),
        evidenceIds: z.array(z.string().max(64)).max(50).default([]),
      }),
    )
    .min(1)
    .max(200),
  hypotheses: z
    .array(
      z.object({
        hypothesis: nonEmpty,
        status: z.enum(["מאומתת", "סבירה", "לא הוכרעה", "נשללה"]),
        confidence: z.number().int().min(0).max(100),
        supportingEvidence: z.array(nonEmpty).max(30).default([]),
        contradictingEvidence: z.array(nonEmpty).max(30).default([]),
      }),
    )
    .max(50)
    .default([]),
  rootCause: z.object({
    status: z.enum(["מאומת", "סביר", "לא הוכרע"]),
    statement: nonEmpty,
    evidenceIds: z.array(z.string().max(64)).max(50).default([]),
  }),
  recommendations: z
    .array(
      z.object({
        priority: z.enum(["P0", "P1", "P2", "P3"]),
        action: nonEmpty,
        owner: z.string().max(200).optional(),
        risk: nonEmpty,
        requiresChangeApproval: z.literal(true),
      }),
    )
    .max(100)
    .default([]),
  evidence: z
    .array(
      z.object({
        id: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
        source: shortText,
        observedAt: timestamp,
        description: nonEmpty,
        queryHash: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
        artifact: z.string().max(500).optional(),
      }),
    )
    .min(1)
    .max(1_000),
  limitations: z.array(nonEmpty).max(100).default([]),
  appendix: z
    .array(
      z.object({
        source: shortText,
        query: z.string().min(1).max(20_000),
        note: z.string().max(2_000).optional(),
      }),
    )
    .max(100)
    .default([]),
});

export type IncidentReport = z.infer<typeof incidentReportSchema>;

export function assertHebrewReport(report: IncidentReport): void {
  const humanText = [
    report.metadata.title,
    report.executiveSummary,
    ...report.scope,
    ...report.impact,
    ...report.timeline.map((item) => item.event),
    ...report.findings.map((item) => item.finding),
    ...report.hypotheses.map((item) => item.hypothesis),
    report.rootCause.statement,
    ...report.recommendations.map((item) => item.action),
    ...report.limitations,
  ].join(" ");
  const letters = humanText.match(/[A-Za-z\u0590-\u05FF]/g) ?? [];
  const hebrew = humanText.match(/[\u0590-\u05FF]/g) ?? [];
  if (letters.length < 30 || hebrew.length / letters.length < 0.25) {
    throw new Error("The report must be written primarily in Hebrew");
  }
}
