## MODIFIED Requirements

### Requirement: `nvirsh` Provides a Flat Local Lifecycle CLI
The system SHALL provide a repo-local `nvirsh` tool with only one level of
subcommands. The public command surface SHALL include `doctor`, `run`,
`inspect`, `stop`, `logs`, and `remove`.

#### Scenario: Flat command surface is discoverable
- **WHEN** a user or agent reads `nvirsh --help` or the tool README
- **THEN** only one-level subcommands are presented
- **AND** the public commands include `doctor`, `run`, `inspect`, `stop`,
  `logs`, and `remove`

### Requirement: `nvirsh` Exposes Stable Local Inspection And Cleanup
The tool SHALL provide stable local state inspection, logs, stop, and removal
operations for prepared and running local instances.

#### Scenario: User inspects and removes local state
- **WHEN** a user invokes `nvirsh inspect`, `nvirsh logs`, `nvirsh stop`, or
  `nvirsh remove`
- **THEN** the tool operates on local instance state and local generated assets
- **AND** the commands do not require remote orchestration support

#### Scenario: Remove requires prior successful stop
- **WHEN** a user invokes `nvirsh remove` for an instance that is still running
- **THEN** the tool rejects the request
- **AND** the user must stop the instance successfully before removal
