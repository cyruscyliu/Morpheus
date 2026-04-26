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
It validates target prerequisites, records local prepared state, launches from
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
nvirsh prepare
nvirsh run
nvirsh inspect
nvirsh stop
nvirsh logs
nvirsh clean
nvirsh help
```

## Initial `sel4` Contract

The initial target is `sel4`.

- `prepare` validates pinned local prerequisites.
- `run` consumes explicit `--kernel` and `--initrd` paths.
- `inspect`, `logs`, `stop`, and `clean` operate only on local state.

Expected local prerequisites:

- `--qemu`
- `--microkit-sdk`
- `--toolchain`
- `--libvmm-dir`
- `--sel4-dir`

Expected pinned compatibility:

- Microkit version is user-configured.
- `sel4` version defaults to `15.0.0`.

## Example Flow

```bash
./bin/morpheus workspace create

./bin/morpheus --json tool build --tool nvirsh
```

To attach to the VM console (interactive), omit `--json` and pass `--attach` to
Morpheus:

```bash
./bin/morpheus tool build --tool nvirsh --attach
```

## Boundary Rules

- Keep `nvirsh` local-only.
- Keep stable config in `morpheus.yaml` when Morpheus is involved.
- Pass explicit runtime artifact paths to `nvirsh`.
- Prefer managed Morpheus tool dependencies for `qemu`, `microkit-sdk`, and
  `sel4` when those artifacts are already registered.
- Prefer Morpheus `tool` subcommands when the workflow depends on other tools.
