# morpheus-app Specification

## Purpose
TBD - created by archiving change rename-research-runtime-to-morpheus. Update Purpose after archive.
## Requirements
### Requirement: Morpheus App Identity
The system SHALL provide the primary repository application as
`apps/morpheus` rather than `apps/research-runtime`.

#### Scenario: Repository app uses Morpheus identity
- **WHEN** a user or tool reads the app package metadata, docs, or source path
- **THEN** the application is presented as Morpheus
- **AND** repository references no longer depend on `apps/research-runtime` as
  the active app identity

### Requirement: Morpheus Scope Is Orthogonal Management
The Morpheus app SHALL focus on orthogonal management concerns such as
workspace metadata, artifact inspection, and log inspection.

#### Scenario: Morpheus manages metadata without owning tools
- **WHEN** a user interacts with the Morpheus app
- **THEN** the app manages shared metadata, artifact, or log concerns
- **AND** the app does not require ownership of the underlying tool CLIs

### Requirement: Tool CLIs Remain First-Class
The system SHALL preserve tool CLIs such as `buildroot`, `llbic`, and `llcg`
as independent first-class interfaces.

#### Scenario: Tool CLIs remain usable independently
- **WHEN** a user invokes a tool CLI directly
- **THEN** that tool remains a valid public interface
- **AND** Morpheus acts as a parallel management layer rather than a forced
  replacement

### Requirement: Reusable Runtime Infrastructure May Be Retained Selectively
The system SHALL allow selective reuse of reusable infrastructure from the old
app where it still supports the Morpheus boundary.

#### Scenario: JSON and local inspection patterns are preserved where useful
- **WHEN** reusable components still support metadata, artifact, or log
  management
- **THEN** those components may remain in the renamed app
- **AND** they are reframed under the Morpheus product boundary rather than the
  old research-runtime identity

### Requirement: Morpheus Configures Runtime Providers Separately From Dependencies
The system SHALL allow `morpheus.yaml` to declare a tool runtime provider
separately from the tool's artifact dependencies.

#### Scenario: Nvirsh config declares runtime provider
- **WHEN** a user configures `tools.nvirsh` in `morpheus.yaml`
- **THEN** the configuration can declare a `runtime` block that identifies the
  provider tool artifact and runtime action
- **AND** dependency artifacts remain declared under `dependencies`

### Requirement: Morpheus Distinguishes Nvirsh Build And Run Semantics
The system SHALL treat `nvirsh` dependency staging and runtime launch as
separate tool operations.

#### Scenario: Morpheus stages nvirsh dependencies before runtime launch
- **WHEN** a user asks Morpheus to build or stage `nvirsh`
- **THEN** Morpheus resolves and builds configured producer tools as needed
- **AND** Morpheus writes a prepared nvirsh state without launching the runtime

### Requirement: Workflow Runs Are A First-Class Morpheus Surface
The system SHALL provide a workflow-run-first execution and inspection model.

#### Scenario: Morpheus provides workflow-centric run commands
- **WHEN** a user interacts with Morpheus run history and inspection
- **THEN** Morpheus presents run ids and metadata as workflow runs
- **AND** tool execution details are expressed as steps within the workflow run

### Requirement: Morpheus Configures `nvirsh` from `morpheus.yaml`
The Morpheus app SHALL treat `morpheus.yaml` as the single source of stable
`nvirsh` configuration, including target defaults and target-specific
preparation settings.

#### Scenario: Morpheus loads stable `nvirsh` configuration
- **WHEN** Morpheus resolves configuration for the `nvirsh` tool
- **THEN** it reads stable `nvirsh` settings from `morpheus.yaml`
- **AND** it does not require a second `nvirsh`-specific config file

### Requirement: Morpheus Resolves Tool Dependencies for `nvirsh`
The Morpheus app SHALL resolve tool-to-tool dependencies for `nvirsh`,
including producer artifacts such as Buildroot kernel and initrd outputs, into
concrete local runtime paths before invoking the tool.

#### Scenario: Morpheus wires Buildroot artifacts into `nvirsh`
- **WHEN** a user invokes `morpheus tool run --tool nvirsh`
- **THEN** Morpheus resolves the configured producer artifacts required by
  `nvirsh`
- **AND** it invokes `nvirsh` with concrete local runtime artifact paths rather
  than producer-specific run identifiers or output layout assumptions

### Requirement: Morpheus Preserves `nvirsh` as an Independent Tool CLI
The Morpheus app SHALL treat `nvirsh` as a first-class repo-local tool rather
than absorbing its runtime behavior into the app itself.

#### Scenario: `nvirsh` remains an independent public interface
- **WHEN** a user or agent interacts with nested-virtualization execution
- **THEN** `nvirsh` remains a valid direct CLI
- **AND** Morpheus acts as the configuration and orchestration layer around it

