## Why

The current runs viewer still behaves like a log browser with a workflow table on
 top and a raw detail pane below. That works for single-step inspection, but it
 hides workflow topology and makes multi-step runs harder to understand than
 they should be.

The new target layout is clearer for Morpheus: a compact top control bar, a
 middle workspace with a workflow list beside the selected workflow graph, and a
 full-width bottom inspection area for logs and artifacts. This keeps workflow
 history visible while giving graph inspection enough space to become the
 primary way users understand a run.

## What Changes

- Redesign the runs viewer shell around three vertical regions: top controls,
  middle workflow navigation plus graph canvas, and bottom inspection tabs.
- Replace the current top workflow table with a persistent workflow list in the
  middle-left pane.
- Promote the workflow graph to the primary inspection surface in the
  middle-right pane for the selected workflow.
- Move log and artifact inspection into a full-width bottom panel that can show
  workflow-level or step-level context.
- Add a workflow overview inspection path so users can return from step-scoped
  graph selection to workflow-scoped metadata without losing context.
- Preserve live updates, workflow actions, and existing run-detail inspection
  behavior within the new layout.

## Capabilities

### New Capabilities

- `runs-viewer-inspection-layout`: Define the three-region runs viewer layout,
  graph-first inspection workspace, and bottom inspection behavior.

### Modified Capabilities

- `morpheus-runs-viewer`: Change the primary viewer navigation and detail layout
  from a table-plus-log shell to a list-plus-graph workspace with bottom
  inspection tabs.
- `workflow-graph-visualization`: Change graph presentation so it occupies the
  main selected-workflow workspace and drives the bottom inspection surface.

## Impact

- Affected app: `apps/runs-viewer`
- Likely affected frontend files: `app/page.tsx`,
  `components/workflow-viewer.tsx`, `app/globals.css`
- Likely affected shared viewer types and API normalization in
  `apps/runs-viewer/src/types.ts` and `apps/runs-viewer/src/server/`
- No expected breaking change to Morpheus CLI entrypoints or on-disk workflow
  run records
