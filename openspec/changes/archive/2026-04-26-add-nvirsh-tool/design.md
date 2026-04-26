## Context

Morpheus currently manages repo-local tools such as `buildroot`, `llbic`, and
`llcg`, with configuration loaded from `morpheus.yaml` and tool discovery based
on `tools/<name>/tool.json`. The proposed `nvirsh` tool introduces a new local
execution domain: nested-virtualization target preparation and runtime launch.

The main constraint is boundary discipline. `nvirsh` must remain a local
executor with one-level subcommands only, while Morpheus remains the owner of
stable configuration and tool-to-tool dependency resolution. The initial target
is `sel4`, whose preparation requirements are version-sensitive and include
pinned local prerequisites such as Microkit, seL4, libvmm, and the required ARM
cross-toolchain.

## Goals / Non-Goals

**Goals:**
- Add a repo-local `nvirsh` tool with one-level commands: `doctor`, `prepare`,
  `run`, `inspect`, `stop`, `logs`, and `clean`.
- Keep `nvirsh` local-only and artifact-driven at runtime.
- Make `morpheus.yaml` the single source of stable `nvirsh` configuration.
- Make Morpheus resolve inter-tool dependencies so `nvirsh` can reuse producer
  artifacts such as Buildroot `Image` and `rootfs.cpio.gz` outputs.
- Define a stable initial `sel4` target contract with a preparation phase
  distinct from runtime artifact consumption.

**Non-Goals:**
- Remote execution semantics inside `nvirsh`.
- Making `nvirsh` produce kernel or initrd artifacts itself.
- Supporting arbitrary upstream Microkit developer workflows or dynamically
  tracking upstream documentation changes.
- Designing a multi-level CLI hierarchy for `nvirsh`.

## Decisions

### 1. `nvirsh` remains a thin local executor
`nvirsh` will only own local lifecycle semantics, local state, local logs, and
explicit runtime artifact consumption. It will not resolve producer tools,
remote paths, or managed workspaces.

Alternatives considered:
- Put dependency resolution inside `nvirsh` by accepting Buildroot-specific
  flags or run IDs. Rejected because it couples a consumer tool to producer
  internals.
- Put remote execution semantics inside `nvirsh`. Rejected because Morpheus is
  already the orchestration boundary.

### 2. Stable configuration lives in `morpheus.yaml`
`tools.nvirsh` becomes the configuration home for target defaults, local
prerequisite locations, runtime defaults, and dependency declarations.

Alternatives considered:
- Give `nvirsh` its own config file. Rejected because it creates two sources of
  truth.
- Pass all target details as CLI flags. Rejected because it collapses runtime,
  setup, and target configuration into one unstable interface.

### 3. `prepare` owns target-specific setup; `run` owns explicit artifacts
For the initial `sel4` target, `prepare` validates and materializes the local
prepared state from Morpheus-managed configuration. `run` consumes explicit
resolved runtime artifacts such as kernel and initrd paths.

Alternatives considered:
- Make `run` auto-discover and validate everything. Rejected because it hides
  target-specific failure modes.
- Make `prepare` optional and purely advisory. Rejected because the target has
  pinned prerequisite compatibility that should be enforced before launch.

### 4. Morpheus resolves tool dependencies into concrete paths before invocation
Morpheus will resolve declared `nvirsh` dependencies, such as kernel and initrd
artifacts from `buildroot`, and pass concrete local paths to the `nvirsh`
invocation.

Alternatives considered:
- Duplicate producer output paths in `tools.nvirsh`. Rejected because it leaks
  producer layout into consumer configuration.
- Require users to pass artifact paths manually every time. Rejected as the
  default because Morpheus is intended to own cross-tool wiring.

### 5. `sel4` support is pinned, not dynamically inferred from upstream docs
The initial `sel4` target contract will encode supported local prerequisites and
version expectations, including the seL4 tag expected by the selected Microkit
version. Upstream developer docs remain a reference, not a live executable
contract.

Alternatives considered:
- Script the upstream developer guide directly. Rejected because it is broader
  than the tool contract and will drift.
- Support arbitrary upstream versions by default. Rejected because the target is
  explicitly version-sensitive.

## Risks / Trade-offs

- [Configuration schema growth] → Keep the initial `tools.nvirsh` schema narrow
  and target-focused; add fields only when they affect stable behavior.
- [Boundary erosion between Morpheus and `nvirsh`] → Keep tool dependency
  resolution out of `nvirsh` and validate this in documentation and tests.
- [Pinned `sel4` compatibility becoming stale] → Treat upstream changes as an
  intentional support update, with explicit config/spec changes rather than
  implicit behavior drift.
- [User confusion between `prepare` and `run`] → Document `prepare` as
  target-specific environment validation/materialization and `run` as artifact-
  driven execution.
- [Prepared state mutating user-owned source trees] → Prefer derived local state
  under tool-owned paths instead of in-place source mutations.

## Migration Plan

1. Introduce the `nvirsh` repo-local tool and its README.
2. Extend Morpheus tool discovery and verification to include `nvirsh`.
3. Extend Morpheus config parsing for `tools.nvirsh` and initial dependency
   declarations.
4. Implement Morpheus-side dependency resolution so `morpheus tool run --tool
   nvirsh` can bind producer artifacts.
5. Implement the initial `sel4` `prepare` and `run` flow in `nvirsh`.
6. Add documentation and smoke coverage for the local-first path.

Rollback is straightforward: remove the `nvirsh` tool registration and config
handling, since no existing producer tool contracts need to change to preserve
current behavior.

## Open Questions

- Should `nvirsh run` expose optional explicit overrides for artifact paths when
  Morpheus config already resolves defaults, or should that remain a debug-only
  path?
- How much local prepared state should be retained across `prepare` runs, and
  what should `clean` remove by default?
- Should the initial `sel4` target validate pinned upstream git tags directly,
  or only validate user-provided local paths against recorded metadata?
