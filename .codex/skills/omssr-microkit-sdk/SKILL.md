---
name: microkit-sdk
description: Inspect, build, and register local Microkit SDK directories as managed artifacts for Morpheus-managed dependencies. Use when the user wants Microkit SDK metadata, workspace-local SDK paths, or Morpheus-managed SDK registration.
license: MIT
compatibility: Designed for Codex CLI (or similar products)
---

# microkit-sdk Skill

Use this skill when you need to work with the repo-local `microkit-sdk` tool.

## Purpose

`microkit-sdk` is a minimal local CLI for SDK directory inspection, fetch, and
managed builds. It validates the SDK directory, detects local version metadata
when available, and exposes a stable artifact record that Morpheus can pass to
dependent tools such as `nvirsh`.

## First Steps

1. Run `pnpm --filter @morpheus/microkit-sdk build` if the tool has not been built.
2. Run `node tools/microkit-sdk/dist/index.js --help` to inspect the current surface.
3. Prefer `--json` when the output will be consumed programmatically.

## Command Surface

The public command tree is:

```text
microkit-sdk inspect
microkit-sdk fetch
microkit-sdk patch
microkit-sdk build
microkit-sdk logs
microkit-sdk version
microkit-sdk help
```

## Managed Boundary

- `microkit-sdk` owns local SDK inspection.
- `microkit-sdk` owns archive fetch and unpack for managed SDK directories.
- `microkit-sdk` owns explicit patch application for managed SDK directories.
- Use `build-version` as the common selector when the tool needs to fetch the
  SDK source.
- Morpheus owns workspace directory selection and passes those paths to the
  tool CLI.
- Managed execution should start from Morpheus workflows.
- Morpheus owns dependency resolution and workspace policy.
- The tool CLI should receive explicit resolved paths and flags.
