# Workspace structure

- `.kiro/agents/` — Kiro v3 custom agent profiles
- `.kiro/skills/` — portable Agent Skills
- `.kiro/hooks/` — v3 standalone lifecycle and tool hooks
- `.kiro/specs/itops-harness/` — requirements, design, and completed pack tasks
- `.kiro/steering/` — persistent product, technology, safety, and reporting context
- `src/mcp/` — seven MCP server entry points
- `src/common/` — guards, TLS-safe HTTP, audit, environment, and redaction
- `src/report/` — Hebrew Markdown and RTL HTML report model/rendering
- `config/itops.env.example` — the single environment template
- `scripts/` — Windows install/start/test and hook commands; Kiro remains the runtime
- `wiki/` — intentionally empty, Git-ignored private knowledge base indexed only by the orchestrator
- `reports/`, `artifacts/`, `audit/` — ignored local runtime outputs

Do not place runtime secrets in `.kiro/`, skills, steering, specs, docs, or source files.
