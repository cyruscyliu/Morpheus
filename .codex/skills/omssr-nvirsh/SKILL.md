---
name: nvirsh
description: Prepare, launch, inspect, stop, and clean local nested-virtualization targets from explicit runtime artifacts. Use when the user wants direct nvirsh CLI work or to reason about the local nvirsh boundary.
license: MIT
compatibility: Designed for Codex CLI (or similar products)
---

# nvirsh Skill

Use this skill when you need to work with the repo-local `nvirsh` tool.

## Purpose

`nvirsh` is a local lifecycle CLI.
It validates target prerequisites, records stable local state, launches from
explicit runtime artifacts, and exposes stable local inspect, logs, stop, and
clean commands.

`nvirsh` does not own remote execution or producer-tool artifact resolution.
When those concerns matter, use Morpheus around it.

## First Steps

1. Run `pnpm --filter @morpheus/nvirsh build` if the tool has not been built.
2. Run `node tools/nvirsh/dist/index.js --help` to inspect the current surface.
3. Prefer `--json` for machine-readable output.
4. Reuse `inspect` and `logs` before rerunning a target.
5. Prefer running `nvirsh` through Morpheus so tool dependencies are resolved
   from `morpheus.yaml`.

## Command Surface

The public command tree is:

```text
nvirsh doctor
nvirsh run
nvirsh inspect
nvirsh stop
nvirsh logs
nvirsh clean
nvirsh help
```

## Initial `sel4` Contract

The initial target is `sel4`.

- `run` validates pinned local prerequisites and auto-prepares state.
- `run` consumes explicit `--kernel` and `--initrd` paths.
- `inspect`, `logs`, `stop`, and `clean` operate only on local state.

Expected local prerequisites:

- `--qemu`
- `--microkit-sdk`
- `--toolchain`
- `--libvmm-dir`

Expected pinned compatibility:

- Microkit version is user-configured.
- `sel4` version defaults to `15.0.0`.

## Example Flow

```bash
node tools/nvirsh/dist/index.js run \
  --target sel4 \
  --qemu ./deps/qemu-system-aarch64 \
  --microkit-sdk ./deps/microkit-sdk \
  --toolchain ./deps/arm-gnu-toolchain \
  --libvmm-dir ./deps/libvmm \
  --kernel ./out/Image \
  --initrd ./out/rootfs.cpio.gz \
  --detach \
  --json
```

Without `--state-dir`, the direct CLI defaults to
`<workspace>/tmp/nvirsh/<name>/` when `morpheus.yaml` defines `workspace.root`,
or `./tmp/nvirsh/<name>/` otherwise.

## Boundary Rules

- Keep `nvirsh` local-only.
- Keep stable config in `morpheus.yaml` when Morpheus is involved.
- Pass explicit runtime artifact paths to `nvirsh`.
- Prefer managed Morpheus tool dependencies for `qemu`, `microkit-sdk`, and
  `sel4` when those artifacts are already registered.
- Prefer Morpheus workflows when dependency resolution matters.
