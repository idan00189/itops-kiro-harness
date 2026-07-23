# Argo CD investigation patterns

Capture:

- application and project
- desired target revision and deployed revision
- operation phase, start, finish, and message
- sync and health status with observed timestamps
- application conditions
- degraded/progressing/missing resources
- concrete desired/live drift
- rollout, scheduling, probe, image-pull, and admission events

Recommended Microsoft/Entra group or token policy grants only `get`:

```text
p, role:itops-readonly, applications, get, <project>/*, allow
p, role:itops-readonly, projects, get, <project>, allow
p, role:itops-readonly, logs, get, <project>/*, allow
```

Omit the logs permission when Argo CD pod logs are not needed. Never grant `sync`, `override`, `action/*`, `create`, `update`, `delete`, or `exec`.

Argo CD 3.x enforces logs as a separate RBAC resource. This harness does not expose a logs tool; use Splunk or Dynatrace for log evidence.

For CLI SSO, the configured context server must match `ARGOCD_BASE_URL`. The harness may call `argocd account session-token` to reuse or refresh the cached SSO session, but it never runs `sync`, `app`, `admin`, `kubectl`, or mutation commands.
