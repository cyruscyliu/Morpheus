## 1. Tool Skeleton

- [x] 1.1 Create `tools/nvirsh/` with `tool.json`, executable entrypoint, and README
- [x] 1.2 Define the flat `nvirsh` command surface: `doctor`, `prepare`, `run`, `inspect`, `stop`, `logs`, and `clean`
- [x] 1.3 Add repo-local verification/smoke coverage for direct `nvirsh` CLI discovery and help output

## 2. Morpheus Integration

- [x] 2.1 Extend Morpheus tool discovery and verification so `nvirsh` is a first-class repo-local tool
- [x] 2.2 Extend Morpheus config parsing to load stable `tools.nvirsh` settings from `morpheus.yaml`
- [x] 2.3 Define and implement Morpheus-side dependency resolution for `nvirsh` runtime artifacts, including Buildroot-provided kernel and initrd inputs
- [x] 2.4 Wire `morpheus tool run --tool nvirsh` to invoke `nvirsh` with resolved concrete local artifact paths

## 3. `sel4` Target Support

- [x] 3.1 Define the initial `sel4` target contract, including pinned prerequisite and version checks derived from Morpheus-managed config
- [x] 3.2 Implement `nvirsh prepare` for the `sel4` target to validate and materialize local prepared state without requiring remote semantics
- [x] 3.3 Implement `nvirsh run` for the `sel4` target to launch from explicit kernel and initrd runtime artifacts
- [x] 3.4 Implement stable local `inspect`, `logs`, `stop`, and `clean` behavior for prepared and running `sel4` instances

## 4. Documentation and Validation

- [x] 4.1 Document `tools.nvirsh` configuration and artifact dependency wiring in `morpheus.example.yaml` and the repo README
- [x] 4.2 Document the `nvirsh` public CLI contract and the initial `sel4` target workflow in `tools/nvirsh/README.md`
- [x] 4.3 Add focused tests or smoke coverage for Morpheus-managed `nvirsh` execution with resolved producer artifacts
