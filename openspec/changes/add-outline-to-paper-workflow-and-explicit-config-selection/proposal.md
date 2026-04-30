## Why

Morpheus is already a workflow-first execution system with managed artifacts,
but it currently lacks a paper-production workflow that can consume structured
outline/support artifacts and produce a managed LaTeX paper draft. At the same
time, Morpheus config resolution still depends on upward discovery from the
current directory, which makes multi-submission or multi-workspace setups
awkward to script and hard to select explicitly.

This change adds a new `outline-to-paper` managed workflow and explicit
`--config` selection so Morpheus can orchestrate submission-centric paper runs
without becoming aware of the tool's internal writing logic.

## What Changes

- Add a new `outline-to-paper` tool/workflow under `tools/outline-to-paper/`
  that accepts normalized outline/support artifacts and produces managed paper
  artifacts.
- Keep the v1 public CLI surface narrow with `outline-to-paper run`,
  `outline-to-paper inspect`, and `outline-to-paper logs`.
- Define the workflow as submission-centric and artifact-driven: outline and
  support stay the semantic source of truth, while paper drafts are derived
  artifacts that can be regenerated or revised.
- Support stable public artifacts from the workflow such as normalized outline,
  section plan, word budget, support gaps, mock review summary, LaTeX draft,
  and optional PDF output.
- Add explicit `--config <path>` selection for Morpheus so commands can use a
  chosen `morpheus.yaml` instead of relying only on upward search from `cwd`.
- Preserve Morpheus as a generic workflow manager: the tool owns outline
  normalization, section planning, drafting, review, and export semantics.
- Allow later workflows or reruns to cite stable artifacts from
  `outline-to-paper` runs rather than depending on tool-private intermediate
  state.

## Capabilities

### New Capabilities

- `outline-to-paper-workflow`: Define a Morpheus-managed workflow/tool that
  converts normalized outline/support artifacts into planned, reviewed, and
  exported paper artifacts.

### Modified Capabilities

- `morpheus-app`: Change Morpheus command behavior so users can explicitly
  select the config file with `--config` instead of relying only on implicit
  config discovery from the working directory.
- `morpheus-managed-runs`: Change managed workflow expectations so managed runs
  can expose stable reusable paper-planning and paper-export artifacts for
  downstream workflows.

## Impact

- New tool package under `tools/outline-to-paper/`
- Likely affected Morpheus config and path resolution in
  `apps/morpheus/src/core/config.ts`, `apps/morpheus/src/core/paths.ts`, and
  command entrypoints that currently call `loadConfig(process.cwd())`
- Likely affected workflow invocation and managed artifact plumbing in
  `apps/morpheus/src/core/` and related workflow commands
- New skill and tool descriptors for the paper workflow
- No expected breaking change to existing config discovery when `--config` is
  not provided
