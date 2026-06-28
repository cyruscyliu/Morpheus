# AGENTS.md

## General Principles

- Prefer clear, concise writing.
- Prefer one-line sentences when possible.
- Wrap generated Markdown at 80 chars.
- Use repo-relative paths or plain code references.
- Do not add absolute filesystem paths.
- Do not hardcode environment-specific `/workspace/...` discovery paths or
  similar host-layout assumptions into repo code.
- Add comments when they improve clarity.
- If you are uncertain, ask instead of fabricating results under pressure.
- After modifying the repo-root `morpheus.yaml`, run
  `pnpm test:root-config`.
- Keep workflow phase boundaries strict.
- `patch.sh` focuses on patching.
- `build.sh` focuses on building, with no patching.
- `run.sh` focuses on running, with no patching and no building.
- `overrides/` source mutation trees are not acceptable.
- Repo-managed source changes must go through a tool patch phase and a
  `patch-dir`, not fetch-time or build-time overrides.
- When a tool exposes project hook scripts, the tool-owned script is an
  adapter and must delegate explicitly to the configured project hook.
- Do not accept hook-script config fields without implementing the matching
  runtime delegation path.

## Review Principles

- For review requests scoped by time, release, tag, or similar history
  boundaries, first resolve the exact review boundary from the repo's release
  history.
- Prefer real Git tags when they exist.
- If tags are missing or incomplete, use release/version commits and
  `CHANGELOG.md` as the authoritative fallback.
- State the exact commit or version boundary used in the review.
- Structure the review in this order:
  1. inspect the code changes in the requested scope
  2. identify regressions, risks, and behavior changes in those changes
  3. verify that the relevant skills, docs, or contracts still match the live
     implementation
- When reviewing a Morpheus-managed tool, always use the Morpheus skill as part
  of the review, even if a tool-specific skill also applies.

## CLI Principles

- Design CLIs in a Unix-like style.
- Prefer simple, composable commands.
- Prefer clear top-level verbs over deep nesting.
- Treat `--json` as a first-class interface.
- Keep `--help`, success output, and error output consistent.
- Prefer explicit flags and arguments over hidden state.
- Use stable field names and predictable exit codes.
- Keep output deterministic for scripts and agents.
- Keep tool semantics thin and testable.
- Require explicit user intent for ambiguous or destructive actions.
- When adding a new CLI package or tool, update the relevant build, lint,
  test, and smoke commands.

## Commit Messages

- Use `component: action short-summary` subject-only commit messages.

## Skills-First Docs

This repo treats `skills/` and tool descriptors as the canonical documentation
source, and avoids maintaining per-tool `README.md` files.
`apps/docs` renders documentation from `skills/*/SKILL.md` plus
`tools/*/tool.json`, while `.codex/skills/` and `.claude/skills/` may contain
additional third-party skills with `omssr-*` entries symlinked to `skills/`.

Standalone tool docs are allowed when they explain non-Morpheus usage, such as
`tools/nqc2/README.md`.
