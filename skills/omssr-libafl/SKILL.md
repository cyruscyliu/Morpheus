---
name: libafl
description: Run Morpheus-managed LibAFL fetch, patch, build, inspect, and
  harness execution workflows. Use when the user wants to provision a LibAFL
  source tree or launch the nested QEMU harness through Morpheus.
license: MIT
compatibility: Designed for Codex CLI (or similar products)
---

# libafl Skill

Use this skill when you need to work with the `libafl` tool.

## Purpose

`libafl` is a script-backed Morpheus tool for managed LibAFL fetch, patch,
build, inspect, and harness execution.
`tool.json` is the contract.
`scripts/` own fetch, patch, build, exec, and inspect behavior.
The default implementation is the nested QEMU harness (`qemu_nesting` +
`libafl_nesting` overlay under `patches/overlay/`).
Morpheus owns managed path resolution, workflow state, artifacts, and logs.

## Config Schema

Treat `tools.libafl` in Morpheus config as the stable config surface.
The descriptor accepts these field families:

- source selection: `source`, `seed-dir`, `build-version`, `git-url`
- patching: `patch-dir` (default overlay:
  `tools/libafl/patches/overlay`)
- build reuse: `reuse-build-dir`, `build-dir-key`
- build passthrough: `cargo-arg`
- runtime control: `run-dir`, `harness-arg`, `detach`, `run-seconds`
- optional overrides (rarely needed): `patch-script`, `build-script`,
  `inspect-script`, `harness-script`
- artifact publication: `artifacts`

## `tool.json`

`tools/libafl/tool.json` is the Morpheus integration contract.

- `cli-contract` is `fetch,patch,build,exec,inspect`
- `config.fields` defines accepted names and aliases
- `managed` defines managed source, build, install, run, and artifact paths
- `commands.*.script` tells Morpheus which shell step to run
- `commands.*.result` defines summaries, artifacts, and stable details

## How The Tool Works

- `fetch` provisions the managed LibAFL source tree
- `patch` overlays `patches/overlay` (`libafl_nesting` + `qemu_nesting`)
- `build` builds `qemu_nesting`, `libafl_nesting_stub`, and the QEMU bridge
- `exec` runs the nested-QEMU host harness (arguments via `harness-arg`)
- `inspect` reports build metadata and artifact locations

Project-specific seeds (for example oracle inputs) may live outside the tool
tree (workspace or workflow args). Keep them out of `tools/libafl` unless they
are truly tool-owned fixtures.

## Notes

- Prefer the default scripts under `tools/libafl/scripts/`.
- `scripts/qemu_nesting/` is a compatibility shim to the same defaults.
- Do not point `patch-dir` / `*-script` at
  `MORPHEUS_DATA_ROOT/workspaces/...` for nesting; that content is in-repo.
