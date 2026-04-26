# morpheus-managed-runs Specification

## MODIFIED Requirements

### Requirement: Morpheus Supports Managed Local And Remote Runs
The system SHALL provide a Morpheus-managed run surface that executes tool
operations as steps within a workflow run in local and remote modes.

#### Scenario: Morpheus starts a managed local tool step
- **WHEN** a user invokes Morpheus to run a supported tool locally
- **THEN** Morpheus creates a workflow run containing a step for that tool
- **AND** Morpheus returns a stable workflow run id with inspectable metadata

#### Scenario: Morpheus starts a managed remote tool step
- **WHEN** a user invokes Morpheus to run a supported tool remotely
- **THEN** Morpheus manages the remote workspace lifecycle and step record
- **AND** Morpheus returns a stable workflow run id with inspectable metadata

#### Scenario: Local and remote share one public run surface
- **WHEN** a user invokes Morpheus for a managed run
- **THEN** the user uses one workflow-run-first command surface
- **AND** execution mode is expressed as step configuration rather than a
  separate local or remote command family

### Requirement: Managed Runs Use A Unified Metadata Model
The system SHALL normalize managed local and remote execution into one
workflow-run-first model with stable ids, step manifests, logs, and artifact
references.

#### Scenario: Inspection is workflow-run-id based
- **WHEN** a user inspects a Morpheus-managed run
- **THEN** the user refers to the workflow run by id rather than by tool
  directory layout
- **AND** the normalized run model indicates whether each step was local or
  remote

## ADDED Requirements

### Requirement: Managed Run Records Live Under The Workflow Run Root
The system SHALL store managed execution records under the workflow run root
rather than under tool-owned run directories.

#### Scenario: Tool adapters write step manifests into workflow runs
- **WHEN** Morpheus executes a tool as part of a managed run
- **THEN** the tool adapter writes the step manifest and log under the workflow
  run directory
- **AND** Morpheus does not require tool-owned run directories to inspect the
  run

