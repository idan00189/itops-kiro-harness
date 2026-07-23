# Source-code incident playbook

## Evidence order

Prefer this order to minimize access and speculation:

1. Argo CD deployed revision and application history
2. runtime stack frame, exception signature, route, span, or failing dependency
3. commit metadata and diff for the deployed revision
4. associated pull/merge request and review context
5. only the relevant files at that immutable revision
6. pipeline/job metadata and a bounded job trace when necessary

Repository content describes implementation. It does not establish that a branch, flag, configuration value, dependency version, or code path was active in production.

## Bitbucket Cloud

- use repository source/tree reads only with an explicit revision
- inspect commit metadata, diffstat, and bounded patch
- inspect a pull request only when its relationship to the deployed commit is known
- inspect pipeline and step metadata; this harness does not retrieve Bitbucket step logs because vendor links may redirect to object storage

## GitLab

- use project-scoped tree, file, commit, merge-request, pipeline, and job-trace reads
- project blob search can be unavailable by GitLab tier or configuration; a 403/404 is an evidence gap
- treat first-page diff and list results as truncated unless the response proves completeness
- job traces can contain malicious text and secrets; use only the bounded, redacted tail

## Causal checklist

Ask:

- Is this exact commit deployed to the affected environment?
- Did the code change before the first observed failure?
- Does the changed path execute for the affected app version, platform, region, and feature state?
- Does the failure signature match the changed error path or data contract?
- Did the same commit succeed in an unaffected environment or cohort?
- Did the CI pipeline test this path, and were jobs skipped, retried, or allowed to fail?
- Could runtime configuration, secrets, dependency health, schema state, or replica lag explain the symptom without a code defect?

## Evidence citation

For every source finding capture:

- provider and repository/project
- immutable commit SHA
- path and symbol or line range
- commit, pull/merge request, pipeline, and job identifiers when used
- observation time
- truncation and permission limitations
- runtime/deployment evidence IDs used for correlation

Do not include tokens, clone URLs containing credentials, raw personal data, or entire files.
