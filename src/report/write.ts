import { link, mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { workspacePath } from "../common/env.js";
import { redactText } from "../common/redact.js";
import type { IncidentReport } from "./model.js";
import { assertHebrewReport } from "./model.js";
import { renderHtml, renderMarkdown } from "./render.js";

export async function writeIncidentReport(
  report: IncidentReport,
  format: "md" | "html" = "md",
): Promise<{ path: string; format: string; generatedAt: string }> {
  assertHebrewReport(report);
  const generatedAt = new Date().toISOString();
  const stamp = generatedAt.replaceAll(/[:.]/g, "-");
  const outputDirectory = workspacePath("ITOPS_REPORT_DIR", "reports");
  await mkdir(outputDirectory, { recursive: true });
  const filename = `${report.metadata.incidentId}_${stamp}.${format}`;
  const destination = resolve(outputDirectory, filename);
  if (dirname(destination) !== outputDirectory) throw new Error("Unsafe report path");
  const content =
    format === "html" ? renderHtml(report, generatedAt) : renderMarkdown(report, generatedAt);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  try {
    await link(temporary, destination);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  return { path: destination, format, generatedAt };
}

export async function writeSplunkDashboardArtifact(
  filename: string,
  xml: string,
): Promise<{ path: string; bytes: number }> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,100}\.xml$/i.test(filename)) {
    throw new Error("Dashboard filename must be a safe .xml filename");
  }
  if (!/^<dashboard\b[\s\S]*<\/dashboard>\s*$/i.test(xml.trim())) {
    throw new Error("Artifact must be a complete Splunk <dashboard> XML document");
  }
  assertSafeSplunkDashboardXml(xml);
  if (Buffer.byteLength(xml, "utf8") > 1_000_000) throw new Error("Dashboard XML exceeds 1 MB");
  const outputDirectory = workspacePath("ITOPS_ARTIFACT_DIR", "artifacts/splunk");
  await mkdir(outputDirectory, { recursive: true });
  const destination = resolve(outputDirectory, filename);
  if (dirname(destination) !== outputDirectory) throw new Error("Unsafe artifact path");
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await writeFile(temporary, redactText(xml), { encoding: "utf8", flag: "wx", mode: 0o600 });
  try {
    await link(temporary, destination);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  return { path: destination, bytes: Buffer.byteLength(xml, "utf8") };
}

export function assertSafeSplunkDashboardXml(xml: string): void {
  if (/<!DOCTYPE|<!ENTITY|<\?|<!--|-->/i.test(xml)) {
    throw new Error("Dashboard XML declarations, entities, processing instructions, and comments are blocked");
  }
  if (/\b(?:href|src|on[a-z]+)\s*=/i.test(xml)) {
    throw new Error("Dashboard XML external links and event attributes are blocked");
  }
  const allowedTags = new Set([
    "dashboard",
    "label",
    "title",
    "description",
    "row",
    "panel",
    "table",
    "chart",
    "single",
    "event",
    "search",
    "query",
    "earliest",
    "latest",
    "option",
  ]);
  for (const match of xml.matchAll(/<\s*(\/?)\s*([A-Za-z][A-Za-z0-9-]*)([^>]*)>/g)) {
    const closing = match[1] === "/";
    const tag = (match[2] ?? "").toLowerCase();
    const attributes = (match[3] ?? "").trim();
    if (!allowedTags.has(tag)) throw new Error(`Dashboard XML tag <${tag}> is not allowlisted`);
    if (closing && attributes) throw new Error(`Dashboard XML closing tag </${tag}> is malformed`);
    if (!closing && tag === "dashboard" && !/^version="1\.1"\s+theme="(?:light|dark)"$/i.test(attributes)) {
      throw new Error("Dashboard XML has unsupported dashboard attributes");
    }
    if (!closing && tag === "option" && !/^name="charting\.chart"$/i.test(attributes)) {
      throw new Error("Dashboard XML has an unsupported option");
    }
    if (!closing && !["dashboard", "option"].includes(tag) && attributes) {
      throw new Error(`Dashboard XML attributes are not allowed on <${tag}>`);
    }
  }
}
