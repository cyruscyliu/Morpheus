---
name: libvmm
description: Fetch, build, and register libvmm checkouts as managed artifacts for Morpheus-managed dependencies. Use when the user wants workspace-local libvmm paths or Morpheus-managed libvmm builds.
license: MIT
compatibility: Designed for Codex CLI (or similar products)
---

# libvmm Skill

Use this skill when you need to work with the repo-local `libvmm` tool.

## Purpose

`libvmm` provisions a libvmm git checkout and can build an example when given a
Microkit SDK directory. It exposes stable artifact records that Morpheus can
pass to dependent tools such as `nvirsh`.

## First Steps

1. Run `pnpm --filter @morpheus/libvmm build` if the tool has not been built.
2. Run `node tools/libvmm/dist/index.js --help` to inspect the current surface.
3. Prefer `--json` when the output will be consumed programmatically.

## Command Surface

```text
libvmm inspect
libvmm build
libvmm version
libvmm help
```

## Managed Boundary

- `libvmm` owns provisioning a git checkout and running `git submodule update`.
- `libvmm` can apply workspace-local patches when a patch directory is provided.
- `libvmm` can build an example with `make` when a Microkit SDK path is provided.
- Morpheus should pass Microkit SDK paths via dependency artifacts.
