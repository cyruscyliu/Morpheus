---
name: libafl
description: Run Morpheus-managed LibAFL fetch, patch, build, inspect, and
  harness execution workflows. Use when the user wants to provision a LibAFL
  source tree or launch a project-owned LibAFL harness through Morpheus.
license: MIT
compatibility: Designed for Codex CLI (or similar products)
---

# libafl Skill

Use this skill when you need to work with the `libafl` tool.

## Purpose

`libafl` is a script-backed Morpheus tool for managed LibAFL fetch, patch,
build, inspect, and harness execution workflows.
`tool.json` is the contract.
`scripts/` own fetch, patch, build, exec, and inspect behavior.
Morpheus owns managed path resolution, workflow state, artifacts, and logs.

## Config Schema

Treat `tools.libafl` in Morpheus config as the stable config surface.
The descriptor accepts these field families:

- source selection: `source`, `seed-dir`, `build-version`, `git-url`
- patching: `patch-dir`
- build reuse: `reuse-build-dir`, `build-dir-key`
- build passthrough: `cargo-arg`
- runtime control:
  `run-dir`, `harness-script`, `harness-arg`, `detach`, `run-seconds`
- artifact publication: `artifacts`

## `tool.json`

`tools/libafl/tool.json` is the Morpheus integration contract.

- `cli-contract` is `fetch,patch,build,exec,inspect`
- `config.fields` defines accepted names and aliases
- `managed` defines managed source, build, install, run, and artifact paths
- `commands.*.script` tells Morpheus which shell step to run
- `commands.*.result` defines summaries, artifacts, and stable details

Important descriptor fields:

- `managed.local.sourceTemplate`, `buildDirTemplate`, `installDirTemplate`:
  stable managed source and build locations
- `managed.local.execDirTemplate`:
  stable managed run location

## How The Tool Works

- `fetch` provisions the managed LibAFL source tree
- `patch` dispatches to a project-owned patch implementation when configured
- `build` dispatches to a project-owned build implementation when configured
- `exec` dispatches to a harness-specific script selected by config or workflow
  arguments
- `inspect` re-reads managed build metadata or dispatches to a project-owned
  inspect implementation when configured

Harness-specific runtime outputs belong to the selected harness, not to the
generic LibAFL tool contract.

## Smoke Test

## Notes

- HyperArm owns the `qemu_nesting` harness integration. Keep harness-specific
  runtime arguments and behavior in the HyperArm project rather than the
  generic LibAFL tool scripts.
- Project-owned harness integrations should live under a harness-specific
  subdirectory such as
  `projects/<project>/workspace/tools/libafl/scripts/<harness>/`.
