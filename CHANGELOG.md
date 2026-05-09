# Changelog

## 0.4.1

- Switched `tools/nqc2` coverage postprocessing from the custom C
  implementation to a `qemu-etrace` backend.
- Kept the NQC2 QEMU plugin, but made `postprocess` a wrapper that:
  - canonicalizes the trace for `qemu-etrace`
  - runs `qemu-etrace`
  - normalizes LCOV output for `genhtml`
- Removed the old `tools/nqc2/scripts/nqc2_postprocess.c` implementation after
  it was found to be semantically wrong despite heavy optimization work.
- Updated NQC2 documentation to explain the backend switch, the motivation,
  the historical custom implementation, and standalone usage without Morpheus.
- Bumped workspace package versions from `0.4.0` to `0.4.1`.

## 0.4.0

- Added workflow `resume` and `--from-step` reruns.
- Finalized managed run stop/remove lifecycle.
- Improved workflow discovery, inspect, logs, help, and JSON surfaces.
- Added one-step resume.
- Improved runs-viewer artifact graphs, event inspection, and workflow
  visualization.
- Regulated workflow event logging and step execution roots.
- Migrated project configs into `projects/`.
- Switched QEMU workflows local and hardened tracing and reruns.
- Migrated tools to script-backed workflows.
- Removed `nvirsh`.
- Added the first `nqc2` postprocess pipeline.
- Heavily optimized the old custom `nqc2` C postprocessor, but did not achieve
  semantically trustworthy coverage results.

## 0.3.0

- Refactored Morpheus around generic tool transport.
- Required workflows for Morpheus tool execution.
- Fixed remote streamed workflows and config import cycles.
- Improved workflow logs and tool build UX.
- Migrated docs to the Next.js `apps/docs` app.
- Switched docs to a skills-first and `tool.json`-driven model.
- Rendered documentation from skills and tool descriptors rather than ad hoc
  per-tool docs.

## 0.2.0

- Added `runs-viewer`.
- Nested managed tool runs under workflow steps.
- Improved workflow inspection, logs, and runtime contracts.
- Added libvmm runtime contracts for `nvirsh`.
- Streamed workflow step logs.
- Added managed `llbic` and `llcg` workflows.
- Added remote support for `llbic` and `llcg`.
- Added synced remote Morpheus runtime support.
- Tightened artifact references and workflow run-dir semantics.

## 0.1.x

This era covers the initial history before the explicit `0.2.0` version bump.

- Started as a docs and Buildroot-focused repo, then renamed the research
  runtime into Morpheus.
- Added the Morpheus workspace model and repo tool wrappers.
- Moved Buildroot remote mode into Morpheus-managed execution.
- Introduced managed tool runs under `morpheus tool`.
- Added managed QEMU and `nvirsh` workflows.
- Added Microkit SDK and seL4 managed tool support.
- Added libvmm managed builds and runtime integration.
- Established the stable workspace layout around `tools/`, `runs/`, and
  managed artifacts.
