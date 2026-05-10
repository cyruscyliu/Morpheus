## Context

The current run-viewer is split across two contracts:

- lifecycle actions already go through `morpheus workflow run|resume|stop|remove`
- read paths still parse `workspace/runs/...` directly through
  `apps/runs-viewer/src/server/runs-store.ts`

That means the viewer knows Morpheus on-disk record layouts, step manifests,
event log files, and relation reconstruction rules. This weakens the Morpheus
boundary and forces every viewer feature to track storage details that should
remain Morpheus-owned.

The desired boundary is simpler: Morpheus owns workflow data and exposes it
through CLI JSON; the run-viewer owns presentation, selection, polling, and
refresh behavior.

## Goals / Non-Goals

**Goals:**

- Make Morpheus CLI the authoritative read and write surface for the
  run-viewer.
- Add the missing Morpheus workflow read commands needed by the viewer:
  workflow run index and workflow events.
- Expand `workflow inspect --json` so it carries viewer-grade structured data.
- Replace viewer filesystem parsing with a thin Morpheus CLI adapter.
- Preserve current UI routes and user-facing behavior where possible.

**Non-Goals:**

- No new tool-specific behavior in Morpheus.
- No browser-side direct Morpheus invocation.
- No mandatory replacement of filesystem-backed run storage.
- No immediate replacement of SSE with a Morpheus-native event stream.

## Decisions

### 1. Add missing workflow read surfaces to Morpheus instead of teaching the viewer more filesystem logic

The viewer needs a run index, workflow detail, canonical events, and logs.
`workflow inspect` and `workflow logs` already exist, but the run index and
event listing are missing as first-class CLI commands.

The design adds:

- `workflow runs --json [--limit --offset]`
- `workflow events --id <run-id> --json`

It also expands `workflow inspect --json` so one call can provide the selected
workflow detail model the viewer needs.

Alternatives considered:

- Keep `runs-store` and only use the CLI for mutations.
  Rejected because it preserves the wrong ownership boundary.
- Add a viewer-only internal library shared with Morpheus.
  Rejected because the public management surface should stay the CLI.

### 2. Keep the viewer backend as a CLI adapter, not a storage adapter

`apps/runs-viewer/src/server/` should shell out to Morpheus with `--json` and
normalize its responses into the existing API payloads consumed by the React
UI. This keeps the viewer server thin and lets Morpheus evolve storage details
without viewer changes.

The existing `runs-store.ts` should be removed or collapsed into a new module
such as `morpheus-client.ts` that:

- invokes `apps/morpheus/dist/cli.js`
- passes the selected `--config`
- passes `--workspace` when required
- parses CLI JSON
- adapts payloads to viewer models

Alternatives considered:

- Move the viewer into Morpheus itself.
  Rejected because UI ownership and CLI ownership are separate concerns.
- Keep `runs-store` but change its implementation piecemeal.
  Rejected because the name and abstraction encourage filesystem ownership.

### 3. Keep filesystem watching only for refresh invalidation

The current viewer uses chokidar/SSE to tell browsers when runs changed.
Morpheus does not yet expose a streaming event endpoint, so the watcher can
remain as an invalidation mechanism only.

The watcher should not be treated as the authoritative data source. After a
change event, the viewer should re-query Morpheus CLI surfaces.

Alternatives considered:

- Remove SSE until Morpheus has its own stream API.
  Rejected because it would regress live refresh behavior.
- Continue watching and parsing files for both change detection and payload
  generation.
  Rejected because payload generation must move behind Morpheus.

### 4. Keep aggregated workflow log rendering in the viewer unless Morpheus needs a dedicated run-log command

The viewer currently supports a workflow-level log view by aggregating step
logs. This can be preserved without a new Morpheus command by:

1. calling `workflow inspect --json`
2. enumerating steps with logs
3. calling `workflow logs --id <run-id> --step <step-id>` per step
4. concatenating the results in the viewer backend

If this becomes too slow or too chatty, Morpheus can later add a dedicated
workflow-level log command. That is not required for the first refactor.

Alternatives considered:

- Add `workflow logs --all-steps` immediately.
  Deferred because it is not required to remove direct filesystem reads.

## Risks / Trade-offs

- [CLI JSON growth increases command complexity] → Keep the new read surfaces
  workflow-generic and reuse existing normalization helpers inside Morpheus.
- [Viewer routes may become slower due to multiple CLI invocations] →
  prioritize richer `workflow inspect --json` so detail views are single-call,
  and add a dedicated aggregated log command later only if needed.
- [SSE still watches files] → Limit file watching to change notification only,
  not data reconstruction.
- [Partial migration leaves `runs-store` in the critical path] → Switch routes
  in one pass and then remove the filesystem-owned data layer.

## Migration Plan

1. Add `workflow runs --json` to Morpheus.
2. Add `workflow events --id <run-id> --json` to Morpheus.
3. Expand `workflow inspect --json` with viewer-grade structured detail.
4. Introduce a run-viewer Morpheus CLI adapter module.
5. Switch `/api/runs`, `/api/runs/[id]`, `/api/runs/[id]/events`, and log
   routes to the adapter.
6. Keep SSE refresh, but requery through Morpheus after each invalidation.
7. Remove or rename `runs-store.ts` so the viewer no longer advertises a
   filesystem-owned run model.

Rollback is straightforward:

- revert the viewer adapter change
- keep the new Morpheus CLI commands as additive surfaces
- or temporarily point the viewer back to filesystem-backed loading if needed

## Open Questions

- Should `workflow inspect --json` include graph-ready relations directly, or
  should the viewer derive graph edges from richer step/artifact metadata?
- Should `workflow events` expose raw canonical events only, or a normalized
  projection for UI use?
- Is a dedicated workflow-level aggregated log command worth adding in the same
  change, or should that remain a viewer-side composition step?
