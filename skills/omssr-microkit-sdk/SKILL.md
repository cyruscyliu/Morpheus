---
name: microkit-sdk
description: Inspect, build, and register Microkit SDK directories as managed
  artifacts for Morpheus-managed dependencies. Use when the user wants
  Microkit SDK metadata, workspace-managed SDK paths, or Morpheus-managed SDK
  registration.
license: MIT
compatibility: Designed for Codex CLI (or similar products)
---

# microkit-sdk Skill

Use this skill when you need to work with the `microkit-sdk` tool.

## Purpose

`microkit-sdk` is now migrating to a script-backed Morpheus tool model.
`tool.json` is the contract.
`scripts/` own fetch, patch, build, inspect, and logs behavior.

## Config Schema

Treat `tools.microkit-sdk` in Morpheus config as the stable config surface.
The descriptor accepts these field families:

- SDK selection: `path`, `build-version`, `archive-url`,
  `microkit-archive-url`, `microkit-dir`
- patching: `patch-dir`
- SDK build knobs: `boards`, `configs`
- toolchain selection: `toolchain-dir`, `toolchain-version`,
  `toolchain-archive-url`, `toolchain-prefix-aarch64`
- Rust support: `rust-version`
- build reuse: `reuse-build-dir`, `build-dir-key`
- artifact publication: `artifacts`

Use shared config for stable SDK defaults and workflow overrides for
version-specific runs.

## `tool.json`

`tools/microkit-sdk/tool.json` is the Morpheus integration contract.

- `cli-contract` is `fetch,patch,build,inspect,logs`
- `config.fields` defines accepted config names and aliases
- `managed` defines downloads, install, dependency, and artifact path
  templates
- `commands.*.script` tells Morpheus which shell step to run
- `commands.*.result` defines summaries, artifacts, and stable details

This descriptor is the source of truth for how Morpheus resolves the SDK
install tree and the companion toolchain artifact.

Important descriptor fields:

- `config.fields.microkit-archive-url`, `build-version`:
  source selection for the SDK tree.
- `config.fields.sel4`:
  patched seL4 source input consumed by `build`.
- `config.fields.toolchain-dir`, `toolchain-version`,
  `toolchain-archive-url`, `toolchain-prefix-aarch64`:
  toolchain selection.
- `config.fields.boards`, `configs`:
  SDK output shape.
- `managed.local.artifacts.sdk-dir`, `source-dir`, `toolchain-dir`:
  the published artifact set.

## How The Tool Works

`microkit-sdk` can inspect an existing SDK directory or produce one as a
managed artifact.

- `fetch` downloads or materializes the requested SDK inputs
- `patch` applies the configured patch set
- `build` assembles the SDK install tree and records published artifacts
- `inspect` re-reads version and artifact metadata
- `logs` re-reads prior execution logs

The main published outputs are the SDK directory itself and the matching
toolchain directory that downstream tools consume.
When board/config outputs are required, `build` may need an explicit `sel4`
source input plus selected `boards` and `configs` so the SDK install tree
contains `board/<board>/<config>/...` artifacts for downstream tools.
The intended input is patched seL4 source, not a separate prebuilt seL4
artifact.

## JSON Contract

Prefer `--json` for automation.
Treat the emitted JSON payload as the stable machine-readable contract for SDK
artifacts and version metadata.

## Smoke Test

Use the workflow smoke command for a fast managed validation pass:

```bash
node apps/morpheus/dist/cli.js --json --config morpheus.yaml workflow run --name microkit-sdk-build-ci
```

This validates the real managed Microkit SDK workflow path.

## Feature List

- SDK directory inspection and version metadata capture
- managed SDK fetch, patch, and build flow
- published SDK and toolchain artifacts for downstream tools
- configurable board, config, and toolchain selection

## Potential To-Do List

- document more board and config selection patterns
- expand guidance for toolchain reuse and compatibility management
- add more examples of downstream consumption from managed SDK artifacts
