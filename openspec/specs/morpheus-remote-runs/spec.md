# morpheus-remote-runs Specification

## Purpose
TBD - created while archiving change
`move-buildroot-remote-mode-to-morpheus`. Update Purpose after archive.
## Requirements
### Requirement: Morpheus Provides Remote Managed Runs
The system SHALL provide an SSH-backed Morpheus remote execution surface for
workflow steps with stable workflow run ids, step manifests, and log references.

#### Scenario: Morpheus starts a remote Buildroot step
- **WHEN** a user invokes Morpheus to run Buildroot remotely over SSH
- **THEN** Morpheus provisions or reuses the remote workspace state as needed
- **AND** Morpheus records the execution as a workflow step and returns the
  workflow run id

### Requirement: Morpheus Supports Remote Inspection And Retrieval
The system SHALL support inspecting remote workflow steps, reading logs, and
fetching explicit remote artifacts through Morpheus.

#### Scenario: Morpheus inspects and fetches an existing remote step
- **WHEN** a user references an existing workflow run id and step
- **THEN** Morpheus can inspect the step manifest, read step logs, and fetch
  explicit remote paths
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
- **THEN** that operation is started from Morpheus as a workflow step
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

#### Scenario: Morpheus owns remote workspace lifecycle for workflow steps
- **WHEN** a user needs a remote workspace for a workflow step
- **THEN** the user invokes the Morpheus workflow-managed remote run surface
- **AND** Morpheus manages the remote workspace lifecycle and metadata

### Requirement: Remote Artifacts Can Be Materialized Into Workflow Steps
The system SHALL support fetching remote artifacts into the local workflow step
artifact directory.

#### Scenario: Remote artifact is fetched and recorded as a step artifact
- **WHEN** Morpheus fetches a remote artifact for a workflow step
- **THEN** the artifact is stored under the step `artifacts/` directory
- **AND** the step manifest records both the remote location and local location

