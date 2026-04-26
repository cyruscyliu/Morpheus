## Why

The Workflow Viewer still exposes "run" as the top-level concept even though
Morpheus is moving to a workflow-run-first model. That leaks old terminology
into the UI, hides the difference between build and run workflows, and leaves
the detail pane too thin to justify a full three-pane layout.

## What Changes

- Rename the viewer's primary navigation and detail language from `run` to
  `workflow`.
- Distinguish workflow category as `build` or `run` in the left pane so users
  can scan workflow history by intent, not only by id and status.
- Replace the current full-hide list collapse behavior with a stable collapsed
  rail for the left pane.
- Expand the middle pane into a richer workflow overview with category,
  timestamps, change, path, and step summary metadata above the step list.
- Normalize viewer data so workflow storage format and workflow category are
  represented separately.

## Capabilities

### New Capabilities

- `morpheus-runs-viewer`: Workflow-first terminology and navigation behavior
  for the local Workflow Viewer UI and API.

### Modified Capabilities

- `morpheus-managed-runs`: Managed workflow metadata must expose workflow
  category separately from workflow/run-record format so downstream inspection
  surfaces can label workflows as `build` or `run`.

## Impact

- Affected code:
  `apps/runs-viewer/src/{main.ts,styles.css,index.html,types.ts}`
- Affected normalization layer:
  `apps/runs-viewer/src/server/runs-store.ts`
- Related managed-run metadata:
  `apps/morpheus/src/workflow-runs.ts` and workflow manifests under
  `<workspace>/runs/`
- Affected tests:
  `apps/runs-viewer/tests/test_runs_store.ts`
- Affected docs:
  `apps/runs-viewer/README.md`
