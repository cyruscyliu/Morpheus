---
name: qemu
description: Inspect, fetch, unpack, build, run, and register QEMU executables as stable artifacts for Morpheus-managed dependencies. Use when the user wants QEMU executable metadata, workspace-local QEMU paths, direct kernel-plus-initrd boots, or Morpheus-managed QEMU builds.
license: MIT
compatibility: Designed for Codex CLI (or similar products)
---

# qemu Skill

Use this skill when you need to work with the repo-local `qemu` tool.

## Purpose

`qemu` is a minimal CLI for executable inspection, managed builds, and direct
local runtime launch.
It validates the binary, reads `--version`, and exposes a stable artifact
record that Morpheus can pass to dependent tools such as `nvirsh`.
It can also boot a kernel and initrd locally with `qemu run`.
Morpheus manages execution placement around that contract for both `local` and
`remote` builds, and can invoke `qemu run` locally after resolving the managed
executable path.
Managed build mode can fetch a QEMU release tarball, unpack it into the
canonical managed source path from `morpheus.yaml`, stage the build copy, and
build/install the executable itself.
Use `build-version` as the common selector when the tool needs to fetch QEMU
source.

## First Steps

1. Run `pnpm --filter @morpheus/qemu build` if the tool has not been built.
2. Run `node tools/qemu/dist/index.js --help` to inspect the current surface.
3. Prefer `--json` when the output will be consumed programmatically.

## Command Surface

The public command tree is:

```text
qemu inspect
qemu fetch
qemu patch
qemu build
qemu run
qemu logs
qemu version
qemu help
```

## Managed Boundary

- `qemu` owns local executable inspection.
- `qemu` owns local kernel-plus-initrd runtime launch.
- `qemu` owns `fetch`, `patch`, unpack, source staging, and build/install for the
  managed build path.
- Morpheus owns workspace directory selection and passes those paths to the
  tool CLI.
- Managed execution should start from Morpheus workflows.
- That remote path now requires a remote Morpheus runtime, either from
  `morpheus` on `PATH`, a mirrored repo checkout with `bin/morpheus`, or an
  explicit `MORPHEUS_REMOTE_BIN` override.
- `tools/qemu/tool.json` is the declared managed path contract that Morpheus
  uses for the workspace-local source, build, install, and artifact layout.
- `nvirsh` should consume the resolved QEMU artifact, not provision the binary.
