## ADDED Requirements

### Requirement: `nvirsh` Supports Profile-Backed Nested Stacks
The system SHALL support nested virtualization profiles that define L0, L1,
and nested launch inputs as tool-owned data.

#### Scenario: Profile is resolved from tool-owned data
- **WHEN** a user selects a named `nvirsh` profile
- **THEN** the system resolves the profile from `tools/nvirsh/`
- **AND** the profile provides the inputs needed to prepare and run the nested
  stack

### Requirement: `nvirsh` Uses Phase-Driven Execution
The system SHALL expose a phase-driven `exec` operation that advances a nested
stack through boot, provision, nested launch, and readiness phases.

#### Scenario: Exec advances a nested stack by phase
- **WHEN** a user invokes `nvirsh exec --phase provision`
- **THEN** the system performs the provision phase for the selected profile
- **AND** the manifest records the resulting phase state

### Requirement: `nvirsh` Separates Build Preparation From Execution
The system SHALL allow `build` to prepare a runnable manifest and required
artifacts without launching the nested stack.

#### Scenario: Build prepares state without launching
- **WHEN** a user invokes `nvirsh build`
- **THEN** the system resolves the profile inputs and writes runnable state
- **AND** the system does not launch the nested stack during build

### Requirement: `nvirsh` Records Layered Run State
The system SHALL record L0, L1, provisioning, and nested launch state in the
run manifest.

#### Scenario: Inspect reports layered state
- **WHEN** a user invokes `nvirsh inspect`
- **THEN** the system reports the current L0, L1, provisioning, and nested
  launch state from the run manifest
