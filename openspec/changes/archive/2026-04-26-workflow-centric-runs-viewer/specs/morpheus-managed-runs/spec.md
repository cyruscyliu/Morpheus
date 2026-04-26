## MODIFIED Requirements

### Requirement: Managed Runs Use A Unified Metadata Model
The system SHALL normalize managed local and remote execution into one
workflow-run-first model with stable ids, workflow metadata, step manifests,
logs, and artifact references.

#### Scenario: Inspection is workflow-run-id based
- **WHEN** a user inspects a Morpheus-managed run
- **THEN** the user refers to the workflow run by id rather than by tool
  directory layout
- **AND** the normalized run model indicates whether each step was local or
  remote

#### Scenario: Workflow metadata includes workflow category
- **WHEN** Morpheus records or emits workflow-run metadata for inspection
  surfaces
- **THEN** the workflow metadata includes an explicit workflow category
- **AND** the category distinguishes `build` workflows from `run` workflows
- **AND** the category is represented separately from storage format or legacy
  kind fields
