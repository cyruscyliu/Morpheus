## ADDED Requirements

### Requirement: Workflow Runs Support In-Place Resume
The system SHALL support resuming an existing workflow run in place without
creating a new workflow run id.

#### Scenario: Resume continues from the first non-reusable step
- **WHEN** a user requests workflow resume for an existing workflow run
- **THEN** the system reuses the longest validated successful prefix
- **AND** the system continues execution from the first step that is not
  reusable
- **AND** the workflow run id remains unchanged

### Requirement: Workflow Runs Support Rerun From A Named Step
The system SHALL support forcing a rerun from a named step within an existing
workflow run.

#### Scenario: Rerun starts from requested step after validating prior steps
- **WHEN** a user requests a rerun from step `<step-id>`
- **THEN** every earlier step must validate as reusable
- **AND** the requested step and all later steps are rerun
- **AND** the workflow run id remains unchanged

#### Scenario: Rerun is rejected when prior steps are not reusable
- **WHEN** a user requests rerun from a named step but an earlier step fails
  reuse validation
- **THEN** the system rejects the request
- **AND** the response identifies the first earlier step that could not be
  reused

### Requirement: Step Reuse Requires Explicit Validation
The system SHALL treat a prior workflow step as reusable only when its identity,
artifacts, and invocation context still match.

#### Scenario: Successful step is reused when validation passes
- **WHEN** a prior step has status `success`
- **AND** its required artifacts still exist
- **AND** its fingerprint matches the current invocation context
- **THEN** the system marks the step as reused
- **AND** the step is not executed again

#### Scenario: Step is not reused when fingerprint changes
- **WHEN** a prior successful step has a fingerprint mismatch against the
  current invocation context
- **THEN** the system treats the step as non-reusable
- **AND** resume or rerun continues from that step onward

### Requirement: Workflow Reuse Metadata Is Persisted
The system SHALL persist workflow-level and step-level reuse metadata for
inspection and debugging.

#### Scenario: Workflow manifest records resume history
- **WHEN** a workflow run is resumed or rerun from a named step
- **THEN** the workflow manifest records the resume event
- **AND** the workflow manifest records the step where rerun resumed

#### Scenario: Step manifest records reuse state and fingerprint
- **WHEN** a workflow step is created or updated
- **THEN** the step manifest records its reuse state
- **AND** the step manifest records the fingerprint and resolved inputs used for
  reuse validation
