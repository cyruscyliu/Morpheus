## ADDED Requirements

### Requirement: Morpheus Supports Managed Local And Remote Runs
The system SHALL provide a Morpheus-managed run surface that can execute a
single resolved tool in local and remote modes.

#### Scenario: Morpheus starts a managed local tool run
- **WHEN** a user invokes Morpheus to run a supported tool locally
- **THEN** Morpheus creates a managed run record
- **AND** Morpheus returns a stable run id with inspectable metadata

#### Scenario: Morpheus starts a managed remote tool run
- **WHEN** a user invokes Morpheus to run a supported tool remotely
- **THEN** Morpheus manages the remote workspace lifecycle and run record
- **AND** Morpheus returns a stable run id with inspectable metadata

#### Scenario: Local and remote share one public run surface
- **WHEN** a user invokes Morpheus for a managed run
- **THEN** the user uses one `run` command surface
- **AND** execution mode is expressed as run configuration rather than a
  separate local or remote command family

### Requirement: Managed Runs Use A Unified Metadata Model
The system SHALL normalize managed local and remote runs into one Morpheus run
model with stable ids, manifests, logs, and artifact references.

#### Scenario: Inspection is run-id based
- **WHEN** a user inspects a Morpheus-managed run
- **THEN** the user refers to the run by id rather than by tool-specific local
  or remote metadata locations
- **AND** the normalized run model indicates whether the run was local or
  remote

## MODIFIED Requirements

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
