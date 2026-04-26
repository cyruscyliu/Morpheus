# nvirsh-build-run-split Specification

## Purpose
TBD - created by archiving change libvmm-runtime-contract-for-nvirsh. Update Purpose after archive.
## Requirements
### Requirement: Nvirsh Build Produces A Runnable State Manifest
The system SHALL provide an `nvirsh build` operation that resolves configured
runtime dependencies and writes a runnable state manifest without launching the
runtime.

#### Scenario: Nvirsh build stages dependencies
- **WHEN** a user invokes `nvirsh build`
- **THEN** nvirsh resolves the configured dependency artifacts and runtime
  provider contract
- **AND** nvirsh writes a state manifest that is sufficient for a later
  `nvirsh run`
- **AND** nvirsh does not launch QEMU during the build step

### Requirement: Nvirsh Run Invokes The Configured Runtime Provider
The system SHALL provide an `nvirsh run` operation that consumes a prepared
state manifest and invokes the configured runtime provider action.

#### Scenario: Nvirsh run delegates to libvmm runtime
- **WHEN** a prepared state manifest identifies libvmm as the runtime provider
  and `qemu` as the action
- **THEN** `nvirsh run` invokes the libvmm runtime action through the provider
  contract
- **AND** nvirsh does not directly embed the provider's internal `make` target
  knowledge

### Requirement: Nvirsh Remains The Local Lifecycle Entry Point
The system SHALL keep `nvirsh` as the local entry point for inspect, logs, and
stop operations even when the runtime provider is another tool.

#### Scenario: Nvirsh stop uses provider runtime metadata
- **WHEN** a user invokes `nvirsh stop` for a running state directory
- **THEN** nvirsh reads the stored provider runtime metadata from its state
- **AND** nvirsh stops the launched runtime using the provider-declared outputs
  such as pid or monitor socket

### Requirement: Nvirsh State Separates Runtime Provider From Dependencies
The system SHALL represent runtime-provider selection separately from artifact
inputs in the prepared state.

#### Scenario: State manifest distinguishes provider from inputs
- **WHEN** nvirsh writes a prepared state manifest
- **THEN** the manifest records the selected runtime provider and action
- **AND** the manifest records concrete resolved artifact inputs separately

