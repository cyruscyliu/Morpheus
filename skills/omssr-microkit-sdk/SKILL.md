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

`microkit-sdk` is a minimal CLI for SDK directory inspection, fetch, and
managed builds. It validates the SDK directory, detects version metadata when
available, and exposes a stable artifact record that Morpheus can pass to
dependent tools such as `nvirsh`.

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
- `managed.artifacts` publishes stable artifact names such as `sdk-dir` and
  `toolchain-dir`

This descriptor is the source of truth for how Morpheus resolves the SDK
install tree and the companion toolchain artifact.

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

## JSON Contract

Prefer `--json` for automation.
Treat the emitted JSON payload as the stable machine-readable contract for SDK
artifacts and version metadata.

## Smoke Test

Use the package smoke script for a fast CLI validation pass:

```bash
pnpm --filter @morpheus/microkit-sdk smoke
```

The smoke test validates the managed SDK CLI path without requiring a full SDK
build.

## Feature List

- SDK directory inspection and version metadata capture
- managed SDK fetch, patch, and build flow
- published SDK and toolchain artifacts for downstream tools
- configurable board, config, and toolchain selection

## Potential To-Do List

- document more board and config selection patterns
- expand guidance for toolchain reuse and compatibility management
- add more examples of downstream consumption from managed SDK artifacts
