import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const integrationPrefixes = [
  "ATLASSIAN_",
  "SPLUNK_",
  "SQLSERVER_",
  "MONGODB_",
  "DYNATRACE_",
  "ARGOCD_",
  "BITBUCKET_",
  "GITLAB_",
  "SOURCE_CODE_",
];

function isolatedEnvironment(extra: Record<string, string> = {}): Record<string, string> {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined &&
        !entry[0].startsWith("ITOPS_ENABLE_") &&
        !integrationPrefixes.some((prefix) => entry[0].startsWith(prefix)),
    ),
  );
  return {
    ...inherited,
    ITOPS_ENABLE_ATLASSIAN: "false",
    ITOPS_ENABLE_SPLUNK: "false",
    ITOPS_ENABLE_SQLSERVER: "false",
    ITOPS_ENABLE_MONGODB: "false",
    ITOPS_ENABLE_DYNATRACE: "false",
    ITOPS_ENABLE_ARGOCD: "false",
    ITOPS_ENABLE_SOURCE_CODE: "false",
    ITOPS_ENABLE_BITBUCKET: "false",
    ITOPS_ENABLE_GITLAB: "false",
    ...extra,
  };
}

function validate(extra: Record<string, string> = {}): {
  status: number | null;
  output: string;
} {
  const result = spawnSync(
    process.execPath,
    ["dist/cli/validate-config.js", "--runtime"],
    {
      cwd: process.cwd(),
      env: isolatedEnvironment(extra),
      encoding: "utf8",
      timeout: 15_000,
    },
  );
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function completeEnvironment(): Record<string, string> {
  return {
    ITOPS_ENABLE_ATLASSIAN: "true",
    ATLASSIAN_BASE_URL: "https://tenant.atlassian.net",
    ATLASSIAN_AUTH_MODE: "basic",
    ATLASSIAN_EMAIL: "readonly@example.invalid",
    ATLASSIAN_API_TOKEN: "qa-atlassian-token",

    ITOPS_ENABLE_SPLUNK: "true",
    SPLUNK_BASE_URL: "https://splunk.example.invalid",
    SPLUNK_PORT: "8089",
    SPLUNK_AUTH_MODE: "token",
    SPLUNK_AUTH_SCHEME: "bearer",
    SPLUNK_TOKEN: "qa-splunk-token",

    ITOPS_ENABLE_SQLSERVER: "true",
    SQLSERVER_CONNECTIONS: "mobile",
    SQLSERVER_MOBILE_AUTH_MODE: "sql",
    SQLSERVER_MOBILE_HOST: "sql-listener.example.invalid",
    SQLSERVER_MOBILE_PORT: "1433",
    SQLSERVER_MOBILE_DATABASE: "Mobile",
    SQLSERVER_MOBILE_USERNAME: "readonly",
    SQLSERVER_MOBILE_PASSWORD: "qa-sql-password",
    SQLSERVER_ENCRYPT: "true",
    SQLSERVER_TRUST_SERVER_CERTIFICATE: "false",

    ITOPS_ENABLE_MONGODB: "true",
    MONGODB_CONNECTIONS: "mobile",
    MONGODB_MOBILE_MODE: "mongodb",
    MONGODB_MOBILE_URI:
      "mongodb://readonly:qa-mongo-password@mongo.example.invalid/?tls=true",
    MONGODB_MOBILE_READ_PREFERENCE: "secondaryPreferred",
    MONGODB_MOBILE_DATABASE_ALLOWLIST: "mobile_*",
    MONGODB_MOBILE_COLLECTION_ALLOWLIST: "events_*",

    ITOPS_ENABLE_DYNATRACE: "true",
    DYNATRACE_MCP_URL:
      "https://example.apps.dynatrace.com/platform-reserved/mcp-gateway/v0.1/servers/dynatrace-mcp/mcp",
    DYNATRACE_OAUTH_CLIENT_ID: "qa-dynatrace-client",
    DYNATRACE_OAUTH_CLIENT_SECRET: "qa-dynatrace-secret",
    DYNATRACE_OAUTH_REDIRECT_URI: "http://127.0.0.1:7778/oauth/callback",

    ITOPS_ENABLE_ARGOCD: "true",
    ARGOCD_BASE_URL: "https://argocd.example.invalid",
    ARGOCD_AUTH_MODE: "token",
    ARGOCD_TOKEN: "qa-argocd-token",
    ARGOCD_PROJECT_ALLOWLIST: "mobile",
    ARGOCD_APPLICATION_ALLOWLIST: "mobile-*",

    ITOPS_ENABLE_SOURCE_CODE: "true",
    ITOPS_ENABLE_BITBUCKET: "true",
    ITOPS_ENABLE_GITLAB: "true",
    BITBUCKET_BASE_URL: "https://api.bitbucket.org",
    BITBUCKET_AUTH_MODE: "bearer",
    BITBUCKET_API_TOKEN: "qa-bitbucket-token",
    BITBUCKET_REPOSITORY_ALLOWLIST: "team/mobile",
    BITBUCKET_HEALTH_REPOSITORY: "team/mobile",
    GITLAB_BASE_URL: "https://gitlab.example.invalid",
    GITLAB_AUTH_MODE: "private-token",
    GITLAB_TOKEN: "qa-gitlab-token",
    GITLAB_PROJECT_ALLOWLIST: "team/mobile",
    GITLAB_HEALTH_PROJECT: "team/mobile",
    SOURCE_CODE_PATH_DENYLIST: ".env,*.pem,*.key",
    SOURCE_CODE_MAX_FILE_BYTES: "250000",
    ITOPS_MAX_HTTP_RESPONSE_BYTES: "5000000",
  };
}

describe("runtime configuration CLI", () => {
  it("passes deterministically when every integration is disabled", () => {
    const result = validate();
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("validation passed");
  });

  it("accepts a complete multi-integration read-only environment without connecting", () => {
    const result = validate(completeEnvironment());
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("runtime");
    expect(result.output).not.toContain("qa-sql-password");
    expect(result.output).not.toContain("qa-dynatrace-secret");
  });

  it("rejects an enabled integration with missing required configuration", () => {
    const result = validate({ ITOPS_ENABLE_ATLASSIAN: "true" });
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/required environment variable: ATLASSIAN_BASE_URL/i);
    expect(result.output).toMatch(/required environment variable: ATLASSIAN_API_TOKEN/i);
  });

  it("rejects external cleartext endpoints and TLS-insecure database settings", () => {
    const environment = completeEnvironment();
    environment.ATLASSIAN_BASE_URL = "http://tenant.example.invalid";
    environment.MONGODB_MOBILE_URI =
      "mongodb://readonly:qa@mongo.example.invalid/?tlsInsecure=true";
    const result = validate(environment);
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/ATLASSIAN_BASE_URL must use HTTPS/i);
    expect(result.output).toMatch(/disables TLS certificate validation/i);
  });

  it("rejects an unofficial Dynatrace MCP path and oversized source reads", () => {
    const environment = completeEnvironment();
    environment.DYNATRACE_MCP_URL = "https://example.apps.dynatrace.com/other/mcp";
    environment.SOURCE_CODE_MAX_FILE_BYTES = "2000000";
    environment.ITOPS_MAX_HTTP_RESPONSE_BYTES = "1000000";
    const result = validate(environment);
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/official Dynatrace MCP gateway path/i);
    expect(result.output).toMatch(/SOURCE_CODE_MAX_FILE_BYTES must not exceed/i);
  });
});
