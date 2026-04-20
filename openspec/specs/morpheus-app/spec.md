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

### Requirement: Workflow Runtime Is Deferred
The Morpheus app SHALL NOT require a workflow runtime model in the current
phase.

#### Scenario: Workflow execution is not a required current capability
- **WHEN** a user inspects the current Morpheus app surface
- **THEN** workflow-runtime-first behavior is absent, removed, or clearly
  deferred
- **AND** the current app scope remains aligned to management concerns

### Requirement: Reusable Runtime Infrastructure May Be Retained Selectively
The system SHALL allow selective reuse of reusable infrastructure from the old
app where it still supports the Morpheus boundary.

#### Scenario: JSON and local inspection patterns are preserved where useful
- **WHEN** reusable components still support metadata, artifact, or log
  management
- **THEN** those components may remain in the renamed app
- **AND** they are reframed under the Morpheus product boundary rather than the
  old research-runtime identity

