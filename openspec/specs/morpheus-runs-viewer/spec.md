# morpheus-runs-viewer Specification

## Purpose
TBD - created by archiving change workflow-centric-runs-viewer. Update Purpose after archive.
## Requirements
### Requirement: Viewer presents workflows as the primary record
The system SHALL present workflows, not runs, as the primary object in the
Workflow Viewer UI.

#### Scenario: Workflow list and detail use workflow terminology
- **WHEN** a user opens the Workflow Viewer
- **THEN** the primary navigation labels the left pane as workflows
- **AND** the primary detail pane labels the selected record as a workflow

### Requirement: Viewer shows workflow category in navigation
The system SHALL display each workflow's category as `build` or `run` in the
left-pane workflow list.

#### Scenario: Workflow list shows category beside workflow identity
- **WHEN** the viewer renders workflow summaries
- **THEN** each workflow item includes its category
- **AND** the category is distinct from workflow status

### Requirement: Viewer keeps workflow navigation available when collapsed
The system SHALL collapse the left pane into a stable rail rather than removing
workflow navigation entirely.

#### Scenario: Collapsed left pane remains spatially stable
- **WHEN** a user collapses the left pane on a non-narrow viewport
- **THEN** the viewer keeps a persistent navigation rail in the left-pane
  position
- **AND** the collapse/expand control remains anchored to the same pane
  boundary

### Requirement: Viewer provides workflow overview metadata in the detail pane
The system SHALL show workflow overview metadata above the step list in the
workflow detail pane.

#### Scenario: Workflow detail shows overview facts
- **WHEN** a user selects a workflow
- **THEN** the detail pane shows the workflow category, status, timestamps,
  change, and workflow path when available
- **AND** the step list remains available below the overview metadata

### Requirement: Viewer normalizes workflow category separately from format
The system SHALL normalize workflow category separately from on-disk record
format in viewer summary and detail models.

#### Scenario: Workflow summary and detail distinguish category from format
- **WHEN** the viewer loads workflow data from legacy and workflow-first
  records
- **THEN** the normalized models preserve the record format for compatibility
- **AND** the normalized models expose workflow category as a separate field
  for UI rendering

### Requirement: Viewer discovers workspace run root
The system SHALL discover the local workspace root using `morpheus.yaml` and
derive the run root as `<workspace-root>/runs`.

#### Scenario: Run root resolves from morpheus.yaml
- **WHEN** a user runs the viewer from within a directory tree containing a
  `morpheus.yaml`
- **THEN** the system locates the nearest `morpheus.yaml` by searching parent
  directories
- **AND** the system resolves `workspace.root` relative to the directory that
  contains `morpheus.yaml`
- **AND** the system uses `<workspace.root>/runs` as the run root

#### Scenario: Run root falls back when morpheus.yaml is missing
- **WHEN** `morpheus.yaml` is not found in the current directory tree
- **THEN** the system uses the repo-local default workspace root
- **AND** the system uses `<default-workspace-root>/runs` as the run root

### Requirement: Viewer serves a local-only HTTP endpoint
The system SHALL serve the run viewer UI and API on `127.0.0.1` only by default.

#### Scenario: Viewer binds to localhost by default
- **WHEN** the viewer starts
- **THEN** the system listens on host `127.0.0.1`
- **AND** the system listens on port `4174`

### Requirement: Viewer provides a run listing API
The system SHALL provide a JSON API to list runs under the run root.

#### Scenario: Run listing returns normalized run summaries
- **WHEN** a client requests `GET /api/runs`
- **THEN** the system returns `200` with a JSON body containing a list of run
  summaries
- **AND** each run summary includes run id, status, created timestamp, and step
  count
- **AND** the list is sorted from newest to oldest

### Requirement: Viewer provides a run detail API
The system SHALL provide a JSON API to load run details and step summaries for a
single run id.

#### Scenario: Run detail returns normalized run detail
- **WHEN** a client requests `GET /api/runs/<run-id>`
- **THEN** the system returns `200` with a JSON body containing run metadata and
  a list of steps
- **AND** each step includes step id, name, status, and artifact references when
  available

#### Scenario: Missing run id returns not found
- **WHEN** a client requests `GET /api/runs/<run-id>` for a run that does not
  exist under the run root
- **THEN** the system returns `404`

### Requirement: Viewer supports multiple on-disk run layouts
The system SHALL support both legacy run records and workflow-first run records
when listing and loading runs.

#### Scenario: Legacy run directory is recognized
- **WHEN** a run directory contains `run.json`
- **THEN** the system treats it as a legacy run record

#### Scenario: Workflow-first run directory is recognized
- **WHEN** a run directory contains `workflow.json`
- **THEN** the system treats it as a workflow-first run record

### Requirement: Viewer emits change notifications
The system SHALL notify connected browsers when run data changes on disk so the
UI can refresh live.

#### Scenario: Viewer pushes run change events
- **WHEN** the contents of the run root change
- **THEN** the system emits a `runs-changed` event to connected clients via
  Server-Sent Events (SSE)

### Requirement: Viewer provides step log access
The system SHALL provide access to step logs for a given run and step.

#### Scenario: Client fetches a step log
- **WHEN** a client requests `GET /api/runs/<run-id>/steps/<step-id>/log`
- **THEN** the system returns `200` with a `text/plain` response containing the
  step log content when available

### Requirement: Viewer prevents path traversal
The system SHALL restrict file access to run directories under the configured
run root.

#### Scenario: Invalid run id cannot access files outside run root
- **WHEN** a client requests a run id containing path separators or traversal
  sequences
- **THEN** the system returns `404`
- **AND** the system SHALL NOT read files outside the run root

