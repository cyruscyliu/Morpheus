## ADDED Requirements

### Requirement: Workflow Command Surface Supports Resume
The system SHALL expose a workflow resume command for existing workflow run ids.

#### Scenario: User resumes a failed workflow run by id
- **WHEN** a user invokes workflow resume for an existing workflow run id
- **THEN** Morpheus resumes the workflow in place
- **AND** Morpheus reuses validated successful prior steps instead of rerunning
  them

### Requirement: Workflow Command Surface Supports Rerun From Step
The system SHALL allow workflow execution to restart from a named step while
reusing earlier validated steps.

#### Scenario: User reruns a workflow from a named step
- **WHEN** a user invokes workflow run with `--from-step <step-id>`
- **THEN** Morpheus validates the earlier steps for reuse
- **AND** Morpheus reruns from the requested step onward in the existing
  workflow run

## MODIFIED Requirements

### Requirement: Workflow Runs Have A Stable Metadata Schema
The system SHALL persist workflow run metadata and step metadata in a stable
machine-readable schema, including persisted reuse metadata for resume and
rerun-from-step behavior.

#### Scenario: Workflow run metadata is persisted as JSON
- **WHEN** a workflow run is created or updated
- **THEN** Morpheus writes `workflow.json` under the workflow run directory
- **AND** the JSON includes run id, workflow name, step list, status, and
  timestamps

#### Scenario: Step metadata is persisted as JSON
- **WHEN** a workflow step is created or updated
- **THEN** Morpheus writes `step.json` under the step directory
- **AND** the JSON includes tool name, tool mode (local/remote), resolved
  inputs, expected outputs, produced artifacts, status, and timestamps

#### Scenario: Resume metadata is persisted
- **WHEN** a workflow run is resumed or rerun from a named step
- **THEN** the workflow and step manifests record reuse-related metadata
- **AND** later inspection can distinguish reused steps from rerun steps
