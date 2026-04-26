## 1. Libvmm runtime contract

- [x] 1.1 Add a `runtime-contract` artifact to `libvmm build` output and managed manifests.
- [x] 1.2 Define and validate the runtime contract JSON schema for libvmm example actions.
- [x] 1.3 Add a `libvmm run` command that launches the `qemu` action from the contract.
- [x] 1.4 Return stable JSON run metadata including manifest, log, and runtime outputs.

## 2. Nvirsh build/run split

- [x] 2.1 Add an `nvirsh build` command that resolves artifacts and writes a prepared state manifest.
- [x] 2.2 Refactor `nvirsh run` to consume prepared state and invoke `libvmm run` instead of embedded `make qemu` logic.
- [x] 2.3 Update `nvirsh inspect`, `logs`, and `stop` to use provider runtime metadata from prepared state.
- [x] 2.4 Preserve temporary compatibility for existing direct `libvmm-dir` based state where needed.

## 3. Morpheus config and managed runs

- [x] 3.1 Extend `morpheus.yaml` parsing to support `tools.nvirsh.runtime` separately from `dependencies`.
- [x] 3.2 Distinguish managed `nvirsh` build/stage behavior from managed `nvirsh` runtime launch behavior.
- [x] 3.3 Record nested provider-run metadata in managed `nvirsh` run results and manifests.
- [x] 3.4 Update run inspection and logging paths so staged builds and runtime launches remain separately inspectable.

## 4. Docs and validation

- [x] 4.1 Update `tools/libvmm/README.md` for the runtime contract and `libvmm run` surface.
- [x] 4.2 Update `tools/nvirsh/README.md` for `build` versus `run` semantics and runtime-provider config.
- [x] 4.3 Update Morpheus docs and example config to show `tools.nvirsh.runtime` wiring.
- [x] 4.4 Add or update focused tests for libvmm run, nvirsh staged state, and Morpheus config parsing.
