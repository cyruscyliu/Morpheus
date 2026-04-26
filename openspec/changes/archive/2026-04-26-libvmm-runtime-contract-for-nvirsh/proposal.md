## Why

`nvirsh` currently knows how to launch libvmm's `virtio` example by directly
running `make qemu` inside the libvmm checkout. That makes `nvirsh` own a
libvmm-specific runtime path, which blurs tool boundaries and leaves
`morpheus.yaml` without a clear contract for how build-time artifacts become a
runtime provider.

## What Changes

- Add a first-class libvmm runtime contract that describes supported runtime
  actions, required inputs, and runtime outputs for a prepared libvmm example.
- Add a `libvmm run` command surface that owns the `make qemu` launch path for
  the `virtio` example instead of leaving that flow embedded in `nvirsh`.
- Split `nvirsh` into explicit build-time and runtime roles:
  `nvirsh build` prepares and resolves all dependencies, while `nvirsh run`
  invokes the configured runtime provider.
- Extend `morpheus.yaml` so `tools.nvirsh` declares a runtime provider contract
  separately from artifact dependencies.
- Update Morpheus orchestration so managed `nvirsh` build behavior resolves
  producer tools, while managed `nvirsh` run behavior consumes the prepared
  runtime contract.

## Capabilities

### New Capabilities
- `libvmm-runtime-contract`: Stable libvmm runtime provider metadata and run
  invocation semantics for libvmm-owned example launch actions.
- `nvirsh-build-run-split`: Explicit `nvirsh build` and `nvirsh run` semantics
  with a prepared state manifest and runtime-provider invocation.

### Modified Capabilities
- `morpheus-app`: Morpheus tool configuration and orchestration gain an
  explicit runtime-provider model for `nvirsh` and libvmm-managed runtime
  execution.
- `morpheus-managed-runs`: Managed tool execution distinguishes producer
  builds from runtime launches and records nested provider runs through stable
  manifests.

## Impact

- Affected code: `tools/libvmm/`, `tools/nvirsh/`, `apps/morpheus/src/`, and
  related config parsing, workflow orchestration, and run recording.
- Affected APIs: `libvmm` CLI surface, `nvirsh` CLI surface, and
  `morpheus.yaml` fields for `tools.libvmm` and `tools.nvirsh`.
- Affected docs: `tools/libvmm/README.md`, `tools/nvirsh/README.md`, Morpheus
  usage docs, and relevant skills.
