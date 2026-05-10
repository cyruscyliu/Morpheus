## ADDED Requirements

### Requirement: Workflow Runs Are Discoverable Via CLI
The system SHALL provide a workflow-run listing command that returns stable run
summaries for the selected workspace.

#### Scenario: Workflow run list returns normalized summaries
- **WHEN** a client invokes `morpheus workflow runs --json`
- **THEN** the system returns a JSON list of workflow run summaries
- **AND** each summary includes run id, workflow name, category, status, created
  timestamp, and step count
- **AND** the list is sorted from newest to oldest

#### Scenario: Workflow run list supports pagination
- **WHEN** a client provides `--limit` or `--offset`
- **THEN** the system applies the requested pagination to the returned list

### Requirement: Workflow Runs Expose Canonical Events
The system SHALL provide a workflow event listing command for a selected run id.

#### Scenario: Workflow events return canonical event records
- **WHEN** a client invokes `morpheus workflow events --id <run-id> --json`
- **THEN** the system returns the canonical run event records for that workflow
  run
- **AND** the returned records preserve event order

#### Scenario: Missing workflow run id is rejected
- **WHEN** a client invokes workflow events without a valid workflow run id
- **THEN** the system returns an error response

### Requirement: Workflow Inspection Exposes Viewer-Grade Structured Details
The system SHALL provide inspect output that is sufficient for the run viewer
to render workflow summaries, step details, artifacts, and graph relationships
without parsing on-disk workflow files directly.

#### Scenario: Workflow inspect returns structured step detail
- **WHEN** a client invokes `morpheus workflow inspect --id <run-id> --json`
- **THEN** the system returns run metadata and step summaries
- **AND** each step includes identifier, name, kind, status, timestamps, log
  references, parameters, and artifacts when available

#### Scenario: Workflow inspect returns graph-ready relationships
- **WHEN** a client inspects a workflow run with artifact or sequence
  relationships
- **THEN** the JSON output includes relationship data sufficient for graph
  rendering

#### Scenario: Workflow inspect remains run-id centric
- **WHEN** a client inspects an unknown workflow run id
- **THEN** the system returns a not-found or error response
