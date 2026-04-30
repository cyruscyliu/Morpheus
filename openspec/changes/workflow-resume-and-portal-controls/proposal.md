## Why

Long workflows are expensive to rerun when only the last step fails. Morpheus
already records per-step status, artifacts, and manifests, but users cannot
reuse those successful steps in place, so a 12-step workflow that fails at step
12 forces all prior work to repeat.

This needs to change now because workflow runs have become the primary managed
execution surface. Resume and selective rerun should be first-class operations,
and the runs viewer should expose them directly where users inspect failures.

## What Changes

- Add workflow resume support that reuses successful prior steps in the same
  workflow run instead of creating a new run.
- Add workflow `from-step` support so users can explicitly rerun from a named
  step while reusing earlier validated steps.
- Validate step reuse with step identity, artifact existence, and
  config/input fingerprints before a step is considered reusable.
- Record reuse/resume metadata in workflow and step manifests so the execution
  history remains inspectable.
- Add resume and rerun-from-step controls to the runs viewer portal for
  workflow runs.

## Capabilities

### New Capabilities
- `workflow-step-reuse`: Defines in-place workflow resume and selective rerun
  semantics, including reuse validation and manifest metadata.

### Modified Capabilities
- `morpheus-workflow-runs`: Workflow runs gain resume/from-step behavior and
  persist reuse metadata for steps.
- `morpheus-runs-viewer`: The portal exposes workflow resume and rerun controls
  for the selected workflow run.

## Impact

- Affected code:
  `apps/morpheus/src/commands/workflow.ts`,
  `apps/morpheus/src/core/workflow-runs.ts`,
  runs-viewer API and UI code, and workflow-related tests.
- Affected APIs:
  Morpheus workflow command surface and runs-viewer workflow actions.
- Affected systems:
  workflow manifests, step manifests, workflow artifact reuse, and the local
  runs viewer portal.
