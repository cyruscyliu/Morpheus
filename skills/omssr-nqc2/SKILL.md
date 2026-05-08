---
name: nqc2
description: Build the NQC2 QEMU plugin and postprocess traces into LCOV and
  HTML coverage reports through Morpheus-managed workflows. Use when the user
  wants to build NQC2, inspect trace-processing behavior, or reason about the
  NQC2 coverage pipeline.
license: MIT
compatibility: Designed for Codex CLI (or similar products)
---

# nqc2 Skill

Use this skill when you need to work with the `nqc2` tool in this repo.

## Purpose

`nqc2` is a script-backed Morpheus tool.
`tool.json` is the contract.
`scripts/` own fetch, build, postprocess, genhtml, inspect, and logs
behavior.
Use Morpheus for workflow runs, inspection, logs, and artifact-oriented
execution.

## Config Schema

Treat `tools.nqc2` in Morpheus config as the stable config surface for
NQC2-specific policy.
The descriptor accepts these field families:

- source and version selection:
  `source`, `seed-dir`, `build-version`
- build reuse:
  `reuse-build-dir`, `build-dir-key`
- build dependencies:
  `qemu`
- managed build locations:
  `build-dir`, `install-dir`, `trace-dir`
- trace-processing inputs:
  `trace`, `elf`, `trace-output`, `coverage-output`, `coverage-format`
- runtime tuning:
  `jobs`, `wait-seconds`
- HTML output:
  `output`, `title`
- artifact publication:
  `artifacts`

Use shared config for durable defaults and workflow overrides for per-run
trace, ELF, and output paths.

## `tool.json`

`tools/nqc2/tool.json` is the Morpheus integration contract.

- `cli-contract` is `fetch,build,postprocess,genhtml,inspect,logs`
- `config.fields` defines accepted names and aliases
- `managed.local.sourceTemplate`, `buildDirTemplate`, `installDirTemplate`:
  managed source, build, and install locations
- `managed.local.artifacts` defines the published plugin, CLI, and trace-dir
- `commands.*.script` tells Morpheus which shell step to run
- `commands.*.result` defines summaries, artifacts, and stable details

Important descriptor fields:

- `config.fields.jobs`:
  postprocess parallelism for the streamed trace stage
- `config.fields.coverage-format`:
  `etrace`, `lcov`, or `none`
- `managed.local.artifacts.nqc2-plugin-so`:
  plugin path for `qemu.exec`
- `managed.local.artifacts.nqc2`:
  installed CLI path for direct trace processing

## How The Tool Works

NQC2 work is split into explicit stages.

- `fetch` prepares the managed source tree
- `build` compiles:
  - the QEMU plugin
  - the `nqc2` postprocess CLI
- `postprocess` consumes a trace plus `vmlinux` and writes LCOV or textual
  coverage output
- `genhtml` renders the LCOV into HTML through `genhtml`
- `inspect` and `logs` re-read prior metadata and logs

The fast path for binary traces is:

1. load cached per-`vmlinux` metadata:
   - exec-map cache
   - function-range cache
2. stream the trace through the hot overlap stage
3. emit LCOV
4. optionally render HTML

## JSON Contract

Prefer `--json` for automation.
Treat the emitted JSON payload and workflow step manifests as the stable
machine-readable contract.

## Build And Provisioning

The NQC2 dependency installer now provisions:

```bash
tools/nqc2/scripts/install-dependencies.sh
```

It installs:

- `lcov`
- `libdw-dev`
- `libelf-dev`
- `elfutils`

For repo-wide host setup, prefer:

```bash
./install-dependencies.sh
```

## Workflow Pattern

The common project pattern is:

1. `nqc2.build`
2. `qemu.exec` with the plugin enabled
3. `nqc2.postprocess`
4. `nqc2.genhtml`

For reruns, prefer:

```bash
node apps/morpheus/dist/cli.js --config projects/<project>/morpheus.yaml workflow resume --id WORKFLOW_RUN_ID --from-step nqc2_postprocess --one-step --json
```

and then:

```bash
node apps/morpheus/dist/cli.js --config projects/<project>/morpheus.yaml workflow resume --id WORKFLOW_RUN_ID --from-step nqc2_genhtml --one-step --json
```

## Feature List

- managed plugin and CLI builds
- streamed trace postprocessing for binary traces
- cached metadata reuse per `vmlinux`
- LCOV generation
- HTML coverage report generation

## References

- NQC2 paper:
  `https://arxiv.org/pdf/2601.02238`
- `qemu-etrace` reference implementation and data structures:
  `https://github.com/edgarigl/qemu-etrace`

## Current Caveat

Function coverage is good enough for the current HTML workflow, but should still
be treated as approximate rather than a formally exact source-level function
universe.
