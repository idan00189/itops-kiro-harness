import { assertNoControlCharacters } from "./env.js";
import { matchesAllowlist } from "./guards.js";

const DEFAULT_DENIED_PATHS = [
  ".env",
  ".env.*",
  "**/.env",
  "**/.env.*",
  "*.pem",
  "**/*.pem",
  "*.key",
  "**/*.key",
  "*.p12",
  "**/*.p12",
  "*.pfx",
  "**/*.pfx",
  "*.jks",
  "**/*.jks",
  "id_rsa",
  "**/id_rsa",
  "id_ed25519",
  "**/id_ed25519",
  ".netrc",
  "**/.netrc",
  ".npmrc",
  "**/.npmrc",
  "credentials/**",
  "**/credentials/**",
  "secrets/**",
  "**/secrets/**",
  "terraform.tfstate",
  "**/terraform.tfstate",
  "terraform.tfstate.*",
  "**/terraform.tfstate.*",
];

export function assertSourceRef(value: string): string {
  assertNoControlCharacters(value, "Source ref");
  const normalized = value.trim();
  if (
    !/^[A-Za-z0-9._/-]{1,255}$/.test(normalized) ||
    normalized.includes("..") ||
    normalized.includes("//") ||
    normalized.includes("@{") ||
    normalized.startsWith("-") ||
    normalized.startsWith("/") ||
    normalized.endsWith("/") ||
    normalized.endsWith(".")
  ) {
    throw new Error("Source ref is invalid");
  }
  return normalized;
}

export function assertSourcePath(value: string, extraDeniedPatterns: string[] = []): string {
  assertNoControlCharacters(value, "Repository path");
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/, "");
  if (
    !normalized ||
    normalized.length > 1_000 ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("Repository path is invalid");
  }
  const denied = [...DEFAULT_DENIED_PATHS, ...extraDeniedPatterns];
  if (matchesAllowlist(normalized, denied)) {
    throw new Error(`Repository path ${normalized} is blocked by the source-code secret policy`);
  }
  return normalized;
}

export function assertBitbucketRepository(
  workspace: string,
  repository: string,
  allowlist: string[],
): { workspace: string; repository: string; fullName: string } {
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(workspace)) {
    throw new Error("Bitbucket workspace is invalid");
  }
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(repository)) {
    throw new Error("Bitbucket repository slug is invalid");
  }
  const fullName = `${workspace}/${repository}`;
  if (!matchesAllowlist(fullName, allowlist)) {
    throw new Error(`Bitbucket repository ${fullName} is outside BITBUCKET_REPOSITORY_ALLOWLIST`);
  }
  return { workspace, repository, fullName };
}

export function assertGitLabProject(project: string, allowlist: string[]): string {
  const normalized = project.trim();
  if (
    !/^(?:\d{1,20}|[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)$/.test(normalized) ||
    normalized.includes("..")
  ) {
    throw new Error("GitLab project ID/path is invalid");
  }
  if (!matchesAllowlist(normalized, allowlist)) {
    throw new Error(`GitLab project ${normalized} is outside GITLAB_PROJECT_ALLOWLIST`);
  }
  return normalized;
}

export function assertTextSource(content: Buffer, label: string, maxBytes: number): string {
  if (content.byteLength > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes`);
  if (content.includes(0)) throw new Error(`${label} appears to be binary`);
  const text = content.toString("utf8");
  const replacementCount = [...text].filter((character) => character === "\uFFFD").length;
  if (replacementCount > Math.max(3, text.length * 0.01)) {
    throw new Error(`${label} is not valid UTF-8 text`);
  }
  return text;
}
