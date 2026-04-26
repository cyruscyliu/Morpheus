---
name: qemu
description: Inspect, fetch, unpack, build, and register QEMU executables as stable artifacts for Morpheus-managed dependencies. Use when the user wants QEMU executable metadata, workspace-local QEMU paths, or Morpheus-managed QEMU builds.
license: MIT
compatibility: Designed for Codex CLI (or similar products)
---

# qemu Skill

Use this skill when you need to work with the repo-local `qemu` tool.

## Purpose

`qemu` is a minimal local CLI for executable inspection and managed builds.
It validates the binary, reads `--version`, and exposes a stable artifact
record that Morpheus can pass to dependent tools such as `nvirsh`.
Morpheus manages execution placement around that contract: today `local` only.
Managed build mode can fetch a QEMU release tarball, unpack it into the
canonical managed source path from `morpheus.yaml`, stage the build copy, and
build/install the executable itself.

## First Steps

1. Run `pnpm --filter @morpheus/qemu build` if the tool has not been built.
2. Run `node tools/qemu/dist/index.js --help` to inspect the current surface.
3. Prefer `--json` when the output will be consumed programmatically.

## Command Surface

The public command tree is:

```text
qemu inspect
qemu build
qemu version
qemu help
```

## Managed Boundary

- `qemu` owns local executable inspection.
- `morpheus tool build --tool qemu --mode local` records an existing executable
  as a managed artifact when `tools.qemu.path` exists.
- Otherwise, `morpheus tool build --tool qemu --mode local` builds and records
  the managed artifact from the canonical managed source path inside the
  workspace (fetching/unpacking as needed).
- `tools/qemu/tool.json` is the declared managed path contract that Morpheus
  uses for the workspace-local source, build, install, and artifact layout.
- The `qemu` CLI owns fetch, unpack, source staging, and build/install for the
  managed build path.
- `nvirsh` should consume the resolved QEMU artifact, not provision the binary.
