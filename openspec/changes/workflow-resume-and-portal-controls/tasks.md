## 1. Workflow Reuse Core

- [x] 1.1 Extend workflow and step manifests with reuse metadata and resume history
- [x] 1.2 Add step fingerprint generation from step identity, resolved inputs, and config context
- [x] 1.3 Add reuse validation based on successful status, artifact existence, and fingerprint match

## 2. Workflow Commands

- [x] 2.1 Implement `workflow resume --id <run-id>` using in-place successful-prefix reuse
- [x] 2.2 Implement `workflow run --name <workflow> --from-step <step-id>` with prior-step reuse validation
- [x] 2.3 Add workflow command tests for resume, from-step, and reuse invalidation cases

## 3. Runs Viewer Controls

- [x] 3.1 Extend the runs-viewer API/model so the selected workflow exposes resumable actions
- [x] 3.2 Add `Resume` and `Rerun From Step` buttons to the workflow detail surface
- [x] 3.3 Add viewer tests for action availability and step-targeted rerun behavior
