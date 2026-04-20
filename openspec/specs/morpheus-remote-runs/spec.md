# morpheus-remote-runs Specification

## Purpose
TBD - created while archiving change
`move-buildroot-remote-mode-to-morpheus`. Update Purpose after archive.

## Requirements
### Requirement: Morpheus Provides Remote Managed Runs
The system SHALL provide an SSH-backed Morpheus remote run surface for managed
single-tool execution with stable ids, manifests, and log references.

#### Scenario: Morpheus starts a remote Buildroot run
- **WHEN** a user invokes the Morpheus remote run command for Buildroot
- **THEN** Morpheus provisions or reuses the remote workspace state as needed
- **AND** Morpheus returns a stable run id and inspectable metadata

### Requirement: Morpheus Supports Remote Inspection And Retrieval
The system SHALL support inspecting remote managed runs, reading logs, and
fetching explicit remote artifacts through Morpheus.

#### Scenario: Morpheus inspects and fetches an existing remote run
- **WHEN** a user references an existing remote run id
- **THEN** Morpheus can inspect the manifest, read logs, and fetch explicit
  remote paths
- **AND** those actions preserve machine-readable output through `--json`

### Requirement: Buildroot CLI Is Local-Focused
The system SHALL keep the public `buildroot` CLI focused on local Buildroot
operations rather than repository-level SSH orchestration.

#### Scenario: Buildroot help omits remote orchestration commands
- **WHEN** a user reads `buildroot --help`
- **THEN** the public command tree lists local Buildroot operations
- **AND** remote orchestration commands are absent from the Buildroot CLI

### Requirement: Remote Buildroot Orchestration Moves To Morpheus
The system SHALL route repository-level remote Buildroot orchestration through
Morpheus instead of the Buildroot CLI.

#### Scenario: Remote Buildroot usage is expressed through Morpheus
- **WHEN** a user wants to run Buildroot remotely over SSH
- **THEN** that operation is started from Morpheus
- **AND** Buildroot remains the local tool executor rather than the remote run
  manager

### Requirement: Remote Workspaces Require Morpheus
The system SHALL support remote workspaces only when execution is managed by
Morpheus.

#### Scenario: Direct Buildroot invocation does not support remote workspaces
- **WHEN** a user invokes `buildroot` directly
- **THEN** the CLI supports local Buildroot operations only
- **AND** it does not provide remote workspace creation, reuse, inspection, or
  artifact retrieval

#### Scenario: Morpheus owns remote workspace lifecycle
- **WHEN** a user needs a remote workspace for Buildroot
- **THEN** the user invokes the Morpheus remote run surface
- **AND** Morpheus manages the remote workspace lifecycle and metadata
