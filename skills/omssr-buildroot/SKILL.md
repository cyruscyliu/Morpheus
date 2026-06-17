---
name: buildroot
description: Run Buildroot workflows, inspect build metadata, and validate the
  CLI with the smoke fixture. Use when the user wants to build with
  Buildroot, inspect a prior build, or reason about the Buildroot tool
  contract.
license: MIT
compatibility: Designed for Codex CLI (or similar products)
---

# buildroot Skill

Use this skill when you need to work with the `buildroot` tool in this repo.

## Purpose

`buildroot` is now migrating to a script-backed Morpheus tool model.
`tool.json` is the contract.
`scripts/` own fetch, patch, build, and inspect behavior.
Use Morpheus for workflow runs, inspection, logs, and artifact-oriented
execution.

## Config Schema

Treat `tools.buildroot` in Morpheus config as the stable config surface for
Buildroot-specific policy.
The descriptor accepts these field families:

- source selection: `source`, `build-version`, `archive-url`
- patching: `patch-dir`
- build reuse: `reuse-build-dir`, `build-dir-key`
- Buildroot build inputs: `defconfig`, `make-arg`, `config-fragment`
- artifact publication: `artifacts`

Use aliases from the descriptor when Morpheus resolves workflow config into
tool flags.
Prefer shared config for stable defaults and workflow-step overrides for
run-specific values.

## `tool.json`

`tools/buildroot/tool.json` is the integration contract Morpheus reads.

- `cli-contract` is `fetch,patch,build,inspect`
- `config.fields` defines accepted config names and aliases
- `managed` declares managed source, downloads, build output, and artifact
  path templates
- `commands.*.script` tells Morpheus which shell step to run
- `commands.*.result` defines summaries, artifacts, and stable details

This descriptor is the source of truth for how Morpheus materializes workspace
paths and forwards Buildroot options.

Important descriptor fields:

- `config.fields.source`, `build-version`, `archive-url`:
  source selection.
- `config.fields.patch-dir`:
  patch tree location.
- `config.fields.reuse-build-dir`, `build-dir-key`:
  stable managed build path policy.
- `managed.local.sourceTemplate`, `buildDirTemplate`:
  managed source and output locations.
- `commands.build.pathFlags.output` and `managed.local.artifacts`:
  where the build writes and what it publishes.

## How The Tool Works

Buildroot work is split into explicit stages.

- `fetch` materializes a managed source tree
- `patch` applies a configured patch set to that tree
- `build` runs Buildroot against the resolved source and output paths
- `inspect` re-reads the recorded manifest instead of rebuilding
The managed artifact contract is centered on the fetched source tree and the
published image outputs such as `images/Image` and
`images/rootfs.cpio.gz`.
Treat manifest files as the primary stable automation contract.

## JSON Contract

Every command supports `--json`, including `--help` and error cases.

- Prefer `--json` for automation.
- Treat manifest files as the primary stable automation contract.

## Smoke Test

The repo includes a tiny fixture for fast validation of the managed workflow
path.

```bash
node apps/morpheus/dist/cli.js --json --config morpheus.yaml workflow run --name buildroot-build-ci
```

This validates the real managed Buildroot workflow path.

For real project provisioning, prefer the repo-root bootstrap:

```bash
./install-dependencies.sh
```

## Feature List

- managed source fetch and patch application
- Buildroot build execution with explicit config fragments and make arguments
- manifest and log re-read through stable automation surfaces
- published image artifacts such as kernel and initrd outputs

## Potential To-Do List

- broaden artifact publication for more Buildroot output types
- document common workflow patterns for reusable Buildroot runs
- add clearer guidance for patch iteration and build directory reuse
