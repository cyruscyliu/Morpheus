---
name: sel4
description: Inspect, build, and register local seL4 source directories as managed artifacts for Morpheus-managed dependencies. Use when the user wants seL4 source metadata, workspace-local source paths, or Morpheus-managed seL4 registration.
license: MIT
compatibility: Designed for Codex CLI (or similar products)
---

# sel4 Skill

Use this skill when you need to work with the repo-local `sel4` tool.

## Purpose

`sel4` is a minimal local CLI for source directory inspection, fetch, and
managed builds. It validates the source directory, detects local version
metadata when available, and exposes a stable artifact record that Morpheus can
pass to dependent tools such as `nvirsh`.

## First Steps

1. Run `pnpm --filter @morpheus/sel4 build` if the tool has not been built.
2. Run `node tools/sel4/dist/index.js --help` to inspect the current surface.
3. Prefer `--json` when the output will be consumed programmatically.

## Command Surface

The public command tree is:

```text
sel4 inspect
sel4 fetch
sel4 patch
sel4 build
sel4 logs
sel4 version
sel4 help
```

## Managed Boundary

- `sel4` owns local source inspection.
- `sel4` owns archive fetch for managed source directories.
- `sel4` owns explicit patch application for managed source directories.
- Use `build-version` as the common selector when the tool needs to fetch seL4
  source.
- Morpheus owns workspace directory selection and passes those paths to the
  tool CLI.
- Managed execution should start from Morpheus workflows.
- `nvirsh` should consume the resolved source artifact, not provision it.
