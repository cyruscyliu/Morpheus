## Why

Managed runtime lifecycle is currently ambiguous across Morpheus workflows and
runtime-oriented tools. `stop` is mostly PID-based, `clean` mixes deletion with
process handling, and stale resources such as `blk_storage` locks can survive
past the point where the run is considered finished.

This needs to be tightened now because Morpheus is increasingly treating local
and remote runs as first-class managed objects. The lifecycle contract needs to
be safe, predictable, and uniform before more tools depend on it.

## What Changes

- Replace ambiguous runtime cleanup semantics with an explicit split between
  `stop` and `remove`.
- Define `stop` as an execution-only lifecycle action that preserves logs,
  manifests, and run metadata.
- Define `remove` as a persisted-state deletion action that is only allowed
  after a prior successful stop or other confirmed non-running state.
- Deprecate runtime-facing `clean` semantics where they overlap with `remove`.
- Strengthen the managed run contract so runs can expose control endpoints for
  graceful shutdown, with signal-based termination retained only as fallback.
- Align workflow stop behavior with the same managed lifecycle model rather than
  ad hoc child-process killing.

## Capabilities

### New Capabilities
- `managed-run-lifecycle`: Defines shared stop/remove lifecycle semantics,
  run-control metadata, and graceful shutdown behavior for managed runtime
  instances.

### Modified Capabilities
- `morpheus-managed-runs`: Runtime state management must preserve manifests and
  logs on stop, and must require a non-running state before removal.
- `morpheus-workflow-runs`: Workflow stop semantics must align with the managed
  lifecycle contract rather than only killing child processes.
- `nvirsh-tool`: Runtime lifecycle commands must distinguish stop from removal
  and conform to the managed run contract.

## Impact

- Affected code:
  `apps/morpheus/src/commands/workflow.ts`,
  `apps/morpheus/src/core/workflow-runs.ts`,
  `tools/nvirsh/src/index.ts`,
  and other runtime-oriented tool wrappers.
- Affected APIs:
  workflow lifecycle commands and runtime tool lifecycle commands.
- Affected systems:
  local managed runs, remote managed runs, workflow-managed execution, and any
  future runtime tool that persists run state under `<workspace>/runs/` or
  `<workspace>/tmp/`.
