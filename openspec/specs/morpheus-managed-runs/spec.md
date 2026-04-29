# morpheus-managed-runs Specification

## Purpose
TBD - created while archiving change
`unify-local-and-remote-tool-runs-under-morpheus`. Update Purpose after
archive.
## Requirements
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

### Requirement: Direct Tool CLIs Remain Available
The system SHALL preserve direct tool CLIs as unmanaged tool-native execution
paths.

#### Scenario: Direct tool use remains possible beside Morpheus
- **WHEN** a user invokes a tool CLI directly
- **THEN** the tool remains usable without Morpheus
- **AND** that path does not replace the Morpheus-managed run model

### Requirement: Morpheus Manages Tool Versions And Workspaces
The system SHALL treat tool versions and workspace placement as Morpheus-managed
concerns for managed runs.

#### Scenario: Managed run resolves tool and workspace context
- **WHEN** a user invokes Morpheus for a managed run
- **THEN** Morpheus resolves the tool context and workspace placement
- **AND** the managed run record reflects that resolved execution context

### Requirement: Managed Runtime Launches Preserve Provider Run Metadata
The system SHALL preserve runtime-provider metadata when Morpheus manages a
consumer runtime launch, including any control metadata required for graceful
shutdown.

#### Scenario: Managed nvirsh run records nested provider result
- **WHEN** Morpheus manages an `nvirsh run` that delegates to `libvmm run`
- **THEN** the managed nvirsh record includes the provider run manifest or a
  stable reference to it
- **AND** the managed run remains inspectable through the nvirsh-owned state

#### Scenario: Managed runtime metadata includes provider control information
- **WHEN** a delegated provider run exposes a control endpoint or graceful stop
  metadata
- **THEN** the managed run record preserves a stable reference to that metadata
- **AND** Morpheus can use it during managed stop behavior

### Requirement: Managed Producer Builds And Runtime Launches Are Distinct
The system SHALL record producer builds and runtime launches as distinct managed
operations even when they are part of one user workflow.

#### Scenario: Workflow records staging separately from launch
- **WHEN** a workflow stages dependencies and then launches a runtime provider
- **THEN** Morpheus records the staging operation separately from the runtime
  launch
- **AND** users can inspect logs and artifacts for each operation independently

### Requirement: Managed Run Records Live Under The Workflow Run Root
The system SHALL store managed execution records under the workflow run root
rather than under tool-owned run directories.

#### Scenario: Tool adapters write step manifests into workflow runs
- **WHEN** Morpheus executes a tool as part of a managed run
- **THEN** the tool adapter writes the step manifest and log under the workflow
  run directory
- **AND** Morpheus does not require tool-owned run directories to inspect the
  run
