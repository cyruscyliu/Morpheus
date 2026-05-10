## MODIFIED Requirements

### Requirement: `nvirsh` Provides A Flat Local Lifecycle CLI
The system SHALL provide a repo-local `nvirsh` tool with only one level of
subcommands. The public command surface SHALL include `fetch`, `build`, `exec`,
`inspect`, `logs`, and `stop`.

#### Scenario: Flat command surface is discoverable
- **WHEN** a user or agent reads `nvirsh --help` or the tool README
- **THEN** only one-level subcommands are presented
- **AND** the public commands include `fetch`, `build`, `exec`, `inspect`,
  `logs`, and `stop`

### Requirement: `nvirsh` Remains Local And Profile-Focused
The `nvirsh` tool SHALL operate only on local execution concerns and
tool-owned profiles. It SHALL NOT own remote execution or guest SSH as a
public command surface.

#### Scenario: `nvirsh` validates local execution inputs only
- **WHEN** a user invokes `nvirsh` for a target run
- **THEN** the tool validates local prerequisites, local prepared state, and
  explicit runtime inputs
- **AND** the tool does not require remote transport or a public `ssh`
  command

### Requirement: `nvirsh` Executes Phased Runtime Actions
The `exec` command SHALL advance the selected nested stack through explicit
phases and SHALL consume the prepared manifest and resolved runtime artifacts.

#### Scenario: `exec` advances a prepared stack
- **WHEN** a user invokes `nvirsh exec --phase boot`
- **THEN** the tool advances the prepared stack through the boot phase
- **AND** it uses the resolved runtime artifacts recorded in the manifest

### Requirement: `nvirsh` Exposes Stable Inspection, Logs, And Stop Operations
The tool SHALL provide stable local state inspection, logs, and stop
operations for prepared and running nested stacks.

#### Scenario: User inspects and stops local state
- **WHEN** a user invokes `nvirsh inspect`, `nvirsh logs`, or `nvirsh stop`
- **THEN** the tool operates on local stack state and generated assets
- **AND** the commands do not require remote orchestration support

### Requirement: Legacy Public Verbs Are Removed
The system SHALL not expose `run`, `launch`, `remove`, or `ssh` as public
`nvirsh` commands.

#### Scenario: Legacy verbs are rejected
- **WHEN** a user invokes `nvirsh run`, `nvirsh launch`, `nvirsh remove`, or
  `nvirsh ssh`
- **THEN** the command is rejected as unsupported
- **AND** the user is directed to `build`, `exec`, `inspect`, `logs`, or
  `stop` instead
