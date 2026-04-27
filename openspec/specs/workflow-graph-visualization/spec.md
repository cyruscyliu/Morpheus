# workflow-graph-visualization Specification

## Purpose
TBD - created by archiving change workflow-visualization. Update Purpose after archive.
## Requirements
### Requirement: Viewer renders a read-only workflow graph
The Workflow Viewer SHALL render a read-only graph for a selected workflow run.

#### Scenario: Multi-step workflow renders connected nodes
- **WHEN** a user selects a workflow run with multiple recorded steps
- **THEN** the viewer renders a graph with one node per step
- **AND** the graph includes edges that represent the workflow relationships
  known to the system

#### Scenario: Single-step workflow renders without synthetic branching
- **WHEN** a user selects a workflow run with exactly one recorded step
- **THEN** the viewer renders a single graph node for that step
- **AND** the viewer does not invent extra nodes or branches

### Requirement: Viewer exposes workflow step state in graph nodes
The Workflow Viewer SHALL show workflow step identity and execution state
directly in each graph node.

#### Scenario: Node shows step summary state
- **WHEN** a graph node is rendered for a workflow step
- **THEN** the node shows the step id or name
- **AND** the node shows the step tool or category
- **AND** the node shows the step status using a visually distinct state
  treatment

### Requirement: Viewer exposes artifact-aware relationships
The Workflow Viewer SHALL represent artifact-aware relationships between steps
when that information is available.

#### Scenario: Artifact dependency is shown between producer and consumer
- **WHEN** the selected workflow contains a step that consumes an artifact from
  another step
- **THEN** the graph shows a relationship between the producing and consuming
  steps
- **AND** the viewer can identify the artifact reference involved in that
  relationship

#### Scenario: Missing artifact relationship falls back safely
- **WHEN** the viewer cannot infer an artifact-aware relationship for a
  workflow step
- **THEN** the viewer still renders the step in the workflow graph
- **AND** any fallback relationship is clearly derived from known workflow
  ordering rather than hidden assumptions

### Requirement: Node selection scopes workflow inspection
The Workflow Viewer SHALL let users select a graph node and inspect that step in
the detail surface.

#### Scenario: Selecting a node focuses step inspection
- **WHEN** a user selects a graph node
- **THEN** the detail surface updates to show logs, artifacts, or metadata for
  the selected step
- **AND** the user can still return to workflow-level inspection context

