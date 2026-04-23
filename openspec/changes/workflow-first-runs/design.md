## Context

Today Morpheus has two concurrent concepts of "runs":

- Workflow/legacy runs rooted at `<workspace>/runs/` (used by `morpheus runs`
  surfaces such as `runs show` / `runs export-html`).
- Tool-managed runs rooted at `<workspace>/tools/<tool>/runs/<id>/` (used by
  `morpheus tool build`, `morpheus tool inspect`, and tool adapters such as
  Buildroot and nvirsh).

In practice this is confusing because users have to guess where the
authoritative record, logs, and artifacts live. It also makes it hard to talk
about end-to-end pipelines (Buildroot -> nvirsh) as a single run.

This change adopts "Style A": a run is always a workflow run, and tool
executions are steps within that workflow run.

Constraints:

- Keep tool caches reusable across runs (sources, builds, downloads).
- Keep direct tool CLIs usable without Morpheus.
- Preserve `--json` as a first-class interface with stable fields.

## Goals / Non-Goals

**Goals:**

- Make `<workspace>/runs/<workflow-run-id>/` the only authoritative location for
  run manifests, logs, and fetched artifacts.
- Represent tool execution as workflow steps with explicit inputs/outputs.
- Keep `morpheus tool build` ergonomic by auto-creating a single-step workflow
  run when invoked directly.
- Keep reusable caches under `<workspace>/tools/<tool>/{src,builds,cache}`.

**Non-Goals:**

- A general workflow DSL, scheduler, or parallel step executor.
- A new remote execution model beyond the existing SSH-backed tool adapters.
- Rewriting tool CLIs to depend on Morpheus state.
- Perfect backwards compatibility for scripts that read
  `<workspace>/tools/<tool>/runs/` directly (this is a breaking change).

## Decisions

### Decision: Workflow run directory layout owns execution records

Each workflow run has a single root:

```
<workspace>/runs/<workflow-run-id>/
  workflow.json
  steps/
    01-<step-name>/
      step.json
      stdout.log
      artifacts/
```

`workflow.json` is the primary index for the run. It references each step by
path and summarizes status and timing.

Each step directory is the authoritative location for:

- the step manifest (`step.json`)
- the step log (`stdout.log`)
- any fetched or produced artifacts (`artifacts/`)

Tool adapters MUST write step metadata into the provided step directory rather
than creating tool-owned run directories.

### Decision: Keep tool caches in tool roots, but remove tool-owned runs

Tool caches remain stable and reusable:

- `<workspace>/tools/<tool>/src/` for fetched/unpacked source trees
- `<workspace>/tools/<tool>/builds/` for reusable build directories
- `<workspace>/tools/<tool>/cache/` for downloads and intermediate caches

However, tool-owned run records are removed:

- `<workspace>/tools/<tool>/runs/` is deprecated and will no longer be the
  canonical source of truth for execution records.

Rationale: this preserves the performance and reuse benefits of the current
design while making the "run" concept workflow-centric.

### Decision: Tool invocations are steps (with a stable step contract)

Each step manifest records:

- tool name and tool mode (local/remote)
- resolved workspace roots involved (local workspace, optional remote workspace)
- resolved input artifacts (path + provenance)
- expected and produced artifacts (path + location)
- log file location
- status transitions (created, running, success/error) and timestamps

The contract is intentionally thin: tool adapters remain wrappers around the
underlying tool CLIs, but they must emit step metadata and write logs into the
workflow run directory.

### Decision: `morpheus tool build` auto-creates a single-step workflow

To keep the CLI ergonomic and coherent:

- `morpheus tool build --tool <name> ...` creates a new workflow run with a
  generated workflow name (for example `tool-<name>`).
- The workflow run contains exactly one step: `<name>.build` (or `<name>.run`
  when applicable).
- The command output includes the workflow run id as the primary identifier.

This makes "tool runs" a special case of workflow runs without needing users
to explicitly declare a workflow.

### Alternatives considered

- Keep both run namespaces and document the difference.
  - Rejected: users still have to choose where to look, and inspection/export
    remains ambiguous.
- Keep tool-owned run directories but add a workflow index file.
  - Rejected for this change: reduces confusion in the CLI but keeps on-disk
    ambiguity and entrenches the dual-run layout.

## Risks / Trade-offs

- [Breaking on-disk layout] -> Provide a migration note and keep Morpheus
  inspection commands as the supported interface for scripts/agents.
- [Tool adapters need refactors] -> Implement the new step contract incrementally
  tool-by-tool, starting with Buildroot and nvirsh.
- [Remote artifact fetching complexity] -> Keep the existing explicit fetch
  behavior, but locate fetched artifacts under the workflow step `artifacts/`.
- [Run id churn] -> Keep a stable workflow run id as the primary identifier and
  record the tool/tool-mode ids as secondary metadata where needed.

## Migration Plan

1. Introduce workflow run record format (`workflow.json` + step manifests).
2. Add a workflow runner that creates a workflow run directory and executes one
   or more steps with consistent logging and JSON output.
3. Rewire `morpheus tool build` to call the workflow runner with a single step.
4. Migrate tool adapters (Buildroot, QEMU, microkit-sdk, libvmm, nvirsh, sel4)
   to emit step records into the workflow run directory and stop writing to
   `<workspace>/tools/<tool>/runs/`.
5. Update `morpheus runs` inspection/export to read workflow runs and render
   step summaries.
6. Document the new layout and deprecate direct reading of tool-owned run
   directories.

## Open Questions

- What is the minimum stable JSON schema for `workflow.json` and `step.json`?
- Should we add a `morpheus workflow run <name>` top-level command now, or keep
  it internal until multi-step workflows are implemented?
- How long do we keep compatibility shims (if any) for old tool-run ids?
