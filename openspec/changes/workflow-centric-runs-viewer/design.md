## Context

The local Workflow Viewer was introduced while Morpheus still had overlapping
"run" concepts and mixed on-disk formats. The backend normalization layer now
already understands both legacy `run.json` records and workflow-first
`workflow.json` records, but the UI still presents the top-level object as a
run, not a workflow, and only surfaces a small subset of available metadata.

This creates three specific problems:

- the primary UI term conflicts with the workflow-run-first direction already
  established in managed-runs design work
- the left pane cannot help users distinguish build history from runtime
  history
- the middle pane does not carry enough metadata to let the left pane stay
  compact

Constraints:

- Keep the viewer local-first and based on normalized files under
  `<workspace>/runs/`
- Preserve support for both legacy and workflow-first records during the
  transition
- Prefer explicit workflow metadata over viewer-only heuristics when a field
  drives navigation labels

## Goals / Non-Goals

**Goals:**

- Make `workflow` the viewer's top-level inspection term.
- Expose workflow category as `build` or `run` in normalized viewer data.
- Keep the left pane compact and navigation-oriented.
- Replace full left-pane hide/show with a stable collapsed rail.
- Expand the workflow detail pane with category, timestamps, change, path, and
  summary metadata before the step list.

**Non-Goals:**

- Rebuild the viewer layout beyond the existing three-pane structure.
- Design a general workflow taxonomy beyond `build` and `run`.
- Remove support for legacy run records in this change.
- Add workflow authoring or workflow execution features to the viewer.

## Decisions

### Decision: The viewer inspects workflows, not runs

The UI will rename its primary concepts from `Runs`/`Run` to
`Workflows`/`Workflow`. This aligns the viewer with the workflow-run-first
model already used for managed runs and removes the overloaded meaning of
`run`.

Alternatives considered:

- Keep `run` in the UI and add explanatory copy.
  - Rejected because it preserves ambiguity between workflow container and
    runtime action.

### Decision: Separate workflow category from storage format

The normalized viewer model will represent two distinct axes:

- storage format: legacy or workflow-first
- workflow category: build or run

This prevents `kind` from carrying both storage semantics and user-facing
workflow intent. The viewer will render category. Format may remain available
for debugging or compatibility logic, but it should not drive the primary UI.

Alternatives considered:

- Reuse a single `kind` field for everything.
  - Rejected because `workflow`, `run`, and `build` are not the same concept.
- Infer category only in the UI.
  - Rejected because navigation labels should not depend on duplicated viewer
    heuristics.

### Decision: Workflow category should be explicit in workflow metadata

Workflow-first records should provide category as stable metadata recorded by
Morpheus. The viewer normalization layer may preserve fallback behavior for
legacy records, but workflow-first records should not rely on step-name or
workflow-name guesses when category is available from the source manifest.

Alternatives considered:

- Derive category from workflow name.
  - Rejected because naming conventions drift and are not a stable contract.
- Derive category from first step or step mix.
  - Rejected because it is brittle and hard to explain.

### Decision: The left pane is navigation, not a summary card

The left pane should remain compact and optimized for scanning:

- workflow id
- category chip
- status
- a small amount of supporting metadata such as created time and step count

Richer metadata moves to the workflow detail pane. This keeps the list useful
with long histories and prevents duplicate information across panes.

Alternatives considered:

- Turn each left-pane item into a dense metadata card.
  - Rejected because the list would compete with the detail pane.

### Decision: Collapse becomes a stable rail

Collapsing the left pane will shrink it to a persistent rail rather than
removing it and moving the toggle to a floating button. The toggle stays on the
same boundary, and the selected workflow remains visible in compact form.

Alternatives considered:

- Keep the current full hide/show behavior.
  - Rejected because it changes control position and breaks spatial
    continuity.
- Remove collapse entirely.
  - Rejected because focus mode for detail/log reading is still useful on
    desktop widths.

## Risks / Trade-offs

- [Legacy records may not encode build/run clearly] → Keep legacy fallback
  mapping narrow and document where explicit category is unavailable.
- [Managed-run metadata changes may overlap the active workflow-first-runs
  change] → Keep category additive and scoped to workflow metadata fields so it
  composes with ongoing run-model work.
- [UI rename may momentarily confuse users familiar with "Workflow Viewer"] →
  Preserve the app/package name for now and change in-app labels first.
- [More detail in the middle pane can create visual density] → Keep overview
  facts concise and grouped above the step list.

## Migration Plan

1. Extend normalized viewer types and server responses to separate workflow
   category from storage format.
2. Update workflow metadata emission so workflow-first records can expose
   category explicitly.
3. Rename viewer UI copy from runs to workflows.
4. Redesign the left pane items and collapse behavior around a stable rail.
5. Expand the workflow detail pane with overview metadata.
6. Update tests for normalization and workflow/category rendering.

## Open Questions

- What fallback mapping should legacy records use when category is missing or
  carries older `kind` values?
- Should the viewer expose storage format anywhere in the UI, or keep it
  internal to normalization and debugging?
- Should workflow category also appear in other inspection surfaces such as
  `morpheus runs export-html` in a follow-up change?
