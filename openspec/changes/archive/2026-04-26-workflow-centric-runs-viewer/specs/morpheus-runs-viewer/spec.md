## ADDED Requirements

### Requirement: Viewer presents workflows as the primary record
The system SHALL present workflows, not runs, as the primary object in the
Workflow Viewer UI.

#### Scenario: Workflow list and detail use workflow terminology
- **WHEN** a user opens the Workflow Viewer
- **THEN** the primary navigation labels the left pane as workflows
- **AND** the primary detail pane labels the selected record as a workflow

### Requirement: Viewer shows workflow category in navigation
The system SHALL display each workflow's category as `build` or `run` in the
left-pane workflow list.

#### Scenario: Workflow list shows category beside workflow identity
- **WHEN** the viewer renders workflow summaries
- **THEN** each workflow item includes its category
- **AND** the category is distinct from workflow status

### Requirement: Viewer keeps workflow navigation available when collapsed
The system SHALL collapse the left pane into a stable rail rather than removing
workflow navigation entirely.

#### Scenario: Collapsed left pane remains spatially stable
- **WHEN** a user collapses the left pane on a non-narrow viewport
- **THEN** the viewer keeps a persistent navigation rail in the left-pane
  position
- **AND** the collapse/expand control remains anchored to the same pane
  boundary

### Requirement: Viewer provides workflow overview metadata in the detail pane
The system SHALL show workflow overview metadata above the step list in the
workflow detail pane.

#### Scenario: Workflow detail shows overview facts
- **WHEN** a user selects a workflow
- **THEN** the detail pane shows the workflow category, status, timestamps,
  change, and workflow path when available
- **AND** the step list remains available below the overview metadata

### Requirement: Viewer normalizes workflow category separately from format
The system SHALL normalize workflow category separately from on-disk record
format in viewer summary and detail models.

#### Scenario: Workflow summary and detail distinguish category from format
- **WHEN** the viewer loads workflow data from legacy and workflow-first
  records
- **THEN** the normalized models preserve the record format for compatibility
- **AND** the normalized models expose workflow category as a separate field
  for UI rendering
