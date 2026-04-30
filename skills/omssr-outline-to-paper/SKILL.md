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

## First Steps

When operating in this repo:

1. Run `node tools/outline-to-paper/index.js --help` to confirm the live CLI
   surface.
2. Prefer `--json` when the output will be consumed programmatically.
3. Re-read prior state with `inspect` or `logs` before rerunning a paper step
   when possible.
4. Prefer Morpheus-managed workflow runs when the paper artifacts should be
   reusable by later workflows.

Typical direct flow:

```bash
node tools/outline-to-paper/index.js run \
  --workspace ./workspace \
  --outline ./normalized-outline.json \
  --support ./support-registry.json \
  --template acsac26 \
  --json

node tools/outline-to-paper/index.js inspect --workspace ./workspace --id <run-id> --json
node tools/outline-to-paper/index.js logs --workspace ./workspace --id <run-id>
```

Typical Morpheus handoff:

```bash
node apps/morpheus/dist/cli.js workflow run --name outline-paper --json
```

## Command Surface

The v1 public commands are:

```text
outline-to-paper run
outline-to-paper inspect
outline-to-paper logs
```

Use them by intent:

- `run`: create a paper run from normalized outline/support inputs.
- `inspect`: read stable metadata and artifact references for a prior run.
- `logs`: read textual execution logs for a prior run.

## Stable Inputs

The workflow expects explicit structured inputs:

- normalized outline artifact
- support registry artifact
- template selection such as `acsac26`

Treat the outline and support inputs as the semantic source of truth.
Paper drafts are derived artifacts.

## Stable Outputs

Treat the following as the public artifact contract:

- normalized outline copy
- support registry copy
- section plan
- word budget
- support gap report
- mock review summary
- LaTeX paper draft

Do not treat prompt payloads, intermediate LLM outputs, or scratch routing
state as stable downstream inputs.

## Morpheus Boundary

If the user wants reusable workflow artifacts:

- prefer Morpheus-managed workflow runs
- let Morpheus own workflow ids, logs, and artifact publication
- let `outline-to-paper` own paper-specific semantics

If a later workflow needs to build on the paper step:

- cite stable published artifacts
- do not depend on tool-private scratch files

## Current Scope

The current v1 scope is:

- LaTeX paper generation
- structured planning artifacts
- support gap detection
- mock review summary output

Out of scope for now:

- support collection
- literature retrieval
- rebuttal workflow
- multi-submission orchestration inside one tool workspace
