## ADDED Requirements

### Requirement: Managed workflows may publish stable reusable planning artifacts
The system SHALL let a managed workflow publish stable reusable artifacts that
later workflows can cite.

#### Scenario: Downstream workflow cites planning artifact from prior run
- **WHEN** a managed workflow publishes a stable planning or review artifact
- **THEN** a later workflow can cite that artifact as an explicit input
- **AND** the later workflow does not need access to the earlier workflow's
  tool-private intermediate state

### Requirement: Managed workflow artifacts remain generic to Morpheus
The system SHALL treat workflow artifacts as generic managed outputs rather than
teaching Morpheus tool-specific interpretation rules.

#### Scenario: Managed paper workflow publishes tool-specific outputs
- **WHEN** `outline-to-paper` publishes planning, gap, review, or export
  artifacts
- **THEN** Morpheus records them as managed workflow artifacts
- **AND** Morpheus does not require built-in paper-specific knowledge to manage
  or reference them
