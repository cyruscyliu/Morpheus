## Why

The current Workflow Viewer is good for listing workflow runs and reading raw
logs, but it does not help users understand multi-step execution structure,
artifact flow, or where a failure sits in the pipeline. This is becoming more
painful now that Morpheus workflows include chained `llbic` and `llcg` steps
with intermediate artifacts and clear producer-consumer relationships.

## What Changes

- Add a read-only graph visualization for the selected workflow in the
  Workflow Viewer.
- Show workflow steps as graph nodes with type, status, and compact summary
  metadata.
- Show execution and artifact relationships between steps so users can trace
  how outputs flow through the workflow.
- Let node selection drive the existing inspection surface so users can switch
  between workflow-level and step-level logs, artifacts, and metadata.
- Preserve the current workflow history surface instead of replacing it with a
  canvas-only UI.

## Capabilities

### New Capabilities

- `workflow-graph-visualization`: Render a read-only workflow graph for a
  selected Morpheus workflow run and expose step relationships and artifact
  flow.

### Modified Capabilities

- `morpheus-runs-viewer`: Extend the existing Workflow Viewer to include graph
  inspection alongside the current workflow table, log, and artifact views.

## Impact

- Affected app: `apps/runs-viewer`
- Likely affected server normalization: `apps/runs-viewer/src/server/`
- Likely affected Morpheus run-detail shaping if graph metadata is normalized in
  the API layer
- Likely new frontend dependency for graph rendering and layout
- No expected breaking change to existing Morpheus CLI entrypoints
