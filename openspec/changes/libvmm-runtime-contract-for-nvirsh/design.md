## Context

`nvirsh` is intended to be a local runtime tool that consumes resolved
artifacts. In the current implementation it still owns libvmm-specific launch
knowledge by entering `examples/virtio` and running `make qemu` directly. That
makes the runtime path implicit, couples `nvirsh` to one libvmm example, and
prevents `morpheus.yaml` from expressing a stable separation between producer
artifacts and runtime providers.

This change crosses three layers:
- `libvmm` needs a runtime-facing contract and command surface.
- `nvirsh` needs separate build-time and runtime responsibilities.
- Morpheus needs config and managed-run semantics that distinguish dependency
  builds from runtime launches.

## Goals / Non-Goals

**Goals:**
- Make `libvmm` the owner of libvmm example runtime actions such as `make qemu`.
- Make `nvirsh build` prepare a runnable state without launching QEMU.
- Make `nvirsh run` invoke a configured runtime provider through a stable
  contract.
- Make `morpheus.yaml` declare runtime-provider wiring separately from artifact
  dependencies.
- Preserve managed-run observability for both producer builds and runtime
  launches.

**Non-Goals:**
- Generalize runtime providers beyond the first libvmm-backed flow.
- Redesign unrelated Morpheus workflow UX.
- Add remote `nvirsh` execution.
- Replace existing artifact contracts for Buildroot, QEMU, Microkit SDK, or
  seL4.

## Decisions

### 1. `libvmm` exposes a runtime contract artifact
`libvmm build` will emit a machine-readable runtime contract artifact in
addition to source/build artifacts. The contract will describe supported
runtime actions, required inputs, optional inputs, and expected outputs.

Rationale:
- The launch surface becomes explicit and versionable.
- `nvirsh` no longer infers libvmm internals from a checkout layout.

Alternative considered:
- Keep passing only `libvmm-dir` and document the implicit `make qemu` flow.
  Rejected because the contract remains hidden in code and README text.

### 2. `libvmm run` owns `make qemu`
A new `libvmm run` command will accept the runtime contract plus resolved
runtime inputs and will execute the provider-owned action such as `qemu`.

Rationale:
- The tool that owns the example Makefile also owns the runtime action.
- Future example-specific launch logic remains inside `libvmm`.

Alternative considered:
- Move `make qemu` into Morpheus. Rejected because Morpheus should orchestrate
  tools, not absorb tool-specific runtime logic.

### 3. `nvirsh` splits into `build` and `run`
`nvirsh build` will resolve dependencies and persist a runnable state manifest.
`nvirsh run` will read that state and invoke the configured runtime provider.

Rationale:
- The lifecycle becomes explicit.
- Users can build once and run multiple times.
- Morpheus can treat runtime launches differently from producer builds.

Alternative considered:
- Keep `nvirsh prepare` as the only staging verb. Rejected because the Morpheus
  surface uses tool build/run semantics already, and `nvirsh build` maps better
  to managed dependency resolution.

### 4. `tools.nvirsh.runtime` is separate from `tools.nvirsh.dependencies`
`dependencies` will remain artifact wiring. A new `runtime` block will identify
which tool artifact provides the runtime contract and which action to invoke.

Rationale:
- Build-time producer relationships and runtime-provider selection are not the
  same concept.
- The YAML becomes declarative and easier to validate.

Alternative considered:
- Encode runtime behavior in dependency names or artifact names. Rejected
  because it overloads artifact wiring with execution semantics.

### 5. Managed runtime launches should be recorded as provider-backed runs
When Morpheus manages `nvirsh run`, it should record the `nvirsh` run as the
user-facing lifecycle record and preserve the nested provider run result from
`libvmm run`.

Rationale:
- `nvirsh stop`, `nvirsh logs`, and `nvirsh inspect` still need one stable local
  state entrypoint.
- Provider run metadata remains available for debugging.

Alternative considered:
- Expose only the nested `libvmm` run id. Rejected because users asked for
  `nvirsh` to remain the runtime tool.

## Risks / Trade-offs

- `[Contract drift]` → Version the runtime contract schema and validate it at
  `libvmm run` and `nvirsh run` boundaries.
- `[Split lifecycle confusion]` → Keep `nvirsh build` and `nvirsh run` docs and
  help output explicit about staging vs launching.
- `[State duplication]` → Treat the `nvirsh` state manifest as the local
  lifecycle entrypoint and store provider-run metadata by reference.
- `[Migration complexity]` → Support the current `libvmm-dir` path temporarily
  while warning that runtime-provider config is the new contract.

## Migration Plan

1. Add `libvmm run` and the `runtime-contract` artifact without removing the
   current `nvirsh` launcher path.
2. Add `tools.nvirsh.runtime` parsing and `nvirsh build` state generation.
3. Switch `nvirsh run` to invoke `libvmm run` through the prepared state.
4. Update Morpheus managed `nvirsh` behavior so build and run are distinct
   operations.
5. Deprecate the direct embedded `make qemu` path in `nvirsh` once the provider
   contract is stable.

## Open Questions

- Should `libvmm run` require a contract file path explicitly, or may it infer
  the contract from `libvmm-dir` when both are present?
- Should `nvirsh build` remain a Morpheus-only concept, or should the direct
  `nvirsh` CLI also expose it as a first-class public command?
- How much of the provider-run manifest should `nvirsh inspect` inline versus
  reference by path?
