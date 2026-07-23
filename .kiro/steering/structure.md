# Workspace structure

- `.kiro/agents/` — Kiro v3 custom agent profiles
- `.kiro/skills/` — portable Agent Skills
- `.kiro/hooks/` — v3 standalone lifecycle and tool hooks
- `.kiro/specs/itops-harness/` — requirements, design, and completed build tasks
- `.kiro/steering/` — persistent product, technology, safety, and reporting context
- `src/mcp/` — six MCP server entry points
- `src/common/` — guards, TLS-safe HTTP, audit, environment, and redaction
- `src/report/` — Hebrew Markdown and RTL HTML report model/rendering
- `config/itops.env.example` — the single environment template
- `scripts/` — Windows install/start/test and hook commands
- `wiki/` — intentionally empty company knowledge folder
- `reports/`, `artifacts/`, `audit/` — ignored local runtime outputs

Do not place runtime secrets in `.kiro/`, skills, steering, specs, docs, or source files.
