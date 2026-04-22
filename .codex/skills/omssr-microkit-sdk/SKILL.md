---
name: microkit-sdk
description: Inspect, build, and register local Microkit SDK directories as managed artifacts for Morpheus-managed dependencies. Use when the user wants Microkit SDK metadata, workspace-local SDK paths, or Morpheus-managed SDK registration.
license: MIT
compatibility: Designed for Codex CLI (or similar products)
---

# microkit-sdk Skill

Use this skill when you need to work with the repo-local `microkit-sdk` tool.

## Purpose

`microkit-sdk` is a minimal local CLI for SDK directory inspection and managed
builds. It validates the SDK directory, detects local version metadata when
available, and exposes a stable artifact record that Morpheus can pass to
dependent tools such as `nvirsh`.

## First Steps

1. Run `pnpm --filter @morpheus/microkit-sdk build` if the tool has not been built.
2. Run `node tools/microkit-sdk/dist/index.js --help` to inspect the current surface.
3. Prefer `--json` when the output will be consumed programmatically.

## Command Surface

The public command tree is:

```text
microkit-sdk inspect
microkit-sdk build
microkit-sdk version
microkit-sdk help
```

## Managed Boundary

- `microkit-sdk` owns local SDK inspection.
- `microkit-sdk` owns archive fetch and unpack for managed SDK directories.
- `morpheus tool build --tool microkit-sdk --mode local` behaves like a build
  workflow when any build inputs are configured (for example
  `tools.microkit-sdk.microkit-version` or `tools.microkit-sdk.microkit-dir`):
  - ensures the Arm GNU aarch64-none-elf toolchain exists (records `toolchain-dir`)
  - ensures the seL4 dependency exists and applies `tools.sel4.patch-dir`
  - builds the SDK when missing, otherwise reuses it
- If only `tools.microkit-sdk.path` is configured (and no build inputs), Morpheus
  records that directory as the managed `sdk-dir` artifact.
- Source builds may also require an aarch64 bare-metal toolchain; Morpheus can
  fetch and register this as an additional `toolchain-dir` artifact.
- `nvirsh` should consume the resolved SDK artifact, not provision it.
