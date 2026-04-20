## Why

Morpheus currently manages remote Buildroot runs, workspace metadata, tool
resolution, and run inspection, but local tool execution is still split across
individual tool CLIs. That leaves Morpheus only half in charge of execution
state. If Morpheus is supposed to manage tool versions, workspaces, manifests,
logs, and artifacts consistently, it should become the managed entrypoint for
both local and remote tool runs.

## What Changes

- Add a Morpheus managed run surface for local and remote tool execution.
- Use one unified Morpheus run surface for both local and remote modes instead
  of separate local and remote command families.
- Make Morpheus own run ids, workspace placement, manifests, logs, and artifact
  references for both local and remote managed runs.
- Keep direct tool CLIs available for unmanaged tool-native use.
- Introduce a shared tool-adapter model so Morpheus can run multiple tools
  without hard-coding one large tool-specific command handler.
- Make Buildroot the first tool supported in both local and remote Morpheus
  managed-run modes.
- Defer multi-node workflow composition until after the managed-run model is
  stable.

## Capabilities

### New Capabilities
- `morpheus-managed-runs`: Provide a unified Morpheus run model for local and
  remote single-tool execution with stable manifests, logs, and artifact
  contracts.

### Modified Capabilities
- `morpheus-remote-runs`: Expand the remote-only run model into a mode-aware
  managed-run model.
- `buildroot-cli`: Reposition Buildroot as a direct tool CLI for unmanaged use
  beside Morpheus-managed execution.

## Impact

- `apps/morpheus` will gain a local managed-run path and a more generic tool
  adapter boundary.
- Buildroot local execution through Morpheus will need normalized manifests and
  workspace layout.
- Future tools such as `llbic` and `llcg` can plug into the same managed-run
  model.
- Docs and skills will need to explain the difference between direct tool use
  and Morpheus-managed execution.
