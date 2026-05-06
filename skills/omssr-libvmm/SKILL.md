---
name: libvmm
description: Provision libvmm checkouts and build examples as Morpheus-managed artifacts.
license: MIT
compatibility: Designed for Codex CLI (or similar products)
---

# libvmm Skill

Use this skill when you need to work with the `libvmm` tool.

## Purpose

`libvmm` is migrating to a script-backed Morpheus tool model.
`tool.json` is the contract.
`scripts/` own fetch, patch, build, inspect, and logs behavior.

## Config Schema

Treat `tools.libvmm` in Morpheus config as the stable config surface.
The descriptor accepts these field families:

- source selection: `source`, `build-version`, `git-url`
- patching: `patch-dir`
- example selection: `example`, `board`
- dependency paths: `microkit-sdk`, `qemu`, `toolchain-bin-dir`
- runtime inputs: `linux`, `initrd`
- build reuse: `reuse-build-dir`, `build-dir-key`
- build passthrough: `make-arg`
- dependency policy and artifact publication: `dependencies`, `artifacts`

Keep stable defaults in shared config and pass per-run choices through Morpheus
workflow steps.

## `tool.json`

`tools/libvmm/tool.json` is the Morpheus integration contract.

- `cli-contract` is `fetch,patch,build,exec,inspect,logs,stop`
- `runGuard` prevents conflicting runs in one workspace
- `config.fields` defines accepted flags and aliases
- `inputs` maps managed dependencies such as `microkit-sdk` and `qemu` onto
  tool flags for `build` and `run`
- `managed.artifacts` defines stable artifact names such as `libvmm-dir`,
  `runtime-contract`, `example-dir`, and `example-build-dir`
- `commands.*.script` tells Morpheus which shell step to run
- `commands.*.result` defines summaries, artifacts, and stable details

Read this descriptor first when you need to understand how Morpheus wires
dependencies into libvmm.

## How The Tool Works

`libvmm` provisions a checkout, optionally patches it, builds a selected
example, and can execute the resulting runtime flow when Morpheus asks for
`exec`.

- `fetch` clones and updates the libvmm source tree
- `patch` applies the configured patch set
- `build` compiles the selected example against the resolved SDK and toolchain
- `exec` runs with the prepared runtime inputs
- `stop` terminates a recorded runtime run from its managed run directory
- `inspect` and `logs` re-read prior state instead of repeating work

## JSON Contract

Prefer `--json` for automation.
Treat the stdout payload as the stable machine-readable result and stderr as
progress or diagnostic output.

## Smoke Test

Use the workflow smoke command for a fast managed validation pass:

```bash
node apps/morpheus/dist/cli.js --json --config morpheus.yaml workflow run --name libvmm-build
```

This validates the real managed libvmm workflow path.

## Feature List

- libvmm checkout provisioning and update
- patch application against managed checkouts
- example build execution against resolved SDK and toolchain inputs
- runtime execution with published runtime-contract artifacts
- managed dependency wiring for `microkit-sdk` and `qemu`

## Potential To-Do List

- expand example coverage beyond the current common paths
- document more runtime-contract usage patterns
- add sharper guidance for patch-set evolution and rebuild expectations

## Notes

- The `virtio` example expects `sdfgen` 0.26.*. This repo ships an upstreamable
  patch in the managed workspace patch tree, for example
  `projects/<project>/workspace/tools/libvmm/patches/...`, that adds
  `requirements.txt` to the libvmm checkout.
- Provisioning runs git non-interactively (so missing credentials should fail
  fast rather than hang).
