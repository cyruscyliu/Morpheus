## ADDED Requirements

### Requirement: Libvmm Build Emits A Runtime Contract
The system SHALL emit a stable runtime-contract artifact when libvmm prepares a
managed example workspace for runtime use.

#### Scenario: Managed libvmm build records runtime capability
- **WHEN** a user or Morpheus builds libvmm for a runnable example
- **THEN** the build result includes a `runtime-contract` artifact
- **AND** the artifact identifies the example, supported runtime actions, and
  contract schema version

### Requirement: Libvmm Run Owns Example Runtime Actions
The system SHALL provide a `libvmm run` command that launches an example-owned
runtime action rather than requiring another tool to invoke `make` directly.

#### Scenario: Libvmm runs the virtio qemu action
- **WHEN** a caller invokes `libvmm run` for the `qemu` action with the
  required runtime inputs
- **THEN** libvmm launches the example from the provider-owned working
  directory
- **AND** the caller does not need to know the example's internal `make`
  target layout

### Requirement: Runtime Contracts Declare Inputs And Outputs
The system SHALL define required runtime inputs and stable runtime outputs in
its runtime contract.

#### Scenario: Runtime contract lists launch inputs and outputs
- **WHEN** a caller inspects a libvmm runtime contract
- **THEN** the contract lists required inputs such as kernel, initrd, qemu,
  microkit sdk, board, and microkit config
- **AND** the contract lists stable runtime outputs such as log file, pid, or
  monitor socket when provided

### Requirement: Libvmm Run Returns Machine-Readable Runtime Metadata
The system SHALL return a stable machine-readable result for `libvmm run`.

#### Scenario: Json run result includes runtime metadata
- **WHEN** a caller invokes `libvmm run --json`
- **THEN** libvmm returns a single JSON result describing run status
- **AND** the result includes manifest and log locations
- **AND** the result includes runtime outputs declared by the contract when
  they are available
