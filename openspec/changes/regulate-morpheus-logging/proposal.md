## Why

Morpheus logging is currently split across raw text logs, partial JSONL streams, and step or workflow snapshots with overlapping responsibilities. This makes the system hard to reason about, prevents fine-grained filtering in the runs viewer, and leaves runtime progress, artifact flow, and tool phases inconsistently represented.

## What Changes

- Introduce a regulated workflow-run event log as the canonical machine-readable history for workflow and step activity.
- Define a compact event taxonomy for workflow lifecycle, step lifecycle, runtime liveness, tool phases, artifact production, artifact consumption, warnings, errors, and console output.
- Clarify the roles of canonical event logs, raw console logs, and derived state snapshots so logging responsibilities stop overlapping.
- Update the runs viewer contract so timeline, status interpretation, and future visualizations can rely on canonical event records instead of ad hoc file combinations.
- Standardize how tools contribute structured events without requiring each tool to invent its own logging format.

## Capabilities

### New Capabilities
- `morpheus-run-events`: Define the canonical workflow-run event log format, event taxonomy, and file semantics for Morpheus-managed runs.

### Modified Capabilities
- `morpheus-runs-viewer`: Change the runs viewer contract so it consumes regulated workflow-run events as a first-class inspection source.
- `morpheus-managed-runs`: Change managed run requirements to distinguish canonical event logs, raw console logs, and derived run snapshots.

## Impact

- `apps/morpheus`: workflow execution, logging, snapshot generation, and tool-event normalization.
- `tools/*`: structured event emission conventions and log channel expectations.
- `apps/runs-viewer`: event ingestion, filtering, status derivation, and visualization surfaces.
- OpenSpec documentation for managed runs, viewer behavior, and the new event capability.
