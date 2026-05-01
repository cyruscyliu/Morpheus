---
name: omssr-outline-to-paper
description: Run submission-centric outline-to-paper workflows, inspect paper
  planning artifacts, and read workflow logs. Use when the user wants to turn
  normalized outline/support artifacts into LaTeX paper artifacts through the
  `outline-to-paper` tool or a Morpheus-managed workflow.
license: MIT
compatibility: Designed for Codex CLI (or similar products)
---

# omssr-outline-to-paper Skill

Use this skill when you need to work with the `outline-to-paper` CLI in this
repo.

## Purpose

`outline-to-paper` is a submission-centric paper workflow tool.
It consumes normalized outline and support artifacts and produces stable paper
planning, gap, review, and LaTeX outputs.

It is not a generic literature-search tool.
It is not a rebuttal system in v1.
It is the final paper-construction step that turns structured inputs into a
managed paper draft.

Morpheus owns workflow runs, logs, and artifact orchestration.
`outline-to-paper` owns paper-specific logic.

## Config Schema

Treat `tools.outline-to-paper` in Morpheus config as the stable config
surface.
The descriptor currently exposes these core fields:

- template selection: `template`
- language selection: `language`
- output shape: `output-format`
- workflow inputs should include a normalized outline artifact and a support
  registry artifact

Treat the outline and support inputs as the semantic source of truth.
Paper drafts are derived artifacts.

Keep stable paper defaults in shared config and pass workflow-specific template
or language changes through Morpheus.

## `tool.json`

`tools/outline-to-paper/tool.json` is the Morpheus integration contract.

- `cli-contract` is `exec,inspect,logs`
- `entry` is `index.js`
- `config.fields` defines the supported paper-generation knobs
- `managed.schemaVersion` declares the descriptor schema version Morpheus
  understands
- the stable artifact contract should include the normalized outline copy,
  support registry copy, section plan, word budget, support gap report, mock
  review summary, and LaTeX paper draft

This descriptor is intentionally thin because Morpheus handles workflow
orchestration while the tool owns paper-specific semantics.
Do not treat prompt payloads, intermediate LLM outputs, or scratch routing
state as stable downstream inputs.

## How The Tool Works

`outline-to-paper` is the execution endpoint for turning normalized inputs into
paper artifacts.

- `exec` produces the planning and LaTeX outputs for one paper run
- `inspect` re-reads stable metadata and artifact references
- `logs` re-reads textual execution logs

## JSON Contract

Prefer `--json` for automation.
Treat the emitted JSON payload as the stable machine-readable contract for run
metadata and published paper artifacts.

## Smoke Test

Use the package smoke script for a fast CLI validation pass:

```bash
pnpm --filter @morpheus/outline-to-paper smoke
```

The smoke test validates the paper workflow CLI path without requiring a full
paper run.

## Feature List

- LaTeX paper generation
- structured planning artifacts
- support gap detection
- mock review summary output

## Potential To-Do List

- support collection
- literature retrieval
- rebuttal workflow
- multi-submission orchestration inside one tool workspace
