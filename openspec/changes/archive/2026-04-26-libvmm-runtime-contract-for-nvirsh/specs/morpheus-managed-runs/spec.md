# morpheus-managed-runs Specification

## ADDED Requirements

### Requirement: Managed Runtime Launches Preserve Provider Run Metadata
The system SHALL preserve runtime-provider metadata when Morpheus manages a
consumer runtime launch.

#### Scenario: Managed nvirsh run records nested provider result
- **WHEN** Morpheus manages an `nvirsh run` that delegates to `libvmm run`
- **THEN** the managed nvirsh record includes the provider run manifest or a
  stable reference to it
- **AND** the managed run remains inspectable through the nvirsh-owned state

### Requirement: Managed Producer Builds And Runtime Launches Are Distinct
The system SHALL record producer builds and runtime launches as distinct managed
operations even when they are part of one user workflow.

#### Scenario: Workflow records staging separately from launch
- **WHEN** a workflow stages dependencies and then launches a runtime provider
- **THEN** Morpheus records the staging operation separately from the runtime
  launch
- **AND** users can inspect logs and artifacts for each operation independently
