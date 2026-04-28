## Context

Morpheus already has a workflow-first runs viewer, but the current UI still uses
an old shell: a workflow table across the top and a mostly log-oriented detail
pane below it. That shape preserves history, but it underuses the graph work
already described in the archived workflow-visualization change and leaves the
selected workflow topology visually cramped.

The desired layout is now clearer. The viewer should use a fixed top control
bar, a middle workspace split between workflow list and workflow graph, and a
full-width bottom inspection panel for logs and artifacts. This borrows the
spatial clarity of `cc-wf-studio` without turning Morpheus into a workflow
editor.

The redesign must stay compatible with the existing viewer contracts:
workflow-first and legacy run records still load from the same APIs, live update
behavior still works, and the graph remains a read-only view derived from
Morpheus-managed workflow state.

## Goals / Non-Goals

**Goals:**

- Make the graph the primary visual surface for the selected workflow.
- Keep workflow history visible in a stable left-side list.
- Move log and artifact inspection into a full-width bottom panel that can show
  either workflow-scoped or step-scoped context.
- Preserve current actions such as refresh, stop, and remove within a cleaner
  control surface.
- Keep the implementation compatible with current run metadata and existing
  graph normalization work.

**Non-Goals:**

- No drag-and-drop workflow editing.
- No new workflow storage format or graph document.
- No change to Morpheus CLI entrypoints or workflow run ids.
- No requirement to redesign the viewer into a multi-page application.

## Decisions

### 1. Replace the top workflow table with a persistent workflow list in the middle-left pane

The current table is good for scanning, but it consumes the most prominent
screen region and pushes the selected workflow itself into a secondary role. A
left workflow list preserves scanning while freeing the center of the screen for
inspection.

Alternatives considered:

- Keep the table on top and only restyle the bottom pane.
  Rejected because the graph remains visually constrained.
- Move history into a separate page.
  Rejected because it breaks the tight selection-to-inspection flow.

### 2. Use the middle-right pane as the primary graph workspace

The graph should occupy the largest region of the viewer because understanding
workflow topology is the main unmet need. This aligns the UI with the archived
workflow graph specs without introducing editing behavior.

Alternatives considered:

- Put the graph in a tab beside logs and artifacts.
  Rejected because it makes topology a secondary mode.
- Use a right-side inspector and leave the graph in the lower panel.
  Rejected because it gives the graph too little room for multi-step workflows.

### 3. Move detailed inspection into a full-width bottom tab panel

Logs and artifacts are dense and often wide. A bottom panel makes better use of
horizontal space than a narrow sidebar and works well for both workflow-level
and step-level inspection.

Alternatives considered:

- Keep a right-side inspector.
  Rejected because logs and paths become cramped.
- Replace the graph with raw detail when a tab changes.
  Rejected because it breaks spatial continuity.

### 4. Model inspection state around selected workflow, selected step, and active bottom tab

The UI state should stay simple and explicit: selected workflow id, optional
selected step id, and active tab (`overview`, `log`, or `artifacts`). A null
selected step means the bottom panel is showing workflow-level context.

Alternatives considered:

- Maintain separate graph selection and detail selection states.
  Rejected because they drift easily.
- Keep only step selection with no workflow-level reset path.
  Rejected because users need a clean way back to run-wide context.

### 5. Extend the normalized run detail payload to include workflow overview and graph-friendly inspection context

The frontend already depends on normalized run detail, and it should continue to
avoid reverse-engineering workflow semantics on the client. The API payload
should expose enough metadata for the new layout: workflow overview facts,
graph relationships, and step-scoped inspection references.

Alternatives considered:

- Infer overview and graph state directly in React from raw step manifests.
  Rejected because it mixes backend semantics into the UI.
- Create a second graph-only endpoint.
  Rejected because the selected run detail remains the natural boundary.

## Risks / Trade-offs

- [The left list may lose some table density] → Keep compact row metadata and
  make the list scroll efficiently.
- [The middle graph pane may still feel crowded on smaller screens] → Use a
  resizable split and preserve collapse behavior for the list.
- [Bottom inspection may grow too tall or too shallow by default] → Use stable
  default proportions and support resizing.
- [Legacy runs may not provide rich workflow-level metadata] → Fall back to the
  existing normalized detail fields and retain safe graph inference behavior.
- [More layout regions increase UI complexity] → Keep the state model small and
  reuse current actions and fetch flows where possible.

## Migration Plan

1. Extend the viewer layout and state model behind the existing single-page app.
2. Preserve the current APIs while enriching run detail where the new layout
   needs more normalized context.
3. Replace the top table with the left workflow list and mount the graph in the
   middle workspace.
4. Move log and artifact inspection into the bottom tab panel and add workflow
   overview inspection.
5. Validate the new layout against both workflow-first and legacy runs.

Rollback is straightforward because the change is confined to the viewer app.
The old shell can be restored without touching run storage or CLI behavior.

## Open Questions

- Should the bottom panel default to `overview` or `log` when a workflow is
  first selected?
- Should the middle split and bottom panel be user-resizable in the first pass,
  or can fixed proportions ship first?
- Should the workflow list include inline step counts and timestamps in every
  row, or reveal them only for the selected workflow?
