## MODIFIED Requirements

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
