import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const tracked = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
  maxBuffer: 10_000_000,
})
  .split("\0")
  .filter(Boolean);

const failures = [];
const forbiddenExtensions = new Set([".key", ".pem", ".pfx", ".p12", ".jks", ".keystore"]);
const generatedRoots = ["reports/", "artifacts/", "audit/"];
const highConfidenceSecrets = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
];

function fail(message) {
  failures.push(message);
}

for (const path of tracked) {
  const normalized = path.replaceAll("\\", "/");
  if (normalized.toLowerCase() === "config/itops.env") {
    fail("config/itops.env is tracked");
  }
  if (normalized.startsWith("wiki/") && normalized !== "wiki/.gitkeep") {
    fail(`private wiki content is tracked: ${normalized}`);
  }
  if (
    generatedRoots.some((root) => normalized.startsWith(root)) &&
    !normalized.endsWith("/.gitkeep")
  ) {
    fail(`generated operational output is tracked: ${normalized}`);
  }
  if (forbiddenExtensions.has(extname(normalized).toLowerCase())) {
    fail(`credential-bearing file extension is tracked: ${normalized}`);
  }

  let text;
  try {
    text = await readFile(normalized, "utf8");
  } catch {
    continue;
  }
  if (text.includes("\0")) continue;
  for (const [label, pattern] of highConfidenceSecrets) {
    if (pattern.test(text)) fail(`${label} signature found in ${normalized}`);
  }
}

if (!tracked.includes("wiki/.gitkeep")) fail("wiki/.gitkeep is not tracked");
if (!tracked.includes("reports/.gitkeep")) fail("reports/.gitkeep is not tracked");
if (!tracked.includes("artifacts/splunk/.gitkeep")) {
  fail("artifacts/splunk/.gitkeep is not tracked");
}
if (!tracked.includes("audit/.gitkeep")) fail("audit/.gitkeep is not tracked");

if (failures.length > 0) {
  for (const failure of failures) console.error(`ERROR: ${failure}`);
  console.error(`Static QA failed with ${failures.length} issue(s).`);
  process.exitCode = 1;
} else {
  console.log(`Static QA passed for ${tracked.length} tracked files; no operational outputs or high-confidence secret signatures found.`);
}
