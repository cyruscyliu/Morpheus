## ADDED Requirements

### Requirement: Morpheus writes a canonical workflow event log
The system SHALL write one canonical append-only `events.jsonl` file for each
workflow run, and that file SHALL be the primary machine-readable history of the
run.

#### Scenario: Workflow run creates canonical event log
- **WHEN** Morpheus starts a workflow run
- **THEN** it creates or opens `<workflow-run>/events.jsonl`
- **AND** all workflow- and step-level events for that run are appended to that
  file

### Requirement: Canonical event records use a stable envelope
The system SHALL write each canonical event record with a stable envelope that
includes timestamp, level, event name, workflow identity, and step context when
available.

#### Scenario: Step event includes shared envelope fields
- **WHEN** Morpheus records a step-scoped event
- **THEN** the JSONL record includes `ts`, `level`, `event`, `workflow_id`,
  `step_id`, and `tool`
- **AND** event-specific payload data appears under a structured field rather
  than only inside free-form text

### Requirement: Canonical events cover workflow and step lifecycle
The system SHALL represent workflow lifecycle and step lifecycle transitions as
canonical events.

#### Scenario: Workflow and step lifecycle become events
- **WHEN** a workflow or step is created, started, completed, failed, stopped,
  or reused
- **THEN** Morpheus appends corresponding lifecycle events to `events.jsonl`
- **AND** the event stream preserves the order in which those transitions
  occurred

### Requirement: Canonical events represent console output
The system SHALL represent raw tool stdout and stderr inside the canonical event
stream as structured console events.

#### Scenario: QEMU build trace enters canonical event stream
- **WHEN** a tool emits raw stdout or stderr during execution, including a large
  build trace such as `qemu build`
- **THEN** Morpheus appends `console.stdout` or `console.stderr` events to
  `events.jsonl`
- **AND** the raw output becomes available to downstream visualizers from that
  single canonical log source

### Requirement: Canonical events represent artifact flow
The system SHALL represent artifact production and consumption in the canonical
event stream.

#### Scenario: Workflow step consumes prior artifact
- **WHEN** a workflow step consumes an artifact produced by another step
- **THEN** Morpheus appends an `artifact.consumed` event that identifies the
  producing step and consumed artifact path
- **AND** the event stream is sufficient for a viewer to reconstruct artifact
  flow without relying on a separate ad hoc relations file

### Requirement: Canonical events represent runtime liveness
The system SHALL represent runtime-backed execution state changes in the
canonical event stream.

#### Scenario: Runtime-backed step enters running state
- **WHEN** a runtime-backed step launches a long-lived process and reaches a
  running state
- **THEN** Morpheus appends runtime lifecycle events that capture that state
- **AND** the event stream provides enough information for a viewer to
  distinguish launch success from still-running execution
