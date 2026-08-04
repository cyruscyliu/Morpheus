---
name: evaluation
description: Run reproducible evaluation matrices from workflow exports, collect
  metrics, generate LaTeX tables and narrative summaries, debug failing
  workflows through Morpheus, and resume evaluation after fixes.
license: MIT
compatibility: Designed for Codex CLI (or similar products)
---

# omssr-evaluation Skill

Use this skill when you need to run or maintain evaluation workflows driven by
`evaluation.json`.

## Purpose

This skill covers the evaluation loop for exported workflows:

1. export a configured workflow bundle through Morpheus
2. run the exported workflow bundle as the reproducible artifact
3. collect metrics and summarize results
4. emit LaTeX tables and a short written interpretation by default

The evaluation artifact is for other people too.
It should be runnable outside the original Morpheus workspace.

## Inputs

The canonical inputs are:

- repo root `.env`
- `scripts/run-evaluations.mjs`
- `workspaces/<project>/artifacts/evaluation.json`

`.env` should provide `MORPHEUS_DATA_ROOT`.
Do not guess `MORPHEUS_DATA_ROOT`.
If it is missing, stop and fix the environment first.

Typical shell setup:

```bash
set -a
. ./.env
set +a
```

## Execution Model

`scripts/run-evaluations.mjs` is the main entrypoint.

It expands each `workflow_pattern` from `evaluation.json`, then for each
workflow it:

1. runs `morpheus workflow export`
2. runs the exported bundle through `morpheus.sh workflow run --name`
3. collects metrics from the exported workflow results

Typical commands:

```bash
./scripts/run-evaluations.mjs \
  --spec "${MORPHEUS_DATA_ROOT}/workspaces/hyperarm/artifacts/evaluation.json" \
  --dry-run \
  --json
```

```bash
./scripts/run-evaluations.mjs \
  --spec "${MORPHEUS_DATA_ROOT}/workspaces/hyperarm/artifacts/evaluation.json" \
  --evaluation virtio-callgraphs-static-analysis \
  --driver virtio-net \
  --kernel 6.18.42 \
  --force \
  --json
```

## Failure Handling

If evaluation fails, do not treat the failure as only an evaluation problem.
It may be a real workflow or tool bug.

Use Morpheus to inspect and debug first:

```bash
./bin/morpheus --config <config> workflow run --name <workflow> --json
./bin/morpheus --config <config> workflow inspect --name <workflow> --json
./bin/morpheus --config <config> workflow logs --name <workflow>
```

Required loop:

1. reproduce the failure with Morpheus
2. inspect the failing step or tool
3. fix the bug in repo code or workflow config
4. verify the fix with Morpheus-managed execution
5. resume the evaluation run

Do not paper over workflow bugs inside the evaluation wrapper.
Fix the underlying tool or workflow when possible.

## Resumption Rules

- Prefer rerunning only the filtered evaluation, driver, or kernel that failed.
- Keep the evaluation spec minimal and executable.
- If a kernel or driver is known unsupported, remove it from the active matrix
  instead of letting every run rediscover the same failure.
- Keep generated summaries parseable.

## Outputs

Evaluation runs write parseable results under:

- `${MORPHEUS_DATA_ROOT}/workspaces/<project>/artifacts/runs/<timestamp>/`

Important files:

- `evaluation-summary.json`
- `evaluation-results.csv`
- `evaluation-results.md`
- `evaluation-results.tex`
- `evaluation-analysis.md`
- `<evaluation>/<workflow>/evaluation-result.json`
- `<evaluation>/<workflow>/evaluation-metrics.json`

Default reporting action after a successful run:

1. inspect `evaluation-summary.json`
2. inspect `evaluation-results.tex`
3. inspect `evaluation-analysis.md`
4. report the key fastest, slowest, and largest results to the user

Use the generated LaTeX tables as the default paper-ready output.
Use the generated narrative summary as the default prose explanation.

## Rules

- Prefer Morpheus CLI entrypoints over ad hoc tool invocation.
- Prefer `--json` for machine-readable evaluation state.
- Treat exported workflow bundles as the reproducible artifact.
- Treat bundle execution as Morpheus-independent for downstream users.
- If a bug appears, fix it, verify it with Morpheus, then resume evaluation.
- After successful evaluation runs, do not stop at raw JSON or CSV output.
- Produce and review the LaTeX and narrative report artifacts by default.
