## 1. Extend Morpheus workflow read surfaces

- [x] 1.1 Add `morpheus workflow runs --json` with workspace-scoped run listing
  and limit/offset support.
- [x] 1.2 Add `morpheus workflow events --id <run-id> --json` for canonical
  workflow event retrieval.
- [x] 1.3 Expand `morpheus workflow inspect --json` to return viewer-grade run,
  step, artifact, and relationship detail.
- [x] 1.4 Update workflow CLI help text and JSON-contract tests for the new and
  expanded read surfaces.

## 2. Replace the viewer filesystem data layer

- [x] 2.1 Add a run-viewer Morpheus CLI adapter module under
  `apps/runs-viewer/src/server/`.
- [x] 2.2 Switch the run index route to consume `morpheus workflow runs --json`.
- [x] 2.3 Switch the run detail and events routes to consume
  `morpheus workflow inspect --json` and `morpheus workflow events --json`.
- [x] 2.4 Switch step-log and workflow-log routes to consume Morpheus workflow
  log commands instead of reading log files directly.

## 3. Preserve viewer behavior while removing storage coupling

- [x] 3.1 Keep lifecycle actions routed through Morpheus workflow commands with
  the selected config and workspace.
- [x] 3.2 Keep SSE/chokidar refresh behavior, but ensure post-notification
  refreshes re-query Morpheus CLI surfaces.
- [x] 3.3 Remove or rename `runs-store.ts` so the viewer no longer owns a
  filesystem-backed run model.

## 4. Validate and document the new boundary

- [x] 4.1 Add or update Morpheus CLI tests for run listing, events, and rich
  inspect output.
- [x] 4.2 Add or update runs-viewer tests for the CLI-backed adapter and API
  routes.
- [x] 4.3 Update the Morpheus skill and related docs to state that run-viewer
  consumes Morpheus CLI rather than `workspace/runs/...` internals.
