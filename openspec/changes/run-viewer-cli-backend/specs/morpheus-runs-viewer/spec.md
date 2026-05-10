## MODIFIED Requirements

### Requirement: Viewer provides a run listing API
The system SHALL provide a JSON API to list runs for the selected Morpheus
workspace by querying Morpheus CLI workflow-read surfaces rather than scanning
`workspace/runs/...` directly.

#### Scenario: Run listing returns normalized run summaries
- **WHEN** a client requests `GET /api/runs`
- **THEN** the system returns `200` with a JSON body containing a list of run
  summaries sourced from Morpheus workflow read commands
- **AND** each run summary includes run id, status, created timestamp, and step
  count
- **AND** the list is sorted from newest to oldest

### Requirement: Viewer provides a run detail API
The system SHALL provide a JSON API to load run details and step summaries for a
single run id by querying Morpheus CLI workflow-read surfaces.

#### Scenario: Run detail returns normalized run detail
- **WHEN** a client requests `GET /api/runs/<run-id>`
- **THEN** the system returns `200` with a JSON body containing run metadata
  and a list of steps sourced from Morpheus CLI output
- **AND** each step includes step id, name, status, and artifact references when
  available

#### Scenario: Missing run id returns not found
- **WHEN** a client requests `GET /api/runs/<run-id>` for a run that does not
  exist under the selected Morpheus workspace
- **THEN** the system returns `404`

### Requirement: Viewer emits change notifications
The system SHALL notify connected browsers when run data changes so the UI can
refresh live, but payload reconstruction shall continue to come from Morpheus
CLI responses rather than direct on-disk parsing.

#### Scenario: Viewer pushes run change events
- **WHEN** the contents of the managed run area change
- **THEN** the system emits a `runs-changed` event to connected clients via
  Server-Sent Events (SSE)
- **AND** the browser refreshes by re-querying the Morpheus-backed run APIs

### Requirement: Viewer provides step log access
The system SHALL provide access to step logs for a given run and step through
Morpheus workflow log commands.

#### Scenario: Client fetches a step log
- **WHEN** a client requests `GET /api/runs/<run-id>/steps/<step-id>/log`
- **THEN** the system returns `200` with a `text/plain` response containing the
  step log content when available
- **AND** the content is sourced from Morpheus workflow log output

### Requirement: Viewer provides graph-ready run detail data
The system SHALL provide normalized selected-workflow detail data that is
enough to render graph nodes, graph edges, and step-scoped artifact references
from Morpheus CLI output.

#### Scenario: Run detail returns graph payload
- **WHEN** a client requests run detail for a workflow run
- **THEN** the returned detail includes graph-ready node and edge data or an
  equivalent normalized relationship model
- **AND** the payload is sufficient for the viewer to render workflow
  visualization without re-parsing raw on-disk workflow records in the browser
