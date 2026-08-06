# Principles

## Investigation and verification

- Clarify the user's intention before acting.
- Investigate comprehensively; require root cause instead of surface fixes.
- Propose verifiable actions, then execute them.
- When fixing bugs: identify the root cause, add unit tests, fix the bug, and
  rerun the tests.
- Do not cheat around constraints, tests, or review expectations.
- Do not short-circuit verification; evidence must support the claim.

## Long-term running

- For long-running or multi-step work, prepare durable execution up front.
- Propose `/goal` or `/loop` when those tools fit and are available.
- Prefer looped progress over one-shot guesses for open-ended tasks.
- For `third_party` submodules, default to two commits: commit inside the
  submodule first, then commit the parent repo submodule pointer update.

## Self-reflection and self-improving

- Reflect after each completed task on what worked and what did not.
- Propose concrete improvements to this file when lessons apply broadly.
- Apply those updates only with the user's confirmation.

## Writing style

- Prefer clear, concise writing.
- Prefer one-line sentences when possible.
- Wrap generated Markdown at 80 chars.
- Use repo-relative paths or plain code references.
- Do not add absolute filesystem paths.
- Do not hardcode environment-specific paths or similar host-layout
  assumptions into repo code.
- Do not write business data, or real repository identifiers into tests; use
  generic placeholders and synthetic fixtures instead.
- Add comments when they improve clarity.
- Do not report intermediate results or say "if you want" when the next step
  is clear; default to taking action directly.

## Wanghai 0.3 Surface Contract

Wanghai is a Polaris vault-scoped surface extension in integrated mode. Read
the canonical Polaris Docs Design and Release TODO before changing
gateway, storage, or actor behavior. Do not add an internal release-directory
path to Wanghai code or tooling.

- Verify the short-lived Polaris assertion on every non-health route and match
  its tenant/vault claims to the configured vault root.
- Own UI/API behavior, strict workspace resolution, symlink/path safety,
  bounded JSON/multipart parsing, safe asset responses, health/readiness, and
  claim-derived actor context.
- Do not create a second identity, tenant, role, rate-limit, quota, lifecycle,
  job queue, or audit authority. Polaris owns those decisions and forwards the
  resulting verified context.
- In integrated mode, reject live external side effects and backup, restore, or
  rollback commands until Polaris supplies the durable permission, idempotency,
  outbox, lifecycle, and audit path. The only format-adapter exceptions are
  non-portal `scripts/polaris-backup-workspaces.sh` and
  `scripts/polaris-restore-workspaces.sh`, invoked only by Polaris's
  network-disabled Docker jobs with fixed mounts. Backup reads the selected
  vault and writes `/backup`; restore reads `/backup` and writes a separate
  `/restore` target. They are not Wanghai lifecycle APIs; portal restore,
  activation, and rollback remain blocked. Dry-run and local surface state may
  be available only when it neither executes an external action nor bypasses a
  Polaris workflow job.
- Do not execute integrated workflow tools directly. `workflow run`, including
  `--dry-run`, must reject Polaris mode until Polaris provides a durable job,
  lease, idempotency, recovery, and audit contract. Wanghai may show status or
  a future submit UI only.
- Treat manual intelligence-analysis completion as workflow execution: portal
  review export may remain a surface action, but `complete-review`, `prepare`,
  `run`, and `finalize` must reject Polaris mode until Polaris owns the durable
  job. The portal must return unavailable before it writes review output or
  invokes an executor.
- Keep synchronous derived surface work bounded with child-process deadlines,
  output caps, and tool resource limits. This is local availability protection,
  not a Wanghai job queue, rate limiter, or quota authority.
- In integrated mode use `/vault/project` and derive `workspaces/`,
  `backups/`, and `cache/` under it. Do not require a separate workspace root.
- Standalone mode requires `WANGHAI_DATA_ROOT` and the separate signed
  external-identity adapter described in the gateway operations guide. Do not
  silently accept Polaris assertion headers or fall back to a shared current
  directory. The adapter supplies actor, tenant, role, and capabilities;
  enforce no competing rate or quota policy in Wanghai.
- Never add a public `9090` route or browser bypass around the Polaris gateway.
- Add path/bypass/cross-scope regressions with every boundary change and run
  focused core, workflow, gateway-auth, and request-policy tests.

The release TODO records P0 implementation and deployed evidence separately
from deferred 0.3.2 perimeter and standalone work. Do not mark a release
gate complete from unit tests alone.
