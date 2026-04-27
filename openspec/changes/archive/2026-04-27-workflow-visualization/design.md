## Context

Morpheus already records workflow-first runs with stable step metadata,
artifacts, and logs. The current viewer shows those records in a compact table
and a detail pane, which works for single-step workflows and raw inspection,
but it scales poorly for workflows with branching, generated mutators, or
artifact reuse.

The user wants Morpheus to learn from `cc-wf-studio`, but Morpheus is not a
workflow authoring product. It is a workflow execution and inspection product.
The design should therefore borrow the visual clarity of a canvas without
adopting drag-and-drop editing, export flows, or agent-authoring concerns.

The new workflow shape for kernel builds and callgraph generation makes this
need concrete. A single run can contain repeated `llbic -> mutator -> llcg`
chains, and the current log-first presentation hides the structure that users
actually need to inspect.

## Goals / Non-Goals

**Goals:**

- Make workflow topology visible for the selected workflow run.
- Make step dependencies and artifact flow easier to understand.
- Keep the current workflow history interaction intact.
- Keep the graph read-only and derived from workflow state already owned by
  Morpheus.
- Reuse the existing detail pane so logs and artifacts stay one click away.

**Non-Goals:**

- No drag-and-drop workflow editing.
- No workflow export or Markdown generation.
- No new workflow storage format beyond the current workflow-run metadata.
- No replacement of the existing workflow table with a canvas-only view.

## Decisions

### 1. Add a graph view to the existing Workflow Viewer rather than replacing
the current history-first layout

The top-level workflow table already works well as run history. Replacing it
with a full-screen canvas would make navigation worse for the common case of
comparing many workflow runs. The graph should be attached to the selected
workflow, not used as the primary history surface.

Alternatives considered:

- Replace the table with a graph-first home screen.
  Rejected because it weakens scanning and run selection.
- Add a separate graph-only page.
  Rejected because it splits history and inspection into two disconnected
  surfaces.

### 2. Keep the graph read-only and derived from normalized run detail data

The graph should not introduce a second workflow truth source. The viewer will
derive nodes and edges from workflow steps, artifacts, and step-to-step
references already present in Morpheus-managed metadata. This keeps the viewer
native to Morpheus and avoids inventing an editor model.

Alternatives considered:

- Store a separate graph document per workflow.
  Rejected because it duplicates workflow state and creates drift risk.
- Require users to annotate graph relationships by hand.
  Rejected because this is an inspection feature, not an authoring feature.

### 3. Add a normalized graph payload in the viewer API layer

The frontend should not reverse-engineer relationships from raw step JSON on
every render. The server normalization layer should emit a stable graph payload
with nodes, edges, and artifact references. This keeps layout logic clean and
lets the backend own legacy-compatibility decisions.

Alternatives considered:

- Infer all relationships in the React component.
  Rejected because it spreads workflow semantics into the UI and makes testing
  harder.
- Add a brand-new standalone graph endpoint.
  Rejected for now because the existing run-detail request is already the
  selected-workflow data boundary.

### 4. Use a graph rendering library with auto-layout in read-only mode

A workflow graph needs pan, zoom, selection, and stable edge rendering. A
library such as React Flow with automatic layout is a better fit than a custom
SVG implementation. Morpheus should use it in read-only mode with controlled
selection and no persistent node dragging.

Alternatives considered:

- Build a bespoke SVG graph.
  Rejected because it adds layout and interaction complexity with little
  benefit.
- Render a simple indented tree.
  Rejected because workflows can branch or carry artifact relationships that
  are not naturally tree-shaped.

### 5. Use node selection to scope the existing detail pane

The graph alone is not enough. Users still need logs, artifacts, and metadata.
Selecting a node should focus the inspection pane on that step while preserving
an easy way to return to workflow-level context.

Alternatives considered:

- Open a modal for node details.
  Rejected because logs and artifacts are too large for modal interaction.
- Keep the detail pane workflow-global only.
  Rejected because it forces users to map graph nodes back to unrelated log
  text manually.

## Risks / Trade-offs

- [Legacy runs may not expose enough dependency metadata] → Fall back to
  execution-order edges and mark inferred relationships explicitly.
- [Large workflows may produce wide or dense graphs] → Use auto-layout,
  viewport controls, and compact node chrome.
- [Artifact relationships may be ambiguous in some workflows] → Prefer explicit
  artifact references first, then template-reference inference, then ordered
  fallback edges.
- [A graph library adds frontend weight] → Keep the graph view scoped to the
  selected workflow and lazy-load if needed.

## Migration Plan

1. Extend the viewer-side normalization model to emit graph-ready workflow
   detail data.
2. Add the graph surface behind the existing selected-workflow detail view.
3. Wire node selection to existing log and artifact tabs.
4. Validate existing workflow-first and legacy run directories against the new
   normalization path.
5. Keep the current workflow table available throughout rollout.

Rollback is straightforward because the feature is viewer-only. If needed, the
graph surface can be removed without changing workflow-run storage or Morpheus
CLI contracts.

## Open Questions

- Should the graph be the default selected-workflow view, or a tab beside the
  current textual detail?
- Should artifact flow be shown only as edge metadata, or also as dedicated
  artifact nodes for complex workflows?
- Do we want a minimap immediately, or only after validating the first compact
  graph layout?
