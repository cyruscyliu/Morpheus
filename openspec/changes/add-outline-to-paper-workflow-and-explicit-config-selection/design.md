## Context

Morpheus already manages workflow-first runs, stable run artifacts, and
tool-owned behavior behind a generic orchestration boundary. The proposed
`outline-to-paper` capability fits that direction if it is treated as another
managed tool workflow rather than as special Morpheus-native writing logic.

The paper workflow itself is now reasonably scoped. It should be
submission-centric, produce a LaTeX paper for `acsac26`, and accept structured
outline/support artifacts as input. Outline and support remain the semantic
source of truth. Paper drafts, reviews, section plans, and gap reports are
derived artifacts that can be cited by later workflow steps or regenerated when
inputs change.

Separately, Morpheus config loading currently depends on upward discovery from
`cwd`. That works for a single nearby config, but it is awkward when a user or
agent wants to target one submission workspace explicitly, script repeated
invocations, or work in a repo tree that contains multiple Morpheus projects.

## Goals / Non-Goals

**Goals:**

- Add a managed `outline-to-paper` tool/workflow under `tools/`.
- Keep Morpheus unaware of paper-writing internals beyond generic workflow and
  artifact orchestration.
- Define a stable public artifact contract for `outline-to-paper` runs so other
  workflows can cite its outputs.
- Add explicit `--config <path>` selection for Morpheus commands while
  preserving current upward-discovery behavior as the default.
- Make config-relative paths resolve relative to the selected config file.

**Non-Goals:**

- No support collection or literature retrieval in this change.
- No rebuttal workflow in v1.
- No multi-submission workspace orchestration inside one `outline-to-paper`
  workspace.
- No Morpheus-specific awareness of outline schemas, conference review prompts,
  or drafting heuristics beyond tool-owned contracts.

## Decisions

### 1. Model `outline-to-paper` as a managed tool with a `run` entrypoint

The workflow should live under `tools/outline-to-paper/` and expose a stable
`run` contract. Morpheus should treat it like other managed tools: pass inputs,
record workflow steps, stream logs, and store stable artifacts under the
workflow run root.

Alternatives considered:

- Implement paper generation directly inside `apps/morpheus`.
  Rejected because it would make Morpheus aware of tool-specific writing
  semantics.
- Make the skill itself the only implementation surface.
  Rejected because the workflow needs deterministic control-plane scripts and a
  reusable CLI contract.

### 2. Use a claim-first, artifact-driven paper model

The workflow should consume normalized outline/support artifacts and derive
section plans, word budgets, support gaps, reviews, and LaTeX output from them.
This makes template changes and iteration tractable because claims and supports
survive planner or draft changes.

Stable public artifacts should include at least:

- normalized outline
- section plan
- word budget
- support gap report
- mock review summary
- LaTeX draft
- optional PDF export

Alternatives considered:

- Treat the paper draft as the only source of truth after first generation.
  Rejected because it weakens the upstream outline/support workflow and makes
  regeneration less reliable.
- Use a section-first outline model.
  Rejected because venue/template changes affect sections more often than
  underlying claims.

### 3. Separate public run artifacts from tool-private run state

Other workflows should cite stable output artifacts, not internal scratch
files. `outline-to-paper` may keep prompt payloads, intermediate LLM responses,
and internal routing scratch files in tool-private state, while exposing a
smaller stable artifact set to Morpheus.

Alternatives considered:

- Expose every intermediate file as a managed artifact.
  Rejected because it makes the tool contract noisy and hard to evolve.
- Hide all tool outputs behind one exported paper only.
  Rejected because later workflows need reusable planning and review artifacts.

### 4. Add global explicit config selection with `--config`

Morpheus should accept an explicit config file path and use it instead of
upward discovery. This should apply across command surfaces that currently call
`loadConfig(process.cwd())`, including path resolution, workspace defaults, and
config inspection commands.

Resolution rules should be:

- If `--config` is present, use that exact file and do not upward-search.
- If `--config` is absent, keep the current upward-discovery behavior.
- Relative paths inside the chosen config resolve relative to the config file's
  directory.

Alternatives considered:

- Support only multiple named workspaces inside one `morpheus.yaml`.
  Rejected because explicit config-file selection is still valuable for
  submission-local scripting and multi-project trees.
- Add only an environment variable override.
  Rejected because a CLI flag is clearer, more local, and easier to script.

## Risks / Trade-offs

- [The public artifact set may be too small or too large] → Start with a narrow
  stable contract and keep scratch artifacts tool-private.
- [Explicit `--config` may need broad plumbing changes] → Centralize config
  resolution changes in shared config/path helpers rather than patching each
  command ad hoc.
- [Users may confuse named workspaces with multiple config files] → Document
  the distinction: named workspaces solve one-file multiplexing, `--config`
  solves explicit file selection.
- [A paper workflow may look unlike existing tool flows] → Keep Morpheus
  generic and require the tool to own phase semantics, logs, and artifacts just
  like other managed tools.

## Migration Plan

1. Add the new tool descriptor and workflow contract for `outline-to-paper`.
2. Introduce shared config-loading support for explicit config-file selection.
3. Thread `--config` through command entrypoints that currently depend on
   implicit discovery.
4. Define stable managed artifacts for `outline-to-paper` runs and wire them
   into workflow run records.
5. Validate that existing commands still behave the same when `--config` is not
   provided.

Rollback is straightforward because the new tool is additive and `--config` can
be implemented as an optional override on top of the existing discovery model.

## Open Questions

- Should `outline-to-paper run` support partial execution such as `--until
  <phase>` in v1, or only full-pipeline runs?
- Which stable artifacts should Morpheus surface first for downstream citation:
  only planning/review outputs, or also normalized outline inputs copied into
  the run?
- Should PDF export be mandatory in v1 or best-effort when the local LaTeX
  environment is available?
