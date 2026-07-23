---
name: investigate-argocd
description: Investigate incidents in Argo CD with read-only application, health, sync, revision history, resource-tree, managed-resource drift, and Kubernetes event evidence. Use for deployment regressions, unhealthy workloads, OutOfSync applications, revision correlation, GitOps drift, and rollout timing.
---

# Investigate with Argo CD

Read [argocd-playbook.md](references/argocd-playbook.md) before interpreting health, sync, or drift.

CLI SSO mode reuses the current Argo CD context and a Microsoft/Entra-backed session. The local MCP obtains only a refreshable session token and uses it for fixed read-only REST calls. If the session or read RBAC is unavailable, return an evidence gap; never use a broader context or ask for an administrator token.

## Establish deployment state

1. Identify the allowlisted project and application.
2. Read application status and record desired revision, deployed revision, sync, health, conditions, and operation history.
3. Read the resource tree to locate degraded, progressing, missing, or unknown resources.
4. Read managed resources to identify concrete desired/live differences.
5. Read application events for rollout, scheduling, probe, image, and admission failures.
6. Align operation and resource timestamps with the incident and baseline windows.

Never refresh or hard-refresh. Never sync, rollback, terminate an operation, run resource actions, delete, patch, or exec.

## Interpret cautiously

- `OutOfSync` is not itself a root cause.
- `Healthy` can coexist with application-level failure.
- Git revision time is not deployment completion time.
- Health can be stale without refresh; report observation limitations rather than refreshing.
- Drift may be intentional or ignored by customization.
- A rollout may correlate with symptoms without causing them.

## Return the evidence package

Return:

- project/application and observation time
- desired/deployed revisions
- operation start/finish timestamps
- health/sync transitions and conditions
- concrete affected resources and drift
- relevant events
- negative evidence and stale-cache caveats
- confidence and suggested evidence IDs using `ARGO-NNN`
