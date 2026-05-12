---
name: libafl
description: Inspect, fetch, patch, and build the managed LibAFL workspace for `libafl_nesting` and patched `qemu-libafl-bridge` artifacts.
license: MIT
compatibility: Designed for Codex CLI (or similar products)
---

# libafl Skill

Use this skill when you need to work with the `libafl` tool.

## Purpose

`libafl` is a script-backed Morpheus tool for provisioning a managed LibAFL
source tree, patching in `libafl_nesting`, and building the guest stub plus
patched `qemu-libafl-bridge` coverage backend artifacts.

`tool.json` is the contract.
`scripts/` own fetch, patch, build, and inspect behavior.
Morpheus owns managed path resolution, artifacts, logging, and workflow
execution.

## Config Schema

Treat `tools.libafl` in Morpheus config as the stable config surface.
The descriptor accepts these field families:

- source selection: `source`, `seed-dir`, `build-version`, `git-url`
- patching: `patch-dir`
- build reuse: `reuse-build-dir`, `build-dir-key`
- build passthrough: `cargo-arg`
- artifact publication: `artifacts`

Keep durable defaults in shared config and use workflow args only when the
build needs to vary.

## `tool.json`

`tools/libafl/tool.json` is the Morpheus integration contract.

- `cli-contract` is `fetch,patch,build,inspect,install-dependencies`
- `config.fields` defines accepted flags and aliases
- `managed.local.sourceTemplate`, `buildDirTemplate`, and `installDirTemplate`
  define managed paths
- `managed.artifacts` defines stable outputs such as `source-dir`,
  `crate-dir`, `qemu-bridge-dir`, `qemu-bridge-lib`, and
  `guest-stub-binary`
- `commands.*.script` tells Morpheus which shell step to run
- `commands.*.result` defines summaries, artifacts, and stable details

Important descriptor fields:

- `config.fields.build-version`, `git-url`:
  upstream checkout selection.
- `config.fields.patch-dir`:
  overlay source for `libafl_nesting`.
- `config.fields.cargo-arg`:
  additional cargo build flags.
- `managed.artifacts.qemu-bridge-lib`:
  installed patched QEMU bridge shared library.
- `managed.artifacts.guest-stub-binary`:
  installed `libafl_nesting_stub` binary.

## How The Tool Works

`libafl` provisions a LibAFL checkout, overlays the `libafl_nesting` crate into
that checkout, and builds the coverage-only `qemu-libafl-bridge` backend plus
the guest stub artifact.

- `fetch` clones or seeds the LibAFL source tree
- `patch` copies the `libafl_nesting` overlay into the managed checkout and
  updates the workspace manifest
- `build` compiles `libafl_nesting_stub` with the `qemu-bridge-aarch64`
  feature, which in turn builds the patched `qemu-libafl-bridge` backend
- `inspect` reports managed source and built artifact locations
- `install-dependencies` installs the host packages needed to fetch and build
  LibAFL

This tool has no runtime `exec` phase.
It only produces build artifacts for later runtime integration.

## JSON Contract

Prefer `--json` for automation.
Treat the stdout payload as the stable machine-readable result and stderr as
progress or diagnostics.

## Workflow

Use the root `libafl-build` workflow or an imported project workflow to run the
managed fetch, patch, and build sequence.

## Feature List

- managed LibAFL checkout provisioning
- managed `libafl_nesting` overlay application
- guest stub artifact build
- patched `qemu-libafl-bridge` shared-library build
- stable artifact publication for later runtime integration

## Potential To-Do List

- add explicit artifact checks for the patched QEMU bridge outputs
- document how later `nvirsh` profiles should consume the guest stub artifact
- add a smoke workflow once the runtime integration lands
