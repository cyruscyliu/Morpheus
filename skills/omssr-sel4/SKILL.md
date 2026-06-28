---
name: sel4
description: Inspect, build, and register seL4 source directories as managed
  artifacts for Morpheus-managed dependencies. Use when the user wants seL4
  source metadata, workspace-managed source paths, or Morpheus-managed seL4
  registration.
license: MIT
compatibility: Designed for Codex CLI (or similar products)
---

# sel4 Skill

Use this skill when you need to work with the `sel4` tool.

## Purpose

`sel4` is now migrating to a script-backed Morpheus tool model.
`tool.json` is the contract.
`scripts/` own fetch, patch, build, inspect, and logs behavior.

## Config Schema

Treat `tools.sel4` in Morpheus config as the stable config surface.
The descriptor accepts these field families:

- source selection: `path`, `build-version`, `archive-url`
- patching: `patch-dir`
- build reuse: `reuse-build-dir`, `build-dir-key`
- artifact publication: `artifacts`

Use shared config for stable source defaults and workflow-step arguments when a run
needs a specific seL4 version.

## `tool.json`

`tools/sel4/tool.json` is the Morpheus integration contract.

- `cli-contract` is `fetch,patch,build,inspect,logs`
- `config.fields` defines accepted names and aliases
- `managed` defines downloads, source, and artifact path templates
- `commands.*.script` tells Morpheus which shell step to run
- `commands.*.result` defines summaries, artifacts, and stable details

This descriptor is the source of truth for how Morpheus resolves and records
the managed seL4 source tree.

Important descriptor fields:

- `config.fields.path`, `build-version`, `archive-url`:
  source selection.
- `config.fields.patch-dir`:
  patch tree location.
- `managed.local.sourceTemplate`:
  stable managed source location.
- `commands.fetch` and `commands.patch`:
  the primary useful seL4 source preparation steps.

## How The Tool Works

`sel4` manages seL4 source material as a reusable artifact for later
workflows.

- `fetch` downloads or materializes the requested source tree
- `patch` applies the configured patch set
- `build` records the prepared source artifact for downstream use
- `inspect` re-reads version and artifact metadata
- `logs` re-reads prior execution logs

Downstream `microkit-sdk` workflows should usually consume the patched seL4
source tree directly rather than requiring a separate explicit `sel4.build`
workflow step.

## JSON Contract

Prefer `--json` for automation.
Treat the emitted JSON payload as the stable machine-readable contract for
source artifacts and version metadata.

## Smoke Test

Use the workflow smoke command for a fast managed validation pass:

```bash
node apps/morpheus/dist/cli.js --json --config morpheus.yaml workflow run --name sel4-build-ci
```

This validates the real managed seL4 workflow path.

## Feature List

- source directory inspection and version metadata capture
- managed source fetch and patch flow
- published seL4 source artifacts for downstream workflows
- reusable source preparation for later runtime or build steps

## Potential To-Do List

- expand guidance for version pinning and source reuse
- document common downstream workflow patterns that consume seL4 artifacts
- add sharper examples for patch management and source preparation
