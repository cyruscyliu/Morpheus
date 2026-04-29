## ADDED Requirements

### Requirement: Managed Runtime Runs Separate Stop From Removal
The system SHALL treat runtime shutdown and state deletion as distinct managed
lifecycle actions.

#### Scenario: Stop preserves runtime state
- **WHEN** a user stops a managed runtime run
- **THEN** the system terminates or requests termination of execution
- **AND** the run manifest, logs, and persisted run directory remain available
  for later inspection

#### Scenario: Remove deletes only persisted state
- **WHEN** a user removes a managed runtime run
- **THEN** the system deletes the persisted run state and run directory
- **AND** the remove action does not itself perform runtime termination

### Requirement: Managed Runtime Removal Requires Prior Successful Stop
The system SHALL require a run to be already stopped or otherwise confirmed
non-running before removal is allowed.

#### Scenario: Remove is rejected for a running run
- **WHEN** a user requests removal of a runtime run that is still running
- **THEN** the system rejects the request
- **AND** the system instructs the user to stop the run first

#### Scenario: Remove succeeds after stop
- **WHEN** a user requests removal of a runtime run that was previously stopped
- **THEN** the system removes the persisted run state
- **AND** the system does not send additional termination signals during remove

### Requirement: Managed Runtime Runs Expose Optional Control Metadata
The system SHALL allow managed runtime manifests to describe graceful control
endpoints independently of process identifiers.

#### Scenario: Run manifest records a control endpoint
- **WHEN** a runtime tool can expose a control channel for graceful shutdown
- **THEN** the run manifest records the control metadata
- **AND** the metadata identifies the control type and endpoint location

#### Scenario: Run manifest may omit control metadata
- **WHEN** a runtime tool does not expose a graceful control channel
- **THEN** the run manifest may declare that no control endpoint is available
- **AND** lifecycle fallback behavior remains defined

### Requirement: Stop Prefers Graceful Control And Falls Back To Signals
The system SHALL prefer a declared control endpoint for shutdown and use process
signals only as fallback.

#### Scenario: Stop uses control metadata when available
- **WHEN** a managed runtime run declares a control endpoint
- **THEN** stop first attempts graceful shutdown through that endpoint
- **AND** the system waits for termination before using signal fallbacks

#### Scenario: Stop falls back to process termination
- **WHEN** no graceful control endpoint is available or graceful shutdown fails
- **THEN** the system attempts signal-based termination
- **AND** the signal path is treated as fallback behavior rather than the
  primary shutdown contract
