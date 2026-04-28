## ADDED Requirements

### Requirement: Viewer uses a three-region inspection layout
The Workflow Viewer SHALL present a fixed top control bar, a middle inspection
workspace, and a full-width bottom inspection panel.

#### Scenario: Viewer renders the primary layout regions
- **WHEN** a user opens the Workflow Viewer
- **THEN** the viewer shows a top control bar
- **AND** the viewer shows a middle region with workflow navigation beside the
  selected workflow graph
- **AND** the viewer shows a bottom region for inspection tabs and content

### Requirement: Viewer uses the bottom panel for workflow and step inspection
The Workflow Viewer SHALL use the bottom panel as the primary place to inspect
workflow-level and step-level details.

#### Scenario: Bottom panel reflects workflow-level inspection
- **WHEN** a workflow is selected and no graph node is selected
- **THEN** the bottom panel shows workflow-scoped inspection content
- **AND** the user can access workflow overview, logs, or artifacts from that
  panel

#### Scenario: Bottom panel reflects step-level inspection
- **WHEN** a user selects a graph node for a workflow step
- **THEN** the bottom panel updates to show that step's inspection context
- **AND** the user does not leave the current viewer page to inspect the step

### Requirement: Viewer provides a workflow overview inspection tab
The Workflow Viewer SHALL provide a workflow overview path in the bottom
inspection panel.

#### Scenario: User returns to workflow-level context
- **WHEN** a user has been inspecting a selected step
- **THEN** the viewer provides a workflow-level overview selection in the bottom
  panel
- **AND** choosing it clears step-scoped inspection without changing the
  selected workflow
