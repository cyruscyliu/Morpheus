## Why

Morpheus needs a local nested-virtualization execution tool that can launch
seL4-oriented setups from explicit kernel and initrd artifacts without folding
remote orchestration or artifact production into the tool itself. The current
reference material is procedural and environment-specific, which is not a
stable contract for users, agents, or later Morpheus-managed execution.

## What Changes

- Add a new repo-local tool, `nvirsh`, for local nested-virtualization target
  preparation, launch, inspection, logging, stop, and cleanup.
- Keep `nvirsh` to one level of subcommands only: `doctor`, `prepare`, `run`,
  `inspect`, `stop`, `logs`, and `clean`.
- Make `nvirsh` local-first and runtime-focused: it consumes resolved artifact
  paths and local target prerequisites, but it does not own remote execution,
  artifact production, or cross-tool dependency resolution.
- Extend Morpheus configuration so `morpheus.yaml` is the single source of
  stable `nvirsh` configuration, including target-specific settings such as the
  `sel4` preparation inputs.
- Extend Morpheus tool orchestration so `morpheus tool run --tool nvirsh`
  resolves tool-to-tool dependencies, including reuse of Buildroot-produced
  kernel and initrd artifacts.
- Define a stable initial `sel4` target contract that validates pinned local
  prerequisites during `nvirsh prepare` and launches from explicit runtime
  artifacts during `nvirsh run`.

## Capabilities

### New Capabilities
- `nvirsh-tool`: Local nested-virtualization target preparation and execution
  from explicit runtime artifacts, with one-level CLI subcommands and stable
  local state/log inspection.

### Modified Capabilities
- `morpheus-app`: Add `nvirsh` tool discovery, configuration loading from
  `morpheus.yaml`, and tool-to-tool dependency resolution for artifact wiring.

## Impact

- Affected code: new `tools/nvirsh/` tool package, Morpheus tool discovery,
  Morpheus config parsing, and Morpheus tool-run orchestration.
- Affected docs: repo README, `morpheus.example.yaml`, `tools/nvirsh/README.md`,
  and relevant skills/documentation for Morpheus-managed tool workflows.
- Affected behavior: Morpheus becomes responsible for resolving producer-to-
  consumer artifact dependencies for `nvirsh`, while `nvirsh` remains a local
  executor with no remote semantics.
