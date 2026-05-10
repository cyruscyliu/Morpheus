---
name: pkvm-aarch64
description: Provision pkvm-aarch64 checkouts and build or run pKVM targets as Morpheus-managed artifacts.
license: MIT
compatibility: Designed for Codex CLI (or similar products)
---

# pkvm-aarch64 Skill

Use this skill when you need to work with the `pkvm-aarch64` tool.

## Purpose

`pkvm-aarch64` is a script-backed Morpheus tool.
`tool.json` is the contract.
`scripts/` own fetch, build, exec, inspect, logs, and stop behavior.

## Config Schema

Treat `tools.pkvm-aarch64` in Morpheus config as the stable config surface.
The descriptor accepts these field families:

- source selection: `source`, `seed-dir`, `build-version`, `git-url`
- fetch control: `fetch-submodules`
- build selection: `build-target`, `platform`, `make-arg`
- qemu path: `qemu`
- build reuse: `build-dir-key`
- runtime directory: `run-dir`
- artifact publication: `artifacts`

Use shared config for durable defaults and workflow overrides for per-run
targets or extra make variables.

## `tool.json`

`tools/pkvm-aarch64/tool.json` is the Morpheus integration contract.

- `cli-contract` is `fetch,build,exec,inspect,logs,stop`
- `runGuard` serializes managed runs in one workspace
- `config.fields` defines accepted names and aliases
- `managed.artifacts` defines stable artifact names
- `commands.*.script` tells Morpheus which shell step to run
- `commands.*.result` defines summaries, artifacts, and stable details

Important descriptor fields:

- `config.fields.build-target`:
  chooses the top-level `make` target, defaulting to `all`.
- `config.fields.platform`:
  selects the upstream platform, defaulting to `virt`.
- `config.fields.make-arg`:
  passes extra make variables or targets through to the scripts.
- `config.fields.qemu`:
  lets the workflow wire in a managed QEMU binary for `make run`.
- `managed.local.sourceTemplate`:
  places the checkout under `tools/pkvm-aarch64/src/`.
- `managed.local.execDirTemplate`:
  places runtime state under `runs/pkvm-aarch64/`.

## How The Tool Works

`pkvm-aarch64` provisions a checkout, builds a selected target, and can run
the upstream `make run` path.

- `fetch` clones or reuses the upstream source tree
- `build` runs `make PLATFORM=virt <target>` in the managed checkout
- `exec` runs `make PLATFORM=virt run` in the managed checkout
- `exec --detach` is available when the workflow should launch QEMU and return
- `exec --timeout-seconds` is available for attached or detached runtime limits
- fetch applies workspace-safe overrides so image creation works without loop
  devices
- `inspect` and `logs` re-read prior state instead of repeating work
- `stop` terminates a recorded runtime run from its managed run directory

## JSON Contract

Prefer `--json` for automation.
Treat stdout as the stable machine-readable result.
