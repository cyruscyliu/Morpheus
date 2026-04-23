## Why

Morpheus currently records executions in two different "runs" namespaces:
`<workspace>/runs/` and `<workspace>/tools/<tool>/runs/`. In practice this makes
it unclear where the authoritative record, logs, and artifacts live, and it
pushes users into tool-specific mental models when they are really running a
workflow (e.g. Buildroot -> nvirsh).

We want one coherent concept: a "run" is a workflow run. Tool executions are
steps within that workflow run.

## What Changes

- Introduce workflow-run-first storage: a workflow run owns its run directory
  under `<workspace>/runs/<workflow-run-id>/`, including step manifests, logs,
  and fetched artifacts.
- Keep tool caches under `<workspace>/tools/<tool>/{src,builds,cache}` for
  reuse, but remove tool-owned run records from
  `<workspace>/tools/<tool>/runs/`.
- Make `morpheus tool build` automatically create a workflow containing a
  single step (so "tool runs" remain ergonomic while staying workflow-coherent).
- Update `morpheus runs` inspection/export surfaces to operate on workflow runs
  and step summaries rather than tool-run directories.
- **BREAKING**: existing tool-run directory layouts and any scripts that read
  `<workspace>/tools/<tool>/runs/` directly will need to migrate to the workflow
  run layout or use Morpheus inspection commands.

## Capabilities

### New Capabilities

- `morpheus-workflow-runs`: Define workflow run ids, run directory layout,
  step records, and how Morpheus surfaces workflow-centric inspection, logs,
  and artifact access.

### Modified Capabilities

- `morpheus-app`: Remove the "workflow runtime is deferred" constraint and
  define the workflow-run-first boundary for Morpheus.
- `morpheus-managed-runs`: Reframe managed runs as workflow runs with tool-step
  execution, rather than single-tool runs being the primary unit.
- `morpheus-remote-runs`: Reframe remote execution as workflow steps while
  preserving SSH-backed inspection and artifact retrieval.

## Impact

- `apps/morpheus` CLI surface and JSON payload shapes (run ids, manifests, and
  inspection output become workflow-centric).
- Workspace on-disk layout (authoritative runs move to `<workspace>/runs/...`).
- Managed state registry/indexing (needs to track workflow runs and step runs).
- Tool adapters (Buildroot/QEMU/microkit-sdk/libvmm/nvirsh) need to emit step
  records into a workflow run directory while continuing to use reusable caches
  under `<workspace>/tools/...`.
