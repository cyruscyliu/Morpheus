# morpheus-workflow-runs Specification

## ADDED Requirements

### Requirement: Workflow Runs Are The Primary Unit Of Execution
The system SHALL represent each execution as a workflow run with a stable
workflow run id.

#### Scenario: A workflow run has an authoritative run directory
- **WHEN** a workflow run is created
- **THEN** Morpheus creates a run directory at
  `<workspace>/runs/<workflow-run-id>/`
- **AND** all run metadata, logs, and artifacts are stored under that
  directory

#### Scenario: A workflow run contains one or more steps
- **WHEN** Morpheus executes a workflow run
- **THEN** Morpheus records each executed unit as a step under
  `<workspace>/runs/<workflow-run-id>/steps/`
- **AND** each step has its own manifest, log, and artifact directory

### Requirement: Workflow Runs Have A Stable Metadata Schema
The system SHALL persist workflow run metadata and step metadata in a stable
machine-readable schema.

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

### Requirement: Tool Commands Create Single-Step Workflow Runs
The system SHALL keep tool entrypoints ergonomic while remaining
workflow-coherent.

#### Scenario: `morpheus tool build` creates a single-step workflow run
- **WHEN** a user invokes `morpheus tool build --tool <name> ...`
- **THEN** Morpheus creates a workflow run containing exactly one step for that
  tool invocation
- **AND** Morpheus returns the workflow run id as the primary identifier

### Requirement: Run Inspection Operates On Workflow Runs
The system SHALL provide run inspection that is workflow-run-centric.

#### Scenario: Run inspection uses workflow run ids
- **WHEN** a user inspects a run via Morpheus
- **THEN** the user references a workflow run id
- **AND** the inspection output includes step summaries and step manifest
  locations

### Requirement: Artifacts Are Stored Under Workflow Steps
The system SHALL store produced and fetched artifacts under the owning workflow
step directory.

#### Scenario: Produced artifacts are recorded under the step directory
- **WHEN** a step produces an artifact
- **THEN** the artifact is recorded in the step manifest
- **AND** the artifact is stored or referenced under the step directory

#### Scenario: Remote artifacts fetched locally are stored under the step
directory
- **WHEN** a workflow step fetches a remote artifact into a local workspace
- **THEN** the artifact is stored under the step `artifacts/` directory
- **AND** subsequent steps can reference the artifact via workflow metadata

