## MODIFIED Requirements

### Requirement: Viewer provides graph-ready run detail data
The system SHALL provide normalized selected-workflow detail data that is
enough to render graph nodes, graph edges, artifact flow, status timelines, and
step-scoped artifact references.

#### Scenario: Run detail returns graph payload
- **WHEN** a client requests run detail for a workflow-first run
- **THEN** the returned detail includes graph-ready node and edge data or an
  equivalent normalized relationship model
- **AND** the payload is sufficient for the viewer to render workflow
  visualization without re-parsing raw on-disk workflow records in the browser

#### Scenario: Run detail can derive graph data from canonical events
- **WHEN** a workflow run has a regulated canonical event log
- **THEN** the viewer can derive graph-ready artifact and lifecycle
  relationships from that event history
- **AND** it does not require a separate ad hoc relations file to understand
  artifact flow

### Requirement: Viewer provides step log access
The system SHALL provide access to step logs for a given run and step through
regulated canonical event history, with compatibility support for older text log
records.

#### Scenario: Client fetches a step log
- **WHEN** a client requests `GET /api/runs/<run-id>/steps/<step-id>/log`
- **THEN** the system returns `200` with a `text/plain` response containing the
  step log content when available

#### Scenario: Viewer reads canonical console events for step log output
- **WHEN** a workflow run stores console output in the canonical event stream
- **THEN** the viewer can reconstruct the step log from `console.stdout` and
  `console.stderr` events
- **AND** the viewer may fall back to compatibility text log files for older
  runs that predate the regulated event model

### Requirement: Viewer reflects runtime-backed liveness
The system SHALL interpret runtime-backed execution state from regulated runtime
signals rather than only from final launch-success snapshots.

#### Scenario: Viewer shows runtime-backed step as running
- **WHEN** a step has launched successfully but its regulated runtime state
  still indicates an active process
- **THEN** the viewer shows that step as `running`
- **AND** the workflow summary reflects a running workflow while that runtime
  step remains active
