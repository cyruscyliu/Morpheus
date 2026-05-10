## Why

The run viewer still reads Morpheus run files directly from the workspace,
which makes the UI depend on Morpheus storage internals instead of the Morpheus
CLI contract. That boundary is too weak for a managed system that already uses
`morpheus workflow ...` for lifecycle actions.

## What Changes

- Move run-viewer read paths from filesystem scanning to Morpheus CLI-backed
  data access.
- Add Morpheus CLI surfaces for run listing, run events, and richer workflow
  inspection data so the viewer no longer needs to reconstruct workflow state
  from disk.
- Keep `workflow run`, `resume`, `stop`, and `remove` as the lifecycle
  commands, but make the read side equally first-class.
- Preserve the viewer UI and SSE behavior, but have it consume Morpheus JSON
  rather than workspace internals.
- Retain file-backed storage inside Morpheus as an implementation detail only;
  the viewer should no longer know step manifest or event-log layout.

## Capabilities

### Modified Capabilities

- `morpheus-app`: Expand the Morpheus app contract so workflow run discovery
  and workflow observability are exposed as CLI-managed surfaces rather than
  viewer-owned filesystem access.
- `morpheus-workflow-runs`: Add workflow run listing, richer inspect output,
  and event/log metadata so Morpheus can serve as the canonical run-data
  provider for viewers and other clients.
- `morpheus-runs-viewer`: Change the viewer contract so it consumes Morpheus
  workflow JSON surfaces instead of directly scanning `workspace/runs/...`.

## Impact

- `apps/morpheus/src/commands/workflow.ts`
- `apps/morpheus/src/core/workflow-runs.ts`
- `apps/runs-viewer/src/server/*`
- `apps/runs-viewer/app/api/*`
- `apps/runs-viewer/components/workflow-viewer.tsx`
- `apps/runs-viewer/tests/*`
- Viewer run-index, detail, log, and event payload shapes
- Morpheus CLI help text and JSON contracts for workflow read commands
