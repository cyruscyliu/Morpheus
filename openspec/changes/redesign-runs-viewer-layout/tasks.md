## 1. Reshape viewer state and layout

- [x] 1.1 Replace the top workflow table shell with a top control bar and a middle split layout for workflow list and graph canvas
- [x] 1.2 Add the bottom inspection panel with `overview`, `log`, and `artifacts` tabs and stable default sizing
- [x] 1.3 Refactor viewer selection state to track selected workflow, selected step, and active bottom tab

## 2. Adapt viewer data and interactions

- [x] 2.1 Extend normalized run detail data with the workflow overview and graph inspection context needed by the new layout
- [x] 2.2 Render the workflow list in the left pane with current status, category, and selection behavior
- [x] 2.3 Wire graph selection to drive workflow-scoped and step-scoped bottom panel inspection without leaving the page

## 3. Polish and validate the redesign

- [x] 3.1 Update viewer styling for the new three-region layout, including compact controls and bottom panel content treatment
- [x] 3.2 Validate the redesigned viewer against workflow-first and legacy runs, including live refresh and stop/remove actions
- [x] 3.3 Update runs-viewer docs or usage notes to reflect the new layout and inspection flow
