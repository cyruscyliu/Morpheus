## MODIFIED Requirements

### Requirement: Viewer presents workflows as the primary record
The system SHALL present workflows, not runs, as the primary object in the
Workflow Viewer UI.

#### Scenario: Workflow list and detail use workflow terminology
- **WHEN** a user opens the Workflow Viewer
- **THEN** the primary navigation labels the left pane as workflows
- **AND** the primary detail pane labels the selected record as a workflow

### Requirement: Viewer provides workflow overview metadata in the detail pane
The system SHALL show workflow overview metadata in the bottom inspection panel
for the selected workflow.

#### Scenario: Workflow detail shows overview facts
- **WHEN** a user selects a workflow
- **THEN** the bottom inspection panel shows the workflow category, status,
  timestamps, change, and workflow path when available
- **AND** the bottom inspection panel provides a workflow-level context that is
  separate from any selected workflow step

### Requirement: Viewer provides a workflow graph inspection mode
The system SHALL provide a graph-based inspection mode for the selected
workflow in the middle workspace of the viewer.

#### Scenario: User switches from history to graph inspection
- **WHEN** a user selects a workflow in the Workflow Viewer
- **THEN** the viewer keeps the workflow history surface available in a left
  navigation pane
- **AND** the selected workflow exposes a graph inspection surface in the
  middle workspace without navigating away from the viewer

### Requirement: Viewer keeps graph inspection aligned with logs and artifacts
The system SHALL keep graph inspection aligned with the bottom inspection
surfaces for workflow and step details.

#### Scenario: Graph selection updates step detail tabs
- **WHEN** a user selects a step from the workflow graph
- **THEN** the viewer shows the selected step's relevant log and artifact
  context in the bottom inspection panel
- **AND** the viewer does not require the user to manually locate the same step
  again in a separate list
