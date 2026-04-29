## ADDED Requirements

### Requirement: Workflow Runs Support Explicit Removal After Stop
The system SHALL support removing persisted workflow-run state only after the
workflow run is already stopped or otherwise confirmed non-running.

#### Scenario: Remove is rejected for an active workflow run
- **WHEN** a user requests removal of a workflow run that is still running
- **THEN** the system rejects the request
- **AND** the system requires the workflow run to be stopped first

#### Scenario: Remove succeeds for a stopped workflow run
- **WHEN** a user requests removal of a stopped workflow run
- **THEN** the system removes the workflow run directory
- **AND** the remove action does not perform additional lifecycle termination

## MODIFIED Requirements

### Requirement: Run Inspection Operates On Workflow Runs
The system SHALL provide run inspection that is workflow-run-centric and
preserve stopped workflow metadata until explicit removal.

#### Scenario: Run inspection uses workflow run ids
- **WHEN** a user inspects a run via Morpheus
- **THEN** the user references a workflow run id
- **AND** the inspection output includes step summaries and step manifest
  locations

#### Scenario: Stopped workflow runs remain inspectable
- **WHEN** a workflow run has been stopped
- **THEN** the workflow manifest and step manifests remain available for
  inspection
- **AND** removal is a separate explicit action
