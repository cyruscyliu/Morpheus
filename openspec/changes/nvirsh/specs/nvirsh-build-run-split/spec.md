## MODIFIED Requirements

### Requirement: Nvirsh Build Produces A Runnable State Manifest
The system SHALL provide an `nvirsh build` operation that resolves configured
runtime dependencies and writes a runnable state manifest without launching the
runtime.

#### Scenario: Nvirsh build stages dependencies
- **WHEN** a user invokes `nvirsh build`
- **THEN** nvirsh resolves the configured profile and dependency artifacts
- **AND** nvirsh writes a state manifest that is sufficient for a later
  `nvirsh exec`
- **AND** nvirsh does not launch the nested stack during the build step

### Requirement: Nvirsh Exec Invokes The Prepared Runtime Phases
The system SHALL provide an `nvirsh exec` operation that consumes a prepared
state manifest and advances the nested stack through the selected phase.

#### Scenario: Nvirsh exec advances a prepared stack
- **WHEN** a prepared state manifest identifies the selected nested stack and a
  user requests a phase such as `boot` or `provision`
- **THEN** `nvirsh exec` advances the stack through that phase
- **AND** nvirsh does not require the user to call a separate `launch`
  command

### Requirement: Nvirsh Remains The Local Lifecycle Entry Point
The system SHALL keep `nvirsh` as the local entry point for inspect, logs, and
stop operations even when the runtime is a nested stack prepared by a profile.

#### Scenario: Nvirsh stop uses manifest runtime metadata
- **WHEN** a user invokes `nvirsh stop` for a running state directory
- **THEN** nvirsh reads the stored runtime metadata from its state
- **AND** nvirsh stops the nested stack using the manifest-declared outputs
  such as pid, monitor socket, or control channel

### Requirement: Nvirsh State Separates Profile Selection From Dependencies
The system SHALL represent profile selection separately from artifact inputs in
the prepared state.

#### Scenario: State manifest distinguishes profile from inputs
- **WHEN** nvirsh writes a prepared state manifest
- **THEN** the manifest records the selected profile and phase state
- **AND** the manifest records concrete resolved artifact inputs separately
