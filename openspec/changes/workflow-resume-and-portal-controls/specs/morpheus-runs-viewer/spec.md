## ADDED Requirements

### Requirement: Viewer Exposes Workflow Resume Controls
The runs viewer SHALL expose controls that let a user resume an existing
workflow run or rerun it from a selected step.

#### Scenario: Selected workflow shows resume action
- **WHEN** a user selects a resumable workflow run in the viewer
- **THEN** the detail pane shows a `Resume` action
- **AND** activating that action triggers workflow resume for the selected run

#### Scenario: Selected workflow shows rerun-from-step action
- **WHEN** a user selects a workflow run and a step within it
- **THEN** the detail pane shows a rerun-from-step control for the selected
  step
- **AND** activating that control triggers workflow rerun from that step

## MODIFIED Requirements

### Requirement: Viewer provides workflow overview metadata in the detail pane
The system SHALL show workflow overview metadata above the step list in the
workflow detail pane and surface workflow lifecycle actions that are valid for
the selected run.

#### Scenario: Workflow detail shows overview facts
- **WHEN** a user selects a workflow
- **THEN** the detail pane shows the workflow category, status, timestamps,
  change, and workflow path when available
- **AND** the step list remains available below the overview metadata

#### Scenario: Workflow detail surfaces resume-capable actions
- **WHEN** a selected workflow run is resumable
- **THEN** the detail pane presents the available resume or rerun controls
- **AND** those controls are hidden or disabled when the workflow is not
  eligible
