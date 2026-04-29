## Context

Morpheus currently treats runtime lifecycle as a mix of manifest inspection,
PID termination, and ad hoc cleanup. Workflow stop behavior terminates child and
runner processes directly. `nvirsh` exposes `stop` and `clean`, where `clean`
can delete local state and optionally signal running processes. This creates
three problems:

- lifecycle semantics are inconsistent across Morpheus workflows and runtime
  tools
- deletion semantics are ambiguous because `clean` mixes process handling with
  state removal
- stale runtime resources such as `blk_storage` locks can survive when a run is
  considered stopped but was not shut down through a durable control path

The current run model already persists manifests, logs, PIDs, provider-run
references, and run directories. That gives us a strong base for a stricter,
global lifecycle contract without reintroducing tool-specific Morpheus logic.

## Goals / Non-Goals

**Goals:**
- Define a shared lifecycle vocabulary for managed runtime runs:
  `inspect`, `logs`, `stop`, `remove`
- Make `stop` execution-only and preserve manifests, logs, and run metadata
- Make `remove` deletion-only and require a prior successful stop or otherwise
  confirmed non-running state
- Deprecate runtime-facing `clean` semantics where they overlap with `remove`
- Move toward graceful, contract-driven shutdown using control endpoints when a
  tool can expose them
- Keep PID-based termination as a fallback rather than the primary mechanism

**Non-Goals:**
- This change does not redesign build artifact pruning or source-cache cleanup
- This change does not require every runtime tool to implement a graceful
  control endpoint immediately
- This change does not solve every stale-resource problem in one step; it
  defines the lifecycle contract so those issues become tractable

## Decisions

### Decision: Replace `clean` semantics with `remove`
Runtime lifecycle should distinguish execution state from persisted state.
`stop` affects processes. `remove` affects files. `clean` is too ambiguous
because it can mean stop, delete, reset, or prune depending on the tool.

Alternatives considered:
- Keep `clean` and document it better
  Rejected because the ambiguity remains in automation and agent usage.
- Allow `remove --force` to implicitly stop and then delete
  Rejected because deletion should never secretly become a kill operation.

### Decision: Require prior successful stop before removal
`remove` will only be valid after the run is already stopped or otherwise
confirmed non-running. This preserves debuggability and avoids deleting state
for a still-live process.

Alternatives considered:
- Permit forced removal that also sends signals
  Rejected because it collapses execution and deletion into one command.
- Permit deletion if PID checks merely fail
  Rejected because stale manifests and orphaned provider processes would remain
  hard to reason about.

### Decision: Introduce a generic run-control contract
Managed runtime manifests should grow a `control` section that describes how a
run can be shut down gracefully when supported.

Example shapes:
- `type: qmp`, `path: <runDir>/qmp.sock`
- `type: monitor`, `path: <runDir>/monitor.sock`
- `type: none`

Morpheus and tools should prefer the control contract first, then fall back to
process termination.

Alternatives considered:
- Keep shutdown logic tool-specific forever
  Rejected because lifecycle consistency is already a Morpheus concern.
- Force every tool to implement QMP specifically
  Rejected because not every runtime is QEMU-shaped.

### Decision: Make Morpheus own the stop state machine
Tools should expose capabilities and control metadata, but Morpheus should own
the shared stop progression:

```text
try graceful control endpoint
        ↓
wait for exit
        ↓
SIGTERM fallback
        ↓
wait for exit
        ↓
SIGKILL fallback
```

Alternatives considered:
- Have every tool implement its own `stop`
  Rejected because user-facing lifecycle semantics would stay inconsistent.

## Risks / Trade-offs

- [Risk] Existing users may still expect `clean` to remove state after killing
  processes.
  → Mitigation: deprecate `clean` gradually and document `stop` then `remove`
  explicitly.

- [Risk] Some runs will continue to rely on PID termination until they expose a
  control endpoint.
  → Mitigation: treat signals as a valid fallback, but standardize the manifest
  shape now so tools can adopt graceful control incrementally.

- [Risk] Workflow stop behavior may diverge from direct tool stop behavior if
  only one path adopts the contract.
  → Mitigation: update workflow stop to use the same lifecycle state machine and
  persisted run metadata.

- [Risk] Strict remove semantics may feel less convenient during debugging.
  → Mitigation: keep stop cheap and explicit; the extra step is intentional
  safety.

## Migration Plan

1. Add the new lifecycle requirements and control metadata expectations in
   specs.
2. Introduce `remove` for runtime-managed runs and tools.
3. Preserve `stop` as a separate lifecycle action that never deletes state.
4. Mark `clean` as deprecated where it overlaps with `remove`.
5. Update workflow stop to use the same lifecycle contract.
6. Incrementally teach runtime tools to expose control endpoints.
7. Retire `clean` after the new contract is adopted and documented.

Rollback strategy:
- Because this is mostly command-surface and contract work, rollback is a return
  to the previous command mappings and manifest handling. Keeping manifests and
  logs on stop minimizes migration risk.

## Open Questions

- Should `remove` exist both as a workflow-level command and as a direct
  runtime-tool command, or should one delegate to the other everywhere?
- What exact success criteria should count as “prior successful stop” for runs
  that terminate on their own?
- Which runtime tools should be the first to expose control endpoints after the
  contract is in place?
