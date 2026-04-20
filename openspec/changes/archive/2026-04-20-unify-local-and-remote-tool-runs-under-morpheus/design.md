## Context

Morpheus already owns some of the right concerns: workspace metadata, tool
resolution, run inspection, and now remote Buildroot runs. But local execution
still bypasses Morpheus and writes tool-specific state directly. That means the
repo has two execution models:

- direct tool-native local execution
- Morpheus-managed remote execution

If Morpheus is intended to manage versions and workspaces consistently, that
split is too deep. The managed path should be mode-aware rather than remote-
only. The right abstraction is not a workflow yet. It is a managed run of one
resolved tool, executed either locally or remotely, with a stable Morpheus run
record.

## Goals / Non-Goals

**Goals:**
- Make Morpheus the managed entrypoint for both local and remote tool runs.
- Keep direct tool CLIs available as first-class unmanaged interfaces.
- Unify run ids, manifests, logs, and artifact references across local and
  remote modes.
- Introduce a reusable tool-adapter boundary for Morpheus-managed execution.
- Start with Buildroot as the first local+remote Morpheus-managed tool.

**Non-Goals:**
- Building a full multi-node workflow engine in this change.
- Removing direct tool CLIs.
- Moving every tool to Morpheus in one step.
- Solving every version-management concern for every tool immediately.

## Decisions

### 1. Morpheus owns managed runs, tools provide execution logic

Morpheus should manage execution state. Individual tools should provide the
execution logic that Morpheus invokes through an adapter boundary.

Why:
- This keeps Morpheus responsible for ids, manifests, logs, artifacts, and
  workspaces.
- It prevents Morpheus from becoming just a giant wrapper around raw shell
  commands.
- It allows direct tool use to coexist cleanly with managed execution.

### 2. Local and remote are execution modes, not separate products

Local and remote execution should be modeled as different modes of the same
managed-run system.

Why:
- `inspect`, `logs`, and `fetch` should eventually work by run id regardless of
  where the tool ran.
- This reduces duplicated command trees and state models.

Alternatives considered:
- Keep separate local and remote command families: rejected because it freezes
  the current split into the public design.

### 3. Start with single-tool runs, defer workflows

A single managed run is the right unit now. Workflow composition should be a
later layer built on top of managed runs.

Why:
- One-node workflows add extra abstraction before the run model is stable.
- Managed runs are already enough to support local and remote execution,
  manifests, and artifacts.

### 4. Keep direct tool CLIs as unmanaged paths

Tool CLIs such as `buildroot` should remain usable directly, but users should
understand that those are unmanaged tool-native paths rather than Morpheus-
managed runs.

Why:
- This preserves tool autonomy.
- It gives developers and power users a lower-level interface.
- It creates a crisp distinction between direct execution and managed
  execution.

## Proposed Surface

The target direction is:

```text
morpheus run --tool <name> --mode local ...
morpheus run --tool <name> --mode remote ...
morpheus inspect --id <run-id>
morpheus logs --id <run-id>
morpheus fetch --id <run-id> --path ...
```

Buildroot would be the first adapter, but the structure should support later
adapters for `llbic` and `llcg`.

This intentionally avoids awkward split command families such as separate
`remote-run` and `run` verbs. Local and remote are execution modes of the same
managed-run system, not separate products.

## Tool Adapter Shape

A managed tool adapter will likely need:
- tool identity
- supported execution modes
- input mapping rules
- version-selection rules
- workspace layout rules
- manifest normalization rules
- artifact normalization rules

This should be data-driven or module-based enough to avoid one giant if/else
handler inside Morpheus.

## Risks / Trade-offs

- [Morpheus becomes too tool-specific] → Mitigation: define explicit tool
  adapters instead of scattering tool logic in one file.
- [Users get confused between managed and direct tool usage] → Mitigation:
  document the distinction clearly and keep command semantics predictable.
- [Local and remote manifest normalization is harder than expected] →
  Mitigation: start with Buildroot and define one canonical Morpheus run record.
- [Version management grows quickly in scope] → Mitigation: start by defining
  the adapter boundary, not by solving every version policy at once.

## Migration Plan

1. Define the Morpheus managed-run surface for local and remote modes.
2. Introduce a Buildroot adapter for both modes.
3. Normalize run metadata across local and remote execution.
4. Update docs and skills to distinguish direct tool use from managed runs.
5. Plan follow-up changes for additional tools.

## Open Questions

- Should Morpheus always write managed runs into the workspace even for local
  mode?
- How much tool version policy should be part of the first adapter contract?
