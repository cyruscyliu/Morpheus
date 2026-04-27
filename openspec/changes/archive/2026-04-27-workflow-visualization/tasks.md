## 1. Run Detail Normalization

- [x] 1.1 Extend the runs-viewer server normalization layer to emit graph-ready
  workflow detail data for nodes, edges, and artifact references.
- [x] 1.2 Define fallback relationship rules for legacy or incomplete workflow
  metadata so the graph still renders safely.
- [x] 1.3 Cover the normalized graph payload with tests for workflow-first and
  legacy run directories.

## 2. Graph Viewer UI

- [x] 2.1 Add a selected-workflow graph inspection surface to the runs viewer
  without removing the current workflow history table.
- [x] 2.2 Render workflow steps as read-only graph nodes with stable status and
  tool styling.
- [x] 2.3 Add pan, zoom, and layout behavior suitable for compact multi-step
  workflows.

## 3. Detail Pane Integration

- [x] 3.1 Wire graph node selection to step-scoped log, artifact, and metadata
  inspection.
- [x] 3.2 Preserve an easy path back to workflow-level inspection context from
  step-scoped graph selection.
- [x] 3.3 Ensure artifact relationships shown in the graph match the artifact
  data shown in the inspection tabs.

## 4. Validation And Documentation

- [x] 4.1 Validate the viewer against the kernel callgraph workflow shape and a
  simple single-step workflow.
- [x] 4.2 Update viewer docs or usage notes to describe the new workflow graph
  inspection mode.
- [x] 4.3 Build and test the runs viewer after the graph workflow changes land.
