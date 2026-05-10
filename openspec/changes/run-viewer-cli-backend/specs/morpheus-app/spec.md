## ADDED Requirements

### Requirement: Morpheus Exposes Workflow Read Surfaces As First-Class CLI Commands
The system SHALL expose workflow run listing and workflow event access as
first-class Morpheus CLI commands for client applications such as the run
viewer.

#### Scenario: Workflow read commands return JSON
- **WHEN** a client invokes the workflow read surfaces with `--json`
- **THEN** the commands return machine-readable JSON payloads suitable for UI
  adapters

#### Scenario: Workflow read commands remain Morpheus-managed
- **WHEN** a client uses the workflow read surfaces
- **THEN** the client receives Morpheus-managed workflow metadata rather than
  direct filesystem instructions

### Requirement: Morpheus Keeps Viewer Storage Boundaries Internal
The system SHALL keep workflow run storage layout internal to Morpheus and not
require viewers to reconstruct workflow data from on-disk manifests.

#### Scenario: Viewer clients do not depend on storage layout
- **WHEN** a viewer consumes Morpheus workflow read commands
- **THEN** the viewer can render workflow state without parsing
  `workspace/runs/...` internals directly
