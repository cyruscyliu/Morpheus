## ADDED Requirements

### Requirement: Morpheus supports explicit config file selection
The system SHALL let users explicitly select the Morpheus config file path for
an invocation.

#### Scenario: Command uses explicit config file
- **WHEN** a user invokes Morpheus with `--config <path>`
- **THEN** Morpheus loads configuration from that exact file
- **AND** Morpheus does not search parent directories for another
  `morpheus.yaml`

### Requirement: Config-relative paths resolve from the selected config
The system SHALL resolve relative config paths against the directory that
contains the selected config file.

#### Scenario: Workspace root resolves relative to explicit config
- **WHEN** a user invokes Morpheus with `--config <path>` and that config
  declares `workspace.root`
- **THEN** Morpheus resolves `workspace.root` relative to the directory that
  contains the selected config file
- **AND** workspace discovery does not depend on the current working directory

### Requirement: Existing config discovery remains the default
The system SHALL preserve current implicit config discovery when explicit
selection is not used.

#### Scenario: Command falls back to upward discovery without --config
- **WHEN** a user invokes Morpheus without `--config`
- **THEN** Morpheus continues to search parent directories for `morpheus.yaml`
- **AND** existing invocations remain valid without requiring explicit config
  selection
