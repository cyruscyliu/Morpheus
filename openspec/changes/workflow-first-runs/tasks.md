## 1. Workflow Run Model

- [x] 1.1 Define workflow run id and step id conventions
- [x] 1.2 Define `workflow.json` schema and write/update helpers
- [x] 1.3 Define `step.json` schema and write/update helpers
- [x] 1.4 Implement workflow run directory creation under `<workspace>/runs/`
- [x] 1.5 Implement step directory creation under a workflow run

## 2. Workflow Runner

- [x] 2.1 Implement a workflow runner that executes one step and records logs
- [x] 2.2 Implement status transitions for workflow runs and steps
- [ ] 2.3 Record resolved inputs/outputs in step manifests
- [x] 2.4 Ensure `--json` output returns workflow-run-first payloads

## 3. CLI Surface Migration

- [x] 3.1 Add `morpheus workflow` command surface (`run`, `inspect`, `logs`)
- [x] 3.2 Rewire `morpheus runs` to inspect/export workflow runs
- [x] 3.3 Update `morpheus tool build` to create a single-step workflow run
- [ ] 3.4 Update `morpheus tool list` to point at workflow-run inspection

## 4. Tool Adapter Migration (Style A)

- [ ] 4.1 Update Buildroot adapter to write step records into workflow runs
- [ ] 4.2 Update remote Buildroot adapter to store fetched artifacts per step
- [ ] 4.3 Update QEMU adapter to write step records into workflow runs
- [ ] 4.4 Update microkit-sdk adapter to write step records into workflow runs
- [ ] 4.5 Update libvmm adapter to write step records into workflow runs
- [ ] 4.6 Update sel4 adapter to write step records into workflow runs
- [ ] 4.7 Update nvirsh adapter to consume step artifacts and write step records

## 5. Deprecations And Cleanup

- [ ] 5.1 Stop creating `<workspace>/tools/<tool>/runs/` for managed execution
- [ ] 5.2 Add a migration note for users/scripts that read tool run directories
- [ ] 5.3 Optional: shim to inspect legacy tool-run ids

## 6. Tests And Documentation

- [ ] 6.1 Add unit tests covering workflow run creation and step manifests
- [x] 6.2 Add e2e test: `tool build --tool <name>` creates one workflow run
- [x] 6.3 Update `apps/morpheus` README for workflow-run-first storage
- [x] 6.4 Update tool READMEs to say workflow runs are the source of truth
