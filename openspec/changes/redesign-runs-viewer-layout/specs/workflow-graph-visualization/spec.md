## MODIFIED Requirements

### Requirement: Viewer renders a read-only workflow graph
The Workflow Viewer SHALL render a read-only graph for a selected workflow run
in the main graph workspace of the viewer.

#### Scenario: Multi-step workflow renders connected nodes
- **WHEN** a user selects a workflow run with multiple recorded steps
- **THEN** the viewer renders a graph with one node per step
- **AND** the graph includes edges that represent the workflow relationships
  known to the system
- **AND** the graph occupies the main inspection workspace for the selected
  workflow

#### Scenario: Single-step workflow renders without synthetic branching
- **WHEN** a user selects a workflow run with exactly one recorded step
- **THEN** the viewer renders a single graph node for that step
- **AND** the viewer does not invent extra nodes or branches

### Requirement: Node selection scopes workflow inspection
The Workflow Viewer SHALL let users select a graph node and inspect that step in
the bottom detail surface.

#### Scenario: Selecting a node focuses step inspection
- **WHEN** a user selects a graph node
- **THEN** the bottom detail surface updates to show logs, artifacts, or
  metadata for the selected step
- **AND** the user can still return to workflow-level inspection context
