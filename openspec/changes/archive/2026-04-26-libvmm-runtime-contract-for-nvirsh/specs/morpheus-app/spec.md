# morpheus-app Specification

## ADDED Requirements

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
