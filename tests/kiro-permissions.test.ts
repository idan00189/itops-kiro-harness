import { describe, expect, it } from "vitest";
import {
  blockingItOpsPermissions,
  ITOPS_TRUSTED_MCP_TOOLS,
  ITOPS_TRUSTED_SUBAGENTS,
  mergeManagedPermissionRules,
  missingItOpsPermissions,
  removeManagedPermissionRules,
} from "../src/cli/configure-kiro-permissions.js";

describe("machine-local Kiro permission configuration", () => {
  it("adds only exact ITOps subagent and MCP permissions", () => {
    const existing = {
      rules: [
        {
          capability: "shell",
          effect: "deny",
          match: ["*"],
        },
      ],
    };
    const result = mergeManagedPermissionRules(existing);

    expect(result.document.rules[0]).toEqual(existing.rules[0]);
    expect(result.managed).toEqual([
      {
        capability: "subagent",
        effect: "allow",
        match: [...ITOPS_TRUSTED_SUBAGENTS],
      },
      {
        capability: "mcp",
        effect: "allow",
        match: [...ITOPS_TRUSTED_MCP_TOOLS],
      },
    ]);
    expect(JSON.stringify(result.managed)).not.toContain('"*"');
    expect(missingItOpsPermissions(result.document)).toEqual([]);
  });

  it("preserves existing rules and does not duplicate user-managed trust", () => {
    const existing = {
      rules: [
        {
          capability: "mcp",
          effect: "allow",
          match: ["itops-splunk/splunk_health"],
        },
        {
          capability: "fs_write",
          effect: "deny",
          match: ["**"],
        },
      ],
    };
    const result = mergeManagedPermissionRules(existing);
    const serialized = JSON.stringify(result.document);

    expect(
      serialized.match(/itops-splunk\/splunk_health/g),
    ).toHaveLength(1);
    expect(result.document.rules).toContainEqual(existing.rules[1]);
  });

  it("updates and removes only the exact rules previously managed by ITOps", () => {
    const initial = mergeManagedPermissionRules({ rules: [] });
    const withUserRule = {
      rules: [
        ...initial.document.rules,
        {
          capability: "mcp",
          effect: "allow",
          match: ["another-server/read"],
        },
      ],
    };

    const updated = mergeManagedPermissionRules(
      withUserRule,
      initial.managed,
    );
    expect(missingItOpsPermissions(updated.document)).toEqual([]);
    expect(updated.document.rules).toContainEqual({
      capability: "mcp",
      effect: "allow",
      match: ["another-server/read"],
    });

    const removed = removeManagedPermissionRules(
      updated.document,
      updated.managed,
    );
    expect(removed.rules).toEqual([
      {
        capability: "mcp",
        effect: "allow",
        match: ["another-server/read"],
      },
    ]);
  });

  it("detects restrictive wildcard rules that would override exact trust", () => {
    const document = {
      rules: [
        {
          capability: "mcp",
          effect: "ask",
          match: ["itops-splunk/*"],
          exclude: ["itops-splunk/splunk_health"],
        },
        {
          capability: "all",
          effect: "deny",
          match: ["itops-sql-server/sql_query"],
        },
      ],
    };

    const blocked = blockingItOpsPermissions(document);
    expect(blocked).toContain(
      "ask:mcp:itops-splunk/splunk_search",
    );
    expect(blocked).not.toContain(
      "ask:mcp:itops-splunk/splunk_health",
    );
    expect(blocked).toContain(
      "deny:mcp:itops-sql-server/sql_query",
    );
  });
});
