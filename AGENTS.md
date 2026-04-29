# AGENTS.md

## General Principles

- Prefer clear, concise writing.
- Prefer one-line sentences when possible.
- Wrap generated Markdown at 80 chars.
- Use repo-relative paths or plain code references.
- Do not add absolute filesystem paths.
- Add comments when they improve clarity.

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
- Treat remote mode as transport, not as a separate tool contract.
- Never add tool-specific behavior to Morpheus.
- Keep Morpheus generic and move tool-specific logic into `tools/<tool>/`.
- Require explicit user intent for ambiguous or destructive actions.
- When adding a new CLI package or tool, update the relevant build, lint,
  test, and smoke commands.
- When adding a repo-local tool wrapper, declare it in `tools/<tool>/tool.json`
  so `install:bin` can discover it automatically.
- When updating a tool, update its skill and `tools/<tool>/README.md` in the
  same change.

## Commit Messages

- Use `prefix: summary` (subject-only) commit messages.

## Workspace Rule

- Treat `<workspace>/tools/`, `<workspace>/runs/`, and `<workspace>/tmp/` as
  the stable Morpheus-managed layout.

## Skills-First Docs

This repo treats `skills/` and tool descriptors as the canonical documentation
source, and avoids maintaining per-tool `README.md` files.
`apps/docs` renders documentation from `skills/*/SKILL.md` plus
`tools/*/tool.json`, while `.codex/skills/` and `.claude/skills/` may contain
additional third-party skills with `omssr-*` entries symlinked to `skills/`.
