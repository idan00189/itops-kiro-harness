# Kiro CLI v3 contract

Kiro CLI v3 is the runtime for this repository. The repository does not implement a competing agent loop, scheduler, permission manager, or chat UI.

## What the repository provides

- `.kiro/agents/*.md`: one user-facing `itops-orchestrator` profile and six internal specialist profiles
- `.kiro/skills/**/SKILL.md`: progressive domain instructions loaded by Kiro on demand
- `.kiro/hooks/*.json`: standalone v3 hooks using the `v1` schema and PascalCase triggers
- `.kiro/steering/`: persistent product, safety, reporting, and wiki policy
- `.kiro/specs/`: optional Kiro spec context and implementation history
- `src/mcp/`: local stdio MCP servers; the Dynatrace profile points to the official remote MCP
- `config/itops.env.example`: environment template expanded by Kiro when a profile starts

## Start the v3 engine

From the repository root in PowerShell:

```powershell
npm ci
npm run build
kiro-cli login
kiro-cli --v3 --tui --agent itops-orchestrator --require-mcp-startup
```

`--tui` is required for the v3 engine. Do not use classic/legacy chat or `--legacy-ui`. The packaged `Start-ItOps.ps1` performs the environment import, runtime validation, authentication initialization, and this exact start command.

## Permissions

The agent profiles use v3 capability tags and declarative `permissions.rules`:

- the orchestrator may delegate only to the six named specialists
- each specialist may call only its own exact MCP tools
- shell, web, generic filesystem writes, and secret-directory reads are denied
- local report and dashboard writes occur inside MCP servers and remain path/bounds validated

Kiro user and workspace permission files remain machine-local and can add a stricter `ask` or `deny`. The installer never edits them. A stricter rule is intentional and cannot be bypassed by the repository. Never solve approvals with wildcard MCP trust or trust-all mode.

## MCP isolation

Every profile declares one inline `mcpServers` entry and sets `includeMcpJson: false`. This prevents unrelated global or workspace MCP servers from being inherited by a specialist. Kiro starts and supervises the MCP process; `--require-mcp-startup` makes a broken server fail visibly instead of silently removing evidence access.

## Interaction modes

The orchestrator's prompt is the routing policy:

- ordinary questions and targeted checks return a direct chat answer
- a full investigation, RCA, postmortem, or explicit report request activates the investigation skill
- Hebrew Markdown is the default report format; RTL HTML is explicit

The presence of a tool call or specialist delegation never creates a report by itself.

## Updating

After pulling a new revision, run `npm ci`, `npm run build`, and `npm run verify`, then start a new v3 TUI session. Kiro watches agent and MCP profile files, but compiled server changes require a build and a new session.

Official references: [CLI 3.0](https://kiro.dev/docs/cli/v3/), [agent config](https://kiro.dev/docs/cli/v3/agent-config/), [permissions](https://kiro.dev/docs/cli/v3/permissions/), and [hooks](https://kiro.dev/docs/cli/v3/hooks/).
