---
name: nvirsh
description: Prepare, launch, inspect, stop, and remove
  nested-virtualization targets from explicit runtime artifacts through
  Morpheus-managed workflows.
license: MIT
compatibility: Designed for Codex CLI (or similar products)
---

# nvirsh Skill

Use this skill when you need to work with the `nvirsh` tool.

## Purpose

`nvirsh` is a Morpheus-internal lifecycle CLI.
It validates target prerequisites, records stable run state, launches from
explicit runtime artifacts, and exposes stable inspect, logs, stop, and
remove commands.
Use Morpheus around it when workflow orchestration or dependency resolution
matters.

## Config Schema

Treat `tools.nvirsh` in Morpheus config as the stable config surface.
The descriptor accepts these field families:

- target identity: `target`, `name`, `board`
- recorded state paths: `path`, `state-dir`
- dependency paths: `qemu`, `microkit-sdk`, `toolchain`, `libvmm-dir`
- runtime inputs: `runtime-contract`, `runtime-action`, `kernel`, `initrd`
- compatibility knobs: `microkit-version`, `microkit-config`
- runtime passthrough: `qemu-arg`, `attach`
- dependency policy: `dependencies`

The initial target contract is `sel4`.
Keep stable defaults in config and let Morpheus resolve concrete artifact
paths for each workflow run.

## `tool.json`

`tools/nvirsh/tool.json` is the Morpheus integration contract.

- `cli-contract` is `exec,inspect,logs`
- `runGuard` prevents overlapping runs for the same target/runtime pair
- `config.fields` defines accepted names and aliases
- `inputs.run.dependencies` maps managed artifacts such as `qemu`,
  `microkit-sdk`, `toolchain-bin-dir`, `libvmm-dir`, `kernel`, and `initrd`
  into runtime flags
- `inputs.run.config` maps workflow config onto runtime-provider flags

Read the descriptor when you need to understand how Morpheus turns published
artifacts into one concrete runtime invocation.

## How The Tool Works

`nvirsh` is the execution endpoint for prepared runtime artifacts.

- `exec` validates prerequisites, prepares run state, and launches the target
- `inspect` re-reads recorded runtime metadata
- `logs` re-reads recorded runtime output
- `stop` and `remove` are part of the lifecycle handled around those records

`nvirsh` expects explicit resolved artifact paths rather than provisioning its
own dependencies.
Prefer managed Morpheus dependencies for `qemu`, `microkit-sdk`, `sel4`, and
`libvmm` when those artifacts already exist.

## JSON Contract

Prefer `--json` for automation.
Treat the emitted JSON payload as the stable machine-readable record of
runtime state, inspection output, and logs metadata.

## Smoke Test

Use the package smoke script for a fast CLI validation pass:

```bash
pnpm --filter @morpheus/nvirsh smoke
```

The smoke test validates the managed runtime CLI path without requiring a full
target workflow.

## Feature List

- prepared runtime execution from explicit artifact inputs
- recorded runtime state, metadata, and log inspection
- managed dependency resolution for runtime prerequisites
- lifecycle support around start, inspect, logs, stop, and remove flows

## Potential To-Do List

- expand documented target coverage beyond the initial `sel4` contract
- document more runtime-provider patterns and compatibility expectations
- add clearer examples for multi-artifact workflow integration
