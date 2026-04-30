## Context

Morpheus workflow runs are currently linear and restart from step 1 whenever a
workflow is rerun. That is expensive for long workflows whose successful prefix
already produced stable manifests and artifacts. The runs viewer already treats
workflow runs as the primary operational object, but it does not expose any
resume or rerun control surface.

The current workflow model already stores enough metadata to support reuse:

- `workflow.json`
- `step.json`
- `tool-result.json`
- per-step artifact directories

The missing piece is an explicit reuse contract that validates whether a prior
step is still safe to reuse and a user-facing way to trigger that behavior.

## Goals / Non-Goals

**Goals:**
- Add in-place workflow resume for an existing run id
- Add rerun-from-step for an existing workflow run
- Reuse prior successful steps only when they still validate
- Validate reuse using step identity, artifact existence, and
  config/input fingerprints
- Record resume/reuse metadata in workflow and step manifests
- Add workflow resume / rerun controls to the runs viewer portal

**Non-Goals:**
- This change does not create a new derived workflow run for resume
- This change does not support arbitrary DAG-style partial reuse
- This change does not attempt speculative reuse of failed or partial steps
- This change does not redesign remote artifact materialization semantics

## Decisions

### Decision: Resume mutates the existing workflow run
The first implementation should resume in place rather than cloning a new run.
That keeps the user model simple and avoids introducing lineage semantics
before reuse itself is stable.

Alternatives considered:
- Create a new workflow run that references reused prior steps
  Rejected for the first version because it adds lineage complexity and viewer
  design work before the core reuse model is proven.

### Decision: Reuse only the successful prefix
The first version should reuse the longest valid successful prefix and rerun
from the first invalid, failed, or requested step onward.

Alternatives considered:
- Arbitrary per-step reuse
  Rejected because current workflows are ordered step lists and prefix reuse
  gives most of the user value with much less complexity.

### Decision: Add two control surfaces
The workflow lifecycle should support:

- `workflow resume --id <run-id>`
- `workflow run --name <workflow> --from-step <step-id>`

`resume` resumes from the first non-reusable step.
`from-step` forces rerun from a named step, while requiring all earlier steps to
validate as reusable.

Alternatives considered:
- Only `retry`
  Rejected because `from-step` is valuable for targeted debugging.
- Only `from-step`
  Rejected because `resume` is the more ergonomic default for failed long runs.

### Decision: Reuse requires explicit validation
A step is reusable only if:

- the step id matches
- the prior step status is `success`
- required artifacts still exist
- the step fingerprint matches the current invocation context

The fingerprint should include:
- tool name
- tool command
- resolved args
- resolved dependency inputs
- relevant Morpheus config/tool defaults
- execution mode and placement-sensitive paths

Alternatives considered:
- Artifact-existence-only reuse
  Rejected because config or dependency changes would silently reuse stale work.

### Decision: Persist resume metadata in manifests
The workflow manifest should gain fields such as:
- `resumeCount`
- `resumeHistory`
- `resumedFromStep`

Step manifests should gain fields such as:
- `fingerprint`
- `resolvedInputs`
- `reuseState` (`original`, `reused`, `rerun`)

Alternatives considered:
- Keep reuse state ephemeral
  Rejected because the runs viewer and later debugging need persisted reuse
  provenance.

### Decision: Expose controls in the runs viewer
The runs viewer should expose buttons for the selected workflow run:
- `Resume`
- `Rerun From Step`

These actions should call workflow APIs rather than inventing browser-local
execution logic.

Alternatives considered:
- CLI only
  Rejected because the runs viewer is already the operational inspection surface
  where users notice the failure.

## Risks / Trade-offs

- [Risk] In-place resume can blur the original failure history.
  → Mitigation: record explicit resume metadata and per-step reuse state.

- [Risk] Fingerprint logic may be too narrow or too broad.
  → Mitigation: start with deterministic resolved inputs/config and refine if
  false reuse or false invalidation appears.

- [Risk] `from-step` can be misused when earlier steps are not truly reusable.
  → Mitigation: validate all earlier steps and fail early if any are not
  reusable.

- [Risk] Viewer controls can drift from CLI semantics.
  → Mitigation: make the viewer invoke the same workflow action path as the CLI.

## Migration Plan

1. Extend workflow and step manifests with reuse metadata.
2. Add fingerprint generation for workflow steps.
3. Implement `workflow resume --id`.
4. Implement `workflow run --from-step`.
5. Reuse validated successful prefix and rerun from the first invalid step.
6. Add runs-viewer buttons and API integration.
7. Update workflow-related tests and viewer tests.

Rollback strategy:
- resume/from-step are additive command and viewer features; rollback can remove
  the new command branches and ignore the new manifest fields.

## Open Questions

- Should `workflow resume` also accept `--from-step` for forced partial rerun in
  the same run id?
- Which exact step fields should be included in the first fingerprint version?
- Should reused steps keep their original timestamps or record an additional
  `reusedAt` field?
