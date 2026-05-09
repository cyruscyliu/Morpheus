---
name: nqc2
description: Build the NQC2 QEMU plugin and postprocess traces through a
  qemu-etrace-backed LCOV/HTML pipeline in Morpheus-managed workflows. Use
  when the user wants to build NQC2, inspect trace-processing behavior, or
  reason about the NQC2 coverage pipeline.
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
- `managed.local.artifacts` defines the published plugin, qemu-etrace-backed
  CLI wrapper, backend binary, and trace-dir
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
  installed compatibility wrapper path
- `managed.local.artifacts.qemu-etrace`:
  installed backend binary used for LCOV generation

## How The Tool Works

NQC2 work is split into explicit stages.

- `fetch` prepares the managed source tree
- `build` compiles:
  - the QEMU plugin
  - a local `qemu-etrace` checkout and binary
- `postprocess` consumes a trace plus `vmlinux`, rewrites the trace info flag
  for `qemu-etrace` compatibility, runs `qemu-etrace`, and normalizes LCOV
  output for `genhtml`
- `genhtml` renders the LCOV into HTML through `genhtml`
- `inspect` and `logs` re-read prior metadata and logs

The current LCOV path is:

1. build the NQC2 QEMU plugin
2. clone and build `qemu-etrace`
3. copy the trace and clear the TB-chaining info flag
4. run `qemu-etrace` for LCOV
5. normalize the LCOV
6. optionally render HTML

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
- `binutils-dev`
- `dwarfdump`
- `libglib2.0-dev`
- `libiberty-dev`

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

- managed plugin and backend builds
- qemu-etrace-backed LCOV generation
- Morpheus-managed trace canonicalization before postprocess
- LCOV generation
- HTML coverage report generation

## References

- NQC2 paper:
  `https://arxiv.org/pdf/2601.02238`
- `qemu-etrace` reference implementation and data structures:
  `https://github.com/edgarigl/qemu-etrace`

## Current Caveat

The authoritative LCOV backend is now `qemu-etrace`.
The wrapper still normalizes its output for `genhtml`, so exact file/function
totals should be treated as `qemu-etrace` semantics plus a thin compatibility
layer rather than a source-native gcov build.

## Memento

Before this backend switch, `nqc2` carried a large custom C postprocessor for
LCOV generation.
That implementation received substantial optimization work:

- direct `libdw` / `libelf` integration instead of shelling out
- metadata caching per `vmlinux`
- streamed trace handling
- interval-based line metadata
- parallel hot-path processing
- `perf`-driven tuning
- repeated sweep and scale evaluation on small, medium, and real traces

In short, it was heavily vibed, optimized, and benchmarked.
But the core problem was semantic, not just performance:

- line coverage diverged badly from `qemu-etrace`
- function coverage diverged even more
- repeated fixes improved mechanics without restoring semantic trust

The final conclusion was that an optimized but semantically wrong coverage
engine was the wrong foundation.
So the repo now keeps the NQC2 plugin, but uses `qemu-etrace` as the
authoritative coverage backend.
