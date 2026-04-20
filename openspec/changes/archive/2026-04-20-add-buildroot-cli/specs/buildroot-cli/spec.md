## ADDED Requirements

### Requirement: Standalone Buildroot CLI
The system SHALL provide a standalone `buildroot` command-line interface under `tools/` for orchestrating Buildroot workflows independently of other repository CLIs.

#### Scenario: Discover top-level commands
- **WHEN** a user runs `buildroot --help`
- **THEN** the command prints help for the standalone Buildroot CLI
- **AND** the help lists flat top-level verbs for local and remote workflows

#### Scenario: Discover help in JSON mode
- **WHEN** a user runs `buildroot --help --json`
- **THEN** the command emits machine-readable help output
- **AND** the output describes the available commands and flags without requiring text parsing

### Requirement: Universal JSON Output Contract
The system SHALL support `--json` on every command, including successful results, help output, validation failures, and remote workflow commands.

#### Scenario: Return structured success output
- **WHEN** a user runs any supported command with `--json` and the command succeeds
- **THEN** the CLI emits a machine-readable response describing the command, status, and relevant details

#### Scenario: Return structured error output
- **WHEN** a user runs any supported command with `--json` and validation or execution fails
- **THEN** the CLI emits a machine-readable error response
- **AND** the response identifies the failed command and failure details

### Requirement: Local Buildroot Execution
The system SHALL support local Buildroot execution through flat top-level commands without requiring a workflow configuration file.

#### Scenario: Run a local build
- **WHEN** a user runs `buildroot build` with the required CLI flags
- **THEN** the CLI executes the requested Buildroot workflow locally
- **AND** the CLI reports progress and completion in the selected output mode

#### Scenario: Inspect a local build
- **WHEN** a user runs `buildroot inspect` against a local build context
- **THEN** the CLI reports build state and metadata available to the tool

### Requirement: SSH-Backed Remote Build Provisioning
The system SHALL support remote Buildroot execution over SSH, including explicit SSH ports, and SHALL provision the requested Buildroot version from official release tarballs in a user-specified persistent workspace.

#### Scenario: Provision a missing remote Buildroot release
- **WHEN** a user runs `buildroot remote-build` for a Buildroot version that is not present in the remote workspace
- **THEN** the CLI connects over SSH to the specified target
- **AND** downloads the official release tarball for that version
- **AND** prepares the extracted Buildroot tree in the remote workspace before starting the build

#### Scenario: Reuse cached remote provisioning state
- **WHEN** a user runs `buildroot remote-build` for a Buildroot version already cached in the remote workspace
- **THEN** the CLI reuses the existing tarball or extracted tree instead of reprovisioning from scratch

### Requirement: Remote Build Lifecycle and IDs
The system SHALL identify remote builds by generated IDs and SHALL expose flat lifecycle commands for build, inspect, logs, and fetch operations.

#### Scenario: Run a blocking remote build
- **WHEN** a user runs `buildroot remote-build` without `--detach`
- **THEN** the CLI starts the remote build
- **AND** streams remote logs to stdout by default
- **AND** returns a completion result associated with a generated build ID

#### Scenario: Run a detached remote build
- **WHEN** a user runs `buildroot remote-build --detach`
- **THEN** the CLI returns immediately after submission
- **AND** the result includes the generated build ID for later commands

#### Scenario: Inspect a remote build by ID
- **WHEN** a user runs `buildroot remote-inspect --id <build-id>`
- **THEN** the CLI returns metadata and known status for that remote build ID

#### Scenario: Stream logs for a remote build by ID
- **WHEN** a user runs `buildroot remote-logs --id <build-id>`
- **THEN** the CLI streams logs associated with that remote build ID

### Requirement: Explicit Remote Fetch Semantics
The system SHALL provide remote fetch commands that copy explicitly requested remote paths and SHALL NOT assume Buildroot artifact semantics on behalf of the user.

#### Scenario: Fetch explicit remote paths
- **WHEN** a user runs `buildroot remote-fetch --id <build-id>` with explicit remote paths or globs
- **THEN** the CLI copies only the requested remote paths from the remote workspace

#### Scenario: Avoid artifact assumptions
- **WHEN** a user runs `buildroot remote-fetch` without specifying what to copy
- **THEN** the CLI does not invent default Buildroot artifact selections
- **AND** the CLI returns a validation error explaining that explicit paths are required
