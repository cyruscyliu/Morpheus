## MODIFIED Requirements

### Requirement: Managed Runs Use A Unified Metadata Model
The system SHALL normalize managed local and remote execution into one
workflow-run-first model with stable ids, step manifests, canonical event logs,
compatibility console logs, and artifact references.

#### Scenario: Inspection is workflow-run-id based
- **WHEN** a user inspects a Morpheus-managed run
- **THEN** the user refers to the workflow run by id rather than by tool
  directory layout
- **AND** the normalized run model indicates whether each step was local or
  remote

#### Scenario: Managed run stores canonical event history
- **WHEN** Morpheus records managed run activity
- **THEN** the workflow run directory contains one canonical `events.jsonl`
  history for machine-readable inspection
- **AND** snapshots such as `workflow.json` and `step.json` remain derived
  current-state views rather than the only source of execution history

#### Scenario: Raw console output is compatibility state
- **WHEN** a managed tool emits stdout or stderr during a run
- **THEN** Morpheus may preserve compatibility text log files for human
  inspection
- **AND** the canonical machine-readable representation of that output appears
  in the regulated event stream
