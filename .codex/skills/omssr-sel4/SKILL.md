---
name: sel4
description: Inspect, build, and register local seL4 source directories as managed artifacts for Morpheus-managed dependencies. Use when the user wants seL4 source metadata, workspace-local source paths, or Morpheus-managed seL4 registration.
license: MIT
compatibility: Designed for Codex CLI (or similar products)
---

# sel4 Skill

Use this skill when you need to work with the repo-local `sel4` tool.

## Purpose

`sel4` is a minimal local CLI for source directory inspection and managed
builds. It validates the source directory, detects local version metadata when
available, and exposes a stable artifact record that Morpheus can pass to
dependent tools such as `nvirsh`.

## First Steps

1. Run `pnpm --filter @morpheus/sel4 build` if the tool has not been built.
2. Run `node tools/sel4/dist/index.js --help` to inspect the current surface.
3. Prefer `--json` when the output will be consumed programmatically.

## Command Surface

The public command tree is:

```text
sel4 inspect
sel4 build
sel4 version
sel4 help
```

## Managed Boundary

- `sel4` owns local source inspection.
- `sel4` owns archive fetch for managed source directories.
- `sel4` can optionally apply workspace-local patches after fetch when a patch
  directory is provided.
- `morpheus tool build --tool sel4 --mode local` records an existing source tree
  as a managed artifact when `tools.sel4.path` exists.
- Otherwise, `morpheus tool build --tool sel4 --mode local` materializes and
  records the managed source tree inside the workspace.
- `nvirsh` should consume the resolved source artifact, not provision it.
