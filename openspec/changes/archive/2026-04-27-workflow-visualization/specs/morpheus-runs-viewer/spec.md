## ADDED Requirements

### Requirement: Viewer provides a workflow graph inspection mode
The system SHALL provide a graph-based inspection mode for the selected
workflow.

#### Scenario: User switches from history to graph inspection
- **WHEN** a user selects a workflow in the Workflow Viewer
- **THEN** the viewer keeps the workflow history surface available
- **AND** the selected workflow exposes a graph inspection surface without
  navigating away from the viewer

### Requirement: Viewer provides graph-ready run detail data
The system SHALL provide normalized selected-workflow detail data that is
enough to render graph nodes, graph edges, and step-scoped artifact references.

#### Scenario: Run detail returns graph payload
- **WHEN** a client requests run detail for a workflow-first run
- **THEN** the returned detail includes graph-ready node and edge data or an
  equivalent normalized relationship model
- **AND** the payload is sufficient for the viewer to render workflow
  visualization without re-parsing raw on-disk workflow records in the browser

### Requirement: Viewer keeps graph inspection aligned with logs and artifacts
The system SHALL keep graph inspection aligned with the existing log and
artifact inspection surfaces.

#### Scenario: Graph selection updates step detail tabs
- **WHEN** a user selects a step from the workflow graph
- **THEN** the viewer shows the selected step's relevant log and artifact
  context
- **AND** the viewer does not require the user to manually locate the same step
  again in a separate list
