---
name: libvmm
description: Provision libvmm checkouts and build examples as Morpheus-managed artifacts.
license: MIT
compatibility: Designed for Codex CLI (or similar products)
---

# libvmm Skill

Use this skill when you need to work with the repo-local `libvmm` tool.

## Purpose

`libvmm` provisions a libvmm git checkout and builds one of its examples given
an existing Microkit SDK and toolchain. The checkout is treated as a stable
workspace artifact so Morpheus-managed workflows can depend on it.

The `libvmm` tool owns `git clone`, `git fetch`, and `git submodule update`.
Morpheus only orchestrates execution and records runs.

## First Steps

1. Run `pnpm --filter @morpheus/libvmm build` if the tool has not been built.
2. Run `node tools/libvmm/dist/index.js --help` to inspect the surface.
3. Prefer `--json` for machine-readable output.

## Command Surface

```text
libvmm inspect
libvmm build
libvmm version
libvmm help
```

## Typical Morpheus Flow

```bash
./bin/morpheus --json tool build --tool libvmm
./bin/morpheus --json tool build --tool nvirsh
```

## Notes

- Keep patches in a workspace-local directory and configure
  `tools.libvmm.patch-dir` in `morpheus.yaml` (or point it at
  `tools/libvmm/patches` to use the repo-shipped patch set).
- The `virtio` example expects `sdfgen` 0.28.*. This repo ships an upstreamable
  patch at `tools/libvmm/patches/0001-add-requirements-for-sdfgen-0.28.patch`
  that adds `requirements.txt` to the libvmm checkout.
- When `--json` is used, libvmm prints progress logs to stderr and a single JSON
  object on stdout.
- Provisioning runs git non-interactively (so missing credentials should fail
  fast rather than hang).
