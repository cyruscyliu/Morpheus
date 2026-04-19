## Why

`apps/research-runtime` no longer matches the intended product boundary. The
repo needs a first-class `apps/morpheus` application identity now, even though
workflow execution will be added later, so the app name and current scope
should reflect workspace, artifact, and log management rather than a workflow
runtime.

## What Changes

- Rename `apps/research-runtime` to `apps/morpheus`.
- Reposition the app as the main Morpheus application identity in the repo.
- Narrow the current app scope to orthogonal management concerns such as
  workspace metadata, artifact inspection, and log inspection.
- Remove or defer workflow-runtime-first language, commands, and assumptions
  that do not belong in the current Morpheus scope.
- Preserve reusable infrastructure where it still supports the Morpheus app
  boundary, especially filesystem-backed metadata, local inspection patterns,
  and machine-readable command output.
- **BREAKING** Rename the app package, paths, docs, and command references that
  still use `research-runtime`.

## Capabilities

### New Capabilities
- `morpheus-app`: Provide the Morpheus application as an orthogonal management
  layer for workspace metadata, artifacts, and logs without requiring a
  workflow runtime model in the current phase.

### Modified Capabilities
- None.

## Impact

- `apps/research-runtime/` will be renamed and reshaped as `apps/morpheus/`.
- Package metadata, app docs, command help, and repo references will change to
  use the Morpheus name.
- Workflow-runtime-specific surfaces may be removed, deferred, or reduced until
  that capability is intentionally reintroduced.
