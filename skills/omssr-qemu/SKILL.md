---
name: qemu
description: Inspect, fetch, unpack, build, run, and register QEMU executables as stable artifacts for Morpheus-managed dependencies through Morpheus workflows.
license: MIT
compatibility: Designed for Codex CLI (or similar products)
---

# qemu Skill

Use this skill when you need to work with the `qemu` tool.

## Purpose

`qemu` is a Morpheus-internal CLI for executable inspection and managed builds.
It validates the binary, reads `--version`, and exposes a stable artifact
record that Morpheus can pass to dependent tools such as `nvirsh`.
Morpheus manages execution placement around that contract and can invoke
`qemu run` after resolving the managed executable path.
Managed build mode can fetch a QEMU release tarball, unpack it into the
canonical managed source path from Morpheus config, stage the build copy, and
build/install the executable itself.
Use `build-version` as the common selector when the tool needs to fetch QEMU
source.

## Config Schema

Treat `tools.qemu` in Morpheus config as the stable config surface.
The descriptor accepts these field families:

- source or binary selection: `source`, `path`, `build-version`, `archive-url`
- patching: `patch-dir`
- build reuse: `reuse-build-dir`, `build-dir-key`
- build configuration: `target-list`, `configure-arg`
- runtime passthrough: `qemu-arg`, `append`
- artifact publication: `artifacts`

Use shared config for durable defaults and workflow overrides for per-run
boot arguments or target selection.

## `tool.json`

`tools/qemu/tool.json` is the Morpheus integration contract.

- `cli-contract` is `fetch,patch,build,exec,inspect,logs`
- `runGuard` serializes managed runs in one workspace
- `config.fields` defines accepted names and aliases
- `managed.artifactPath` names the primary executable artifact
- `managed` defines managed source, downloads, build, install, and artifact
  path templates
- `commands.fetch` and `commands.build` describe how Morpheus rewrites path
  flags before invoking the tool

This descriptor is the source of truth for how Morpheus locates and publishes
`qemu-system-aarch64`.

## How The Tool Works

`qemu` can either inspect an existing executable or build one as a managed
artifact.

- `fetch` downloads and unpacks the requested source release
- `patch` applies the configured patch tree
- `build` configures, compiles, and installs the executable into the managed
  install path
- `exec` runs QEMU against prepared artifacts that Morpheus resolved earlier
- `inspect` and `logs` re-read prior metadata and logs

`nvirsh` should consume the published QEMU artifact instead of provisioning
the binary itself.

## JSON Contract

Prefer `--json` for automation.
Treat the emitted JSON payload as the stable machine-readable contract for
artifact and metadata inspection.

## Smoke Test

Use the package smoke script for a fast CLI validation pass:

```bash
pnpm --filter @morpheus/qemu smoke
```

The smoke test validates the managed QEMU CLI path without requiring a full
workflow.

## Feature List

- executable inspection and version detection
- managed source fetch, patch, build, and install
- published QEMU executable artifacts for downstream tools
- runtime execution against previously prepared artifacts

## Potential To-Do List

- expand documented target coverage beyond the primary executable path
- add clearer guidance for runtime argument conventions
- document more reusable workflow patterns for managed QEMU builds
