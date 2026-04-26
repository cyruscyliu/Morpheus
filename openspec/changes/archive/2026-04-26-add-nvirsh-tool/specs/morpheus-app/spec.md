## ADDED Requirements

### Requirement: Morpheus Configures `nvirsh` from `morpheus.yaml`
The Morpheus app SHALL treat `morpheus.yaml` as the single source of stable
`nvirsh` configuration, including target defaults and target-specific
preparation settings.

#### Scenario: Morpheus loads stable `nvirsh` configuration
- **WHEN** Morpheus resolves configuration for the `nvirsh` tool
- **THEN** it reads stable `nvirsh` settings from `morpheus.yaml`
- **AND** it does not require a second `nvirsh`-specific config file

### Requirement: Morpheus Resolves Tool Dependencies for `nvirsh`
The Morpheus app SHALL resolve tool-to-tool dependencies for `nvirsh`,
including producer artifacts such as Buildroot kernel and initrd outputs, into
concrete local runtime paths before invoking the tool.

#### Scenario: Morpheus wires Buildroot artifacts into `nvirsh`
- **WHEN** a user invokes `morpheus tool run --tool nvirsh`
- **THEN** Morpheus resolves the configured producer artifacts required by
  `nvirsh`
- **AND** it invokes `nvirsh` with concrete local runtime artifact paths rather
  than producer-specific run identifiers or output layout assumptions

### Requirement: Morpheus Preserves `nvirsh` as an Independent Tool CLI
The Morpheus app SHALL treat `nvirsh` as a first-class repo-local tool rather
than absorbing its runtime behavior into the app itself.

#### Scenario: `nvirsh` remains an independent public interface
- **WHEN** a user or agent interacts with nested-virtualization execution
- **THEN** `nvirsh` remains a valid direct CLI
- **AND** Morpheus acts as the configuration and orchestration layer around it
