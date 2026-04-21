## ADDED Requirements

### Requirement: `nvirsh` Provides a Flat Local Lifecycle CLI
The system SHALL provide a repo-local `nvirsh` tool with only one level of
subcommands. The public command surface SHALL include `doctor`, `prepare`,
`run`, `inspect`, `stop`, `logs`, and `clean`.

#### Scenario: Flat command surface is discoverable
- **WHEN** a user or agent reads `nvirsh --help` or the tool README
- **THEN** only one-level subcommands are presented
- **AND** the public commands include `doctor`, `prepare`, `run`, `inspect`,
  `stop`, `logs`, and `clean`

### Requirement: `nvirsh` Remains Local and Runtime-Focused
The `nvirsh` tool SHALL operate only on local execution concerns. It SHALL NOT
own remote execution, managed workspace transport, or producer-tool-specific
artifact discovery.

#### Scenario: `nvirsh` validates local execution inputs only
- **WHEN** a user invokes `nvirsh` for a target run
- **THEN** the tool validates local prerequisites, local prepared state, and
  explicit runtime inputs
- **AND** the tool does not require remote transport or producer-specific run
  identifiers

### Requirement: `prepare` Owns Target-Specific Environment Preparation
The `prepare` command SHALL validate and materialize target-specific local
prepared state before runtime launch. For the initial `sel4` target, this SHALL
include version-sensitive prerequisite validation derived from Morpheus-managed
configuration.

#### Scenario: `prepare` validates pinned `sel4` target prerequisites
- **WHEN** a user invokes `nvirsh prepare` for the `sel4` target
- **THEN** the tool validates configured local prerequisites such as Microkit,
  seL4, libvmm, and the required toolchain
- **AND** the tool reports configuration or compatibility failures before any
  runtime launch is attempted

### Requirement: `run` Consumes Explicit Runtime Artifacts
The `run` command SHALL launch from explicit runtime artifacts, including the
kernel and initrd inputs required by the selected target.

#### Scenario: `run` launches from explicit kernel and initrd artifacts
- **WHEN** a user invokes `nvirsh run` with resolved local runtime artifacts
- **THEN** the tool uses those artifacts for local target execution
- **AND** the tool does not require direct knowledge of the producer tool that
  created them

### Requirement: `nvirsh` Exposes Stable Local Inspection and Cleanup
The tool SHALL provide stable local state inspection, logs, stop, and cleanup
operations for prepared and running local instances.

#### Scenario: User inspects and cleans local state
- **WHEN** a user invokes `nvirsh inspect`, `nvirsh logs`, `nvirsh stop`, or
  `nvirsh clean`
- **THEN** the tool operates on local instance state and local generated assets
- **AND** the commands do not require remote orchestration support
