## 1. Define canonical workflow event logging

- [x] 1.1 Introduce the canonical `events.jsonl` file contract for workflow runs and step-scoped event emission helpers in Morpheus
- [x] 1.2 Standardize the shared event envelope and initial event taxonomy for workflow lifecycle, step lifecycle, runtime, artifact, warning/error, tool phase, and console output
- [x] 1.3 Add workflow command tests that verify canonical event records are written for run creation, step execution, and workflow completion or failure

## 2. Route execution output into the regulated event stream

- [x] 2.1 Update workflow execution so raw stdout and stderr are captured as regulated `console.stdout` and `console.stderr` events while preserving compatibility snapshots
- [x] 2.2 Emit regulated runtime and artifact events for detached or runtime-backed steps, including liveness transitions and artifact production or consumption
- [x] 2.3 Integrate tool-owned phase or warning events where available and add focused tests for representative tools such as `qemu`, `nvirsh`, and build-oriented steps

## 3. Preserve and clarify derived state

- [x] 3.1 Keep `workflow.json`, `step.json`, and `tool-result.json` as derived current-state views with clearly separated responsibilities from the canonical event log
- [x] 3.2 Reduce or retire ad hoc JSONL side streams such as `progress.jsonl` and `relations.jsonl` once equivalent canonical events are available
- [x] 3.3 Add migration-safe compatibility behavior for older runs that still rely on legacy text logs or side-stream files

## 4. Move the runs viewer to event-first inspection

- [x] 4.1 Extend the runs viewer server model so workflow status, step status, artifact flow, and timeline data can be derived from canonical events
- [x] 4.2 Add viewer-side filtering and inspection behavior that treats the regulated event stream as the primary source for workflow history and console reconstruction
- [x] 4.3 Add runs-viewer tests for event-driven status interpretation, step log reconstruction, and event-backed graph or artifact visualization
